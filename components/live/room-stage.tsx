"use client";

import * as React from "react";
import {
  RoomAudioRenderer,
  VideoTrack,
  useParticipants,
  useTracks,
  type TrackReference,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import {
  ChevronLeft,
  ChevronRight,
  GripVertical,
  Hand,
  Maximize,
  Mic,
  Minimize,
  Minus,
  Plus,
  Radio,
} from "lucide-react";
import { Avatar, Badge } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  AnnotationOverlay,
  type ActiveAnnotation,
  type DrawInput,
} from "./annotation-overlay";
import type { LiveMember, PresentState } from "./types";

// 룸 stage — LiveKit 컨텍스트 안에서 참가자 타일을 렌더한다.
// 무대 우선순위: 발표자료 공유 > 화면공유 > 전원 그리드.
//   공유(발표자료/화면)가 있으면: 공유 무대(왼쪽 크게, '발표 중' 라벨) + 얼굴 세로 스트립(오른쪽, 개수 0..N 조절).
//   전체화면에선 스트립이 공유 화면 위에 뜨므로 손잡이로 위치를 옮길 수 있다(드래그·방향키, 화면 안 클램프).
//   보이는 얼굴 우선순위: 말하는 사람 → 발표자 → 나머지. 개수는 state라 공유 소스가 바뀌어도 유지된다.
// 발표자료 공유 = 업로드 PDF를 페이지 이미지로 무대에 띄우고 페이지를 동기화(OS 화면공유 아님).
// '내 얼굴 숨기기'(hideSelf)는 내 화면에서만 내 타일을 뺀다 — 카메라는 계속 송출된다(로컬 뷰 설정).
// CRITICAL: 발화·역할·손들기·발표 표시는 색에만 의존하지 않는다 — 아이콘 + 텍스트 병행(R29). 토큰만(R20).

export interface RoomStageProps {
  members: LiveMember[];
  presenterId: string;
  currentMemberId: string;
  /** 손든 참가자 identity 집합. */
  hands: Set<string>;
  /** 화면공유/발표자료 주석(펜/레이저) — 부모(MeetRoom)가 데이터 채널로 모은 것. */
  annotations?: ActiveAnnotation[];
  /** 발표자가 그릴 때 호출(없으면 그리기 비활성). */
  onDraw?: (input: DrawInput) => void;
  /** 발표자료 공유 상태(있으면 화면공유보다 우선해 슬라이드 무대를 띄운다). */
  present?: PresentState | null;
  /** 발표자가 페이지를 넘길 때 호출(없으면 시청자 — 따라가기만). */
  onChangePage?: (page: number) => void;
  /** 내 화면에서만 내 타일을 숨긴다(로컬 뷰 설정) — 카메라는 계속 송출되어 상대에겐 그대로 보인다. */
  hideSelf?: boolean;
}

interface StripParticipant {
  identity: string;
  name?: string;
  isSpeaking?: boolean;
}

/**
 * 사이드 스트립 정렬: 말하는 사람 → 발표자 → 나머지. 동점이면 원래 순서를 보존(안정 정렬).
 */
export function orderParticipantsForStrip<P extends StripParticipant>(
  participants: P[],
  presenterId: string,
): P[] {
  const score = (p: P) =>
    (p.isSpeaking ? 2 : 0) + (p.identity === presenterId ? 1 : 0);
  return participants
    .map((p, i) => ({ p, i }))
    .sort((a, b) => score(b.p) - score(a.p) || a.i - b.i)
    .map((x) => x.p);
}

/** 방향키 한 번에 움직이는 거리(px). */
const MOVE_STEP = 24;

/**
 * 스트립 위치를 무대 컨테이너 안으로 제한한다.
 * 컨테이너를 잴 수 없으면(폭·높이 0) 상한을 두지 않고 음수만 막는다 — 좌상단에 못 박히는 걸 피한다.
 */
export function clampStripPos(
  pos: { x: number; y: number },
  size: { width: number; height: number },
  bounds: { width: number; height: number },
): { x: number; y: number } {
  const fit = (v: number, s: number, b: number) =>
    b > 0 ? Math.min(Math.max(0, v), Math.max(0, b - s)) : Math.max(0, v);
  return {
    x: fit(pos.x, size.width, bounds.width),
    y: fit(pos.y, size.height, bounds.height),
  };
}

export function RoomStage({
  members,
  presenterId,
  currentMemberId,
  hands,
  annotations,
  onDraw,
  present,
  onChangePage,
  hideSelf,
}: RoomStageProps) {
  const participants = useParticipants();
  const tracks = useTracks([Track.Source.Camera, Track.Source.ScreenShare]);

  const screenShare = tracks.find(
    (t) => t.source === Track.Source.ScreenShare && t.publication,
  );
  const cameraOf = (identity: string) =>
    tracks.find(
      (t) =>
        t.source === Track.Source.Camera &&
        t.publication &&
        t.participant?.identity === identity,
    );

  // 오른쪽 스트립에 보일 얼굴 수 — 공유 소스가 바뀌어도 유지(컴포넌트 state).
  const [visibleCount, setVisibleCount] = React.useState(2);
  // 전체화면 오버레이 스트립의 위치(px, 무대 컨테이너 기준). null이면 기본 자리(우측 세로 중앙).
  // StageShell은 공유 소스가 바뀌면 리마운트되므로 위치도 여기서 갖는다(visibleCount와 같은 이유).
  const [stripPos, setStripPos] = React.useState<{ x: number; y: number } | null>(
    null,
  );

  // 발표자 키보드 내비 — 발표 중(onChangePage 보유=발표자)일 때 ←/→로 페이지를 넘긴다.
  // 채팅 등 입력 중일 땐 무시한다(폼 요소 타깃). 범위 클램프는 호출부(changePage)가 한다.
  React.useEffect(() => {
    if (!present || !onChangePage) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const t = e.target as HTMLElement | null;
      // 스트립 이동 손잡이에 포커스가 있으면 방향키는 위치 이동용이다 — 페이지를 함께 넘기지 않는다.
      // 타깃이 window/document면 closest가 없으므로 옵셔널 호출로 방어한다.
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable ||
          t.closest?.("[data-strip-handle]"))
      )
        return;
      e.preventDefault();
      onChangePage(present.page + (e.key === "ArrowRight" ? 1 : -1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [present, onChangePage]);

  const isPresenterView = currentMemberId === presenterId;
  const nameOf = (identity: string) =>
    members.find((m) => m.id === identity)?.name ?? "발표자";

  const renderTile = (p: StripParticipant) => {
    const member = members.find((m) => m.id === p.identity);
    return (
      <ParticipantTile
        key={p.identity}
        identity={p.identity}
        member={
          member ?? {
            id: p.identity,
            name: p.name || p.identity,
            initial: (p.name || p.identity).slice(0, 1).toUpperCase(),
            color: "var(--fg-faint)",
          }
        }
        cameraTrack={cameraOf(p.identity)}
        isPresenter={p.identity === presenterId}
        isSelf={p.identity === currentMemberId}
        speaking={!!p.isSpeaking}
        handUp={hands.has(p.identity)}
      />
    );
  };

  // 내 얼굴 숨기기 — 내 화면에서만 뺀다(상대에겐 그대로 보인다). 그리드·스트립·개수 한도에 모두 적용.
  const visible = hideSelf
    ? participants.filter((p) => p.identity !== currentMemberId)
    : participants;

  const stripTiles = orderParticipantsForStrip(visible, presenterId)
    .slice(0, Math.min(visibleCount, visible.length))
    .map(renderTile);

  return (
    <div className="flex flex-col gap-3">
      {/* 음성 재생(트랙 구독). 화면엔 보이지 않는다. */}
      <RoomAudioRenderer />

      {present ? (
        // 발표자료 공유 — 화면공유보다 우선. 슬라이드 이미지 + 페이지 네비.
        <StageShell
          presenterName={nameOf(presenterId)}
          isPresenter={isPresenterView}
          annotations={annotations ?? []}
          onDraw={onDraw}
          count={visibleCount}
          max={visible.length}
          onCountChange={setVisibleCount}
          pos={stripPos}
          onPosChange={setStripPos}
          main={<PresentImage present={present} />}
          topCenter={
            <PageNav
              page={present.page}
              pageCount={present.pageCount}
              onChange={onChangePage}
            />
          }
        >
          {stripTiles}
        </StageShell>
      ) : screenShare ? (
        <StageShell
          presenterName={nameOf(screenShare.participant?.identity ?? presenterId)}
          isPresenter={isPresenterView}
          annotations={annotations ?? []}
          onDraw={onDraw}
          count={visibleCount}
          max={visible.length}
          onCountChange={setVisibleCount}
          pos={stripPos}
          onPosChange={setStripPos}
          main={
            <VideoTrack trackRef={screenShare} className="size-full object-contain" />
          }
        >
          {stripTiles}
        </StageShell>
      ) : hideSelf && visible.length === 0 ? (
        // 나 혼자인데 내 얼굴을 숨긴 상태 — 빈 화면 대신 이유를 알려준다(R30).
        <p className="rounded-lg border border-border-token bg-bg-subtle px-4 py-10 text-center text-[13px] text-fg-subtle">
          내 얼굴을 숨겼어요. 친구들이 들어오면 여기에 보여요.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {visible.map(renderTile)}
        </div>
      )}
    </div>
  );
}

/**
 * 공유 무대 셸 — 공유 콘텐츠(영상/슬라이드, 크게) + 얼굴 스트립 + 주석. 전체화면 토글을 소유한다.
 * 화면공유·발표자료 공유가 공유(main)만 다르고 나머지(얼굴·주석·전체화면)는 동일하므로 공통화했다.
 * 전체화면에선 main이 화면을 채우고 얼굴 스트립은 우측 오버레이로 떠 따라온다.
 * 좌표 정규화(annotation-overlay)는 박스 기준이라 전체화면/슬라이드에서도 모두에게 같은 위치.
 * 그리기는 발표자만(onDraw 유무) — 시청자는 전체화면으로 크게 보기만(R7).
 */
function StageShell({
  presenterName,
  isPresenter,
  annotations,
  onDraw,
  count,
  max,
  onCountChange,
  pos,
  onPosChange,
  main,
  topCenter,
  children,
}: {
  presenterName: string;
  isPresenter: boolean;
  annotations: ActiveAnnotation[];
  onDraw?: (input: DrawInput) => void;
  count: number;
  max: number;
  onCountChange: (n: number) => void;
  /** 전체화면 오버레이 스트립의 위치(px). null이면 기본 자리. */
  pos: { x: number; y: number } | null;
  onPosChange: (p: { x: number; y: number }) => void;
  /** 무대 중앙 콘텐츠 — 화면공유 영상 또는 발표자료 페이지 이미지. */
  main: React.ReactNode;
  /** 무대 상단 중앙 오버레이(발표자료 페이지 네비 등). 없으면 미표시. */
  topCenter?: React.ReactNode;
  children: React.ReactNode;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [isFs, setIsFs] = React.useState(false);

  React.useEffect(() => {
    const el = containerRef.current;
    const onChange = () => setIsFs(document.fullscreenElement === el);
    document.addEventListener("fullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      // 공유 종료 등으로 언마운트될 때 이 컨테이너가 전체화면이면 해제.
      if (document.fullscreenElement === el) void document.exitFullscreen?.();
    };
  }, []);

  const toggleFs = () => {
    if (document.fullscreenElement) void document.exitFullscreen?.();
    else void containerRef.current?.requestFullscreen?.(); // 미지원 → no-op
  };

  return (
    <div
      ref={containerRef}
      className={cn("flex gap-3", isFs && "relative h-screen w-screen bg-black")}
    >
      {/* 공유 콘텐츠 + 발표 중 라벨 + 페이지 네비 + 전체화면 토글 + 주석 */}
      <div
        className={cn(
          "relative overflow-hidden",
          isFs
            ? "absolute inset-0"
            : "min-w-0 flex-1 rounded-lg border border-border-token",
        )}
      >
        <div
          className={cn(
            "grid place-items-center",
            isFs ? "size-full bg-black" : "aspect-video bg-bg-subtle",
          )}
        >
          {main}
        </div>
        <PresentingLabel name={presenterName} />
        {topCenter}
        <FsButton isFs={isFs} onClick={toggleFs} />
        <AnnotationOverlay
          isPresenter={isPresenter}
          annotations={annotations}
          onDraw={onDraw}
        />
      </div>

      {/* 얼굴 스트립 — 일반은 우측 컬럼, 전체화면은 우측 오버레이로 따라온다 */}
      <FaceStrip
        count={count}
        max={max}
        onCountChange={onCountChange}
        floating={isFs}
        pos={pos}
        onPosChange={onPosChange}
      >
        {children}
      </FaceStrip>
    </div>
  );
}

/** 발표자료 페이지 이미지 — 인증 자산 라우트라 next/image(서버 최적화)는 부적합, 일반 img(쿠키 전송). */
function PresentImage({ present }: { present: PresentState }) {
  // 인접 페이지 프리로드 — 다음/이전을 미리 받아 두면(서버 렌더 + 라우트 캐시 max-age=3600)
  // 발표자가 넘길 때(또는 시청자가 따라갈 때) 페이지가 바로 뜬다.
  React.useEffect(() => {
    for (const n of [present.page + 1, present.page - 1]) {
      if (n >= 1 && n <= present.pageCount) {
        const img = new Image();
        img.src = `/api/presentations/${present.presentationId}/pages/${n}`;
      }
    }
  }, [present.presentationId, present.page, present.pageCount]);

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/presentations/${present.presentationId}/pages/${present.page}`}
      alt={`발표자료 ${present.page}페이지`}
      className="size-full object-contain"
    />
  );
}

/**
 * 발표자료 페이지 네비 — 무대 상단 중앙. 발표자(onChange 있음)는 이전/다음, 시청자는 위치 표시만.
 * 색만이 아니라 아이콘+텍스트(R29).
 */
function PageNav({
  page,
  pageCount,
  onChange,
}: {
  page: number;
  pageCount: number;
  onChange?: (page: number) => void;
}) {
  const label = `${page} / ${pageCount}`;
  if (!onChange) {
    return (
      <span className="absolute top-2 left-1/2 z-20 -translate-x-1/2 rounded-md bg-bg-elevated/90 px-2.5 py-1 font-mono text-[12px] tabular-nums text-fg-muted shadow-[var(--shadow-sm)]">
        {label}
      </span>
    );
  }
  return (
    <div className="pointer-events-auto absolute top-2 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-md bg-bg-elevated/90 px-1 py-0.5 shadow-[var(--shadow-sm)]">
      <button
        type="button"
        aria-label="이전 페이지"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
        className="grid size-7 place-items-center rounded-sm text-fg-muted hover:bg-bg-hover hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent"
      >
        <ChevronLeft size={15} aria-hidden="true" />
      </button>
      <span className="min-w-12 text-center font-mono text-[12px] tabular-nums text-fg-muted">
        {label}
      </span>
      <button
        type="button"
        aria-label="다음 페이지"
        disabled={page >= pageCount}
        onClick={() => onChange(page + 1)}
        className="grid size-7 place-items-center rounded-sm text-fg-muted hover:bg-bg-hover hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent"
      >
        <ChevronRight size={15} aria-hidden="true" />
      </button>
    </div>
  );
}

/** 전체화면 토글 — 공유 화면 우상단. 색만이 아니라 아이콘+레이블(R29). */
function FsButton({ isFs, onClick }: { isFs: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={isFs ? "전체화면 종료" : "전체화면"}
      onClick={onClick}
      className="absolute top-2 right-2 z-20 grid size-8 place-items-center rounded-md bg-bg-elevated/90 text-fg-muted shadow-[var(--shadow-sm)] hover:bg-bg-hover hover:text-fg"
    >
      {isFs ? (
        <Minimize size={15} aria-hidden="true" />
      ) : (
        <Maximize size={15} aria-hidden="true" />
      )}
    </button>
  );
}

/** 공유 화면 위 '발표 중' 라벨 — 색 알약 + 텍스트(R29), 토큰만(R20). */
function PresentingLabel({ name }: { name: string }) {
  return (
    <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-[10px] bg-busy px-2 py-0.5 text-[11px] font-semibold text-accent-fg">
      <Radio size={11} aria-hidden="true" />
      {name}님이 발표 중
    </span>
  );
}

/**
 * 오른쪽 얼굴 스트립 + 표시 개수 −/+ 조절. 0..max(참가자 수). 0이면 헤더만 남는다.
 * 전체화면(floating)일 땐 공유 화면 위에 떠서 슬라이드를 가리므로, 손잡이로 원하는 자리에 옮길 수 있다.
 * 일반(옆 컬럼)일 땐 무대를 가리지 않으므로 이동이 필요 없다 — 손잡이도 없다.
 */
function FaceStrip({
  count,
  max,
  onCountChange,
  floating = false,
  pos,
  onPosChange,
  children,
}: {
  count: number;
  max: number;
  onCountChange: (n: number) => void;
  /** 전체화면일 때 공유 화면 위 우측 오버레이로 띄운다(가독성 위해 반투명 배경). */
  floating?: boolean;
  /** 오버레이 위치(px, 컨테이너 기준). null이면 기본 자리(우측 세로 중앙). */
  pos?: { x: number; y: number } | null;
  onPosChange?: (p: { x: number; y: number }) => void;
  children: React.ReactNode;
}) {
  const clamped = Math.min(Math.max(0, count), Math.max(0, max));
  const ref = React.useRef<HTMLDivElement>(null);
  const dragRef = React.useRef<{
    startX: number;
    startY: number;
    origin: { x: number; y: number };
  } | null>(null);
  const movable = floating && !!onPosChange;

  const parentOf = () => ref.current?.offsetParent as HTMLElement | null;

  // 현재 위치(컨테이너 기준 px). pos가 없으면 기본 자리를 실측해 이동 시작점으로 쓴다.
  function originOf(): { x: number; y: number } {
    if (pos) return pos;
    const el = ref.current;
    const parent = parentOf();
    if (!el || !parent) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    const pr = parent.getBoundingClientRect();
    return { x: r.left - pr.left, y: r.top - pr.top };
  }

  function moveTo(x: number, y: number) {
    const el = ref.current;
    const parent = parentOf();
    onPosChange?.(
      clampStripPos(
        { x, y },
        { width: el?.offsetWidth ?? 0, height: el?.offsetHeight ?? 0 },
        { width: parent?.clientWidth ?? 0, height: parent?.clientHeight ?? 0 },
      ),
    );
  }

  function onPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (!movable) return;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origin: originOf(),
    };
    // 포인터 캡처가 없는 환경에서도 드래그 자체는 동작한다.
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    const d = dragRef.current;
    if (!d) return;
    moveTo(
      d.origin.x + (e.clientX - d.startX),
      d.origin.y + (e.clientY - d.startY),
    );
  }

  function endDrag(e: React.PointerEvent<HTMLButtonElement>) {
    dragRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  }

  // 드래그만 지원하면 키보드 사용자가 못 옮긴다 — 방향키로도 같은 이동을 제공한다.
  function onKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-MOVE_STEP, 0],
      ArrowRight: [MOVE_STEP, 0],
      ArrowUp: [0, -MOVE_STEP],
      ArrowDown: [0, MOVE_STEP],
    };
    const d = delta[e.key];
    if (!d || !movable) return;
    e.preventDefault();
    const o = originOf();
    moveTo(o.x + d[0], o.y + d[1]);
  }

  return (
    <div
      ref={ref}
      data-face-strip=""
      className={cn(
        "flex shrink-0 flex-col gap-2",
        // 0명이면 폭도 접는다 — 무대를 넓히는 게 접기의 목적이다.
        clamped === 0 ? "w-auto" : "w-40 sm:w-44",
        floating &&
          "absolute z-10 max-h-[calc(100vh-1.5rem)] rounded-lg bg-bg-elevated/85 p-2 backdrop-blur",
        // 아직 옮기지 않았으면 기존 기본 자리(우측 세로 중앙).
        floating && !pos && "top-1/2 right-3 -translate-y-1/2",
      )}
      style={floating && pos ? { left: pos.x, top: pos.y } : undefined}
    >
      <div className="flex items-center justify-between gap-1 rounded-md bg-bg-subtle px-2 py-1">
        {movable && (
          <button
            type="button"
            data-strip-handle=""
            aria-label="얼굴 위치 옮기기(드래그 또는 방향키)"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={onKeyDown}
            className="grid size-6 shrink-0 cursor-grab touch-none place-items-center rounded-sm text-fg-subtle hover:bg-bg-hover hover:text-fg"
          >
            <GripVertical size={13} aria-hidden="true" />
          </button>
        )}
        <span className="text-[11px] font-medium text-fg-subtle">
          얼굴 {clamped}
        </span>
        <span className="flex items-center gap-0.5">
          <StepButton
            label="얼굴 수 줄이기"
            disabled={clamped <= 0}
            onClick={() => onCountChange(clamped - 1)}
          >
            <Minus size={13} aria-hidden="true" />
          </StepButton>
          <StepButton
            label="얼굴 수 늘리기"
            disabled={clamped >= max}
            onClick={() => onCountChange(clamped + 1)}
          >
            <Plus size={13} aria-hidden="true" />
          </StepButton>
        </span>
      </div>
      {/* 0명이면 목록 자체를 접는다 — 헤더(−/+)는 남겨야 다시 늘릴 수 있다. */}
      {clamped > 0 && (
        <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto">
          {children}
        </div>
      )}
    </div>
  );
}

function StepButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-6 place-items-center rounded-sm text-fg-muted hover:bg-bg-hover hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

/** 참가자 타일 — 카메라 트랙이 있으면 비디오, 없으면 아바타. 발화/손들기는 색+텍스트(R29). */
function ParticipantTile({
  identity,
  member,
  cameraTrack,
  isPresenter,
  isSelf,
  speaking,
  handUp,
}: {
  identity: string;
  member: LiveMember;
  cameraTrack: TrackReference | undefined;
  isPresenter: boolean;
  isSelf: boolean;
  speaking: boolean;
  handUp: boolean;
}) {
  return (
    <div
      data-identity={identity}
      className={cn(
        "relative overflow-hidden rounded-lg border bg-bg-subtle",
        speaking ? "border-online ring-2 ring-online/40" : "border-border-token",
      )}
    >
      <div className="grid aspect-video place-items-center">
        {cameraTrack ? (
          <VideoTrack trackRef={cameraTrack} className="size-full object-cover" />
        ) : (
          <Avatar user={member} size="xl" />
        )}
      </div>

      {/* 손든 참가자 — 색+아이콘+텍스트 병행(R29) */}
      {handUp && (
        <span className="absolute top-1.5 left-1.5 inline-flex items-center gap-1 rounded-[10px] bg-away/20 px-1.5 py-0.5 text-[11px] font-medium text-away">
          <Hand size={11} aria-hidden="true" />손
        </span>
      )}

      {/* 하단 오버레이: 이름 + 발화 + 역할(색+텍스트 병행, R29) */}
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-[color-mix(in_oklch,var(--bg)_55%,transparent)] px-2 py-1.5">
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-fg">
          {member.name}
          {isSelf && <span className="ml-1 text-fg-subtle">(나)</span>}
        </span>
        {speaking && (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-online">
            <Mic size={11} aria-hidden="true" />
            말하는 중
          </span>
        )}
        {isPresenter ? (
          <Badge variant="admin">
            <Radio size={11} aria-hidden="true" />
            발표자
          </Badge>
        ) : (
          <Badge variant="member">시청자</Badge>
        )}
      </div>
    </div>
  );
}
