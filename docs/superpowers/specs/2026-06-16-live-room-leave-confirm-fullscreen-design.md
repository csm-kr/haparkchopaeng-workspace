# 라이브 룸 — 나가기 확인 + 화면공유 전체화면 발표 모드 설계

- 날짜: 2026-06-16
- 상태: 승인됨 (구현 진행)
- 관련: `phases/7-live-conference`(완료 — LiveKit 다자간), 화면공유 주석/얼굴 스트립(최근 커밋 `2feaef0`·`c34fc7b`)

## 배경 / 목표

LiveKit 화상 룸에 두 가지를 더한다. 둘 다 **룸 UI 한정** 변경(서버·LiveKit·DB 무변경).

1. **(A) 나가기 확인** — 지금 시청자 `나가기`는 확인 없이 즉시 퇴장한다(`live-room.tsx`의 `handleLeave`가 버튼에 직결). 실수 방지용 확인 게이트를 둔다. 발표자 `라이브 종료`만 확인 다이얼로그(`ConfirmEndDialog`)가 있다.
2. **(B) 전체화면 발표 모드** — 화면공유 시 공유 화면·얼굴 스트립·펜/레이저 주석은 **일반 페이지 레이아웃 안의 DOM 오버레이로만** 존재한다(전체화면/팝아웃 없음). 공유 화면을 전체화면으로 키워도 얼굴과 주석이 **따라오고 그대로 작동**하게 한다.

## 범위

**In**
- (A) 시청자 `나가기`에 확인 다이얼로그. `ConfirmEndDialog`를 범용 `ConfirmDialog`로 일반화해 종료/나가기 공용.
- (B) 공유 화면 패널에 **전체화면 토글 버튼**. 전체화면에서 영상이 화면을 채우고, 얼굴 스트립(−/+ 포함)·펜/레이저 툴바·주석이 위에 떠 그대로 동작.
- (B) 화면공유 블록을 `ScreenShareStage` 하위 컴포넌트로 추출(현재 `room-stage.tsx`가 grid+공유를 한 파일에 다 들고 있어 큼 — 공유 쪽만 분리).

**Out (이번 범위 아님)**
- 전체화면 안 하단 컨트롤바(마이크/카메라/나가기) 노출 — 발표 화면+얼굴+그리기 툴바만(선택하신 목업대로). 추후 옵션.
- 시청자 그리기 — 펜/레이저는 **발표자만**(현행 유지, R7).
- 새 창/PiP 팝아웃, 공유 스트림에 합성(브레인스토밍에서 제외).
- 구형 Safari `webkit-` 프리픽스 전체화면(현대 브라우저 타깃, 미지원 시 graceful no-op).

## 아키텍처 (델타)

| 파일 | 변경 |
|---|---|
| `components/live/live-room.tsx` | `confirmLeave` 상태 + 나가기 확인 게이트. `ConfirmEndDialog` → 범용 `ConfirmDialog`(title/body/confirmLabel/variant/busy)로 일반화, 종료·나가기 공용 |
| `components/live/room-stage.tsx` | 화면공유 블록을 `ScreenShareStage`로 추출 + 전체화면 토글/레이아웃. grid 분기·`orderParticipantsForStrip`·`ParticipantTile`은 유지 |
| `components/live/__tests__/live-room.test.tsx` | 나가기 확인 흐름 테스트 보강 |
| `components/live/__tests__/room-stage.test.tsx` | 전체화면 버튼/레이아웃 테스트 보강 |

**안 건드림:** 서버 라우트(`/leave` 등)·LiveKit·`meet-room.tsx`(주석 데이터 채널)·`annotation-overlay.tsx`(좌표 정규화가 전체화면에서도 그대로 맞음). `meet-controls.tsx` 무변경.

## (A) 나가기 확인

`ConfirmEndDialog`(종료 전용)를 범용화해 둘이 공유한다. 나가기는 **비파괴적**이지만 사용자 요청에 따라 확인을 둔다(종료 다이얼로그와 동일 패턴, R27의 확장).

```tsx
// live-room.tsx (일반화)
function ConfirmDialog({
  title, body, confirmLabel, variant = "danger", busy = false, onCancel, onConfirm,
}: { title: string; body: string; confirmLabel: string;
     variant?: "danger" | "primary"; busy?: boolean;
     onCancel: () => void; onConfirm: () => void }) { /* 기존 ConfirmEndDialog 마크업 재사용 */ }
```

- 상태 `confirmLeave` 추가. `나가기` 버튼 `onClick`을 `handleLeave` 직결 → `setConfirmLeave(true)`로 교체.
- 확인 시 `handleLeave()` 후 닫기. 카피: 제목 **"라이브에서 나갈까요?"**, 본문 **"언제든 다시 입장할 수 있어요."**, 확인 **"나갈게요"**, variant=`primary`(비파괴적).
- 종료 다이얼로그는 같은 `ConfirmDialog`에 종료 카피·`variant="danger"`·`busy={ending}`로 렌더(동작 보존).

## (B) 전체화면 발표 모드 — `ScreenShareStage`

현재 `room-stage.tsx`의 `screenShare ? (...)` 블록을 컴포넌트로 추출하고 전체화면 상태를 그 안에 둔다. 얼굴 스트립 개수(`visibleCount`)도 이 컴포넌트가 소유(현 동작 유지).

**전체화면 토글** — 표준 Fullscreen API. 컨테이너(영상+스트립을 함께 감싼 root)를 전체화면으로 만든다.

```tsx
const containerRef = React.useRef<HTMLDivElement>(null);
const [isFs, setIsFs] = React.useState(false);
React.useEffect(() => {
  const onChange = () => setIsFs(document.fullscreenElement === containerRef.current);
  document.addEventListener("fullscreenchange", onChange);
  return () => document.removeEventListener("fullscreenchange", onChange);
}, []);
const toggleFs = () => {
  if (document.fullscreenElement) void document.exitFullscreen?.();
  else void containerRef.current?.requestFullscreen?.(); // 미지원 → no-op(graceful)
};
```

**레이아웃** — `isFs`로 클래스 분기. 좌표 정규화(`getBoundingClientRect`)는 박스 기준이라 전체화면에서도 모두에게 같은 위치(주석 코드 무변경).

- 일반: 현재 그대로 — `flex gap-3`(영상 패널 `flex-1` + 얼굴 스트립 side column).
- 전체화면: 컨테이너 `h-screen w-screen bg-black`. 영상 패널 **풀블리드**(`absolute inset-0`, `object-contain`), 얼굴 스트립은 **우측 상단 오버레이**(`absolute right-3 top-3 z-10`, 반투명 배경으로 영상 위 가독성 확보). 주석 SVG/툴바(`annotation-overlay.tsx`)는 영상 패널 자식이라 그대로 위에 깔린다.
- 전체화면 버튼: 영상 패널 **우상단**(`PresentingLabel`은 좌상단). `pointer-events-auto`, 발표자·시청자 모두 노출. aria-label `전체화면`/`전체화면 종료`, 아이콘 `Maximize`/`Minimize`(lucide).

**z-순서/이벤트** — 얼굴 스트립 오버레이(우상단)와 주석 툴바(하단중앙)는 위치가 겹치지 않는다. 주석 SVG는 그리기 중(발표자+도구 on)에만 포인터를 잡으므로(`pointerEvents` 조건부) 스트립 −/+ 버튼과 충돌 없음.

**생명주기** — 화면공유가 끝나면 부모(`RoomStage`)가 grid로 다시 렌더 → `ScreenShareStage` 언마운트 → 브라우저가 전체화면 자동 해제. 방어적으로 언마운트 cleanup에서 `document.fullscreenElement === containerRef.current`면 `exitFullscreen()`.

## 흐름

1. **나가기:** 시청자 `나가기` 클릭 → 확인 다이얼로그 → `나갈게요` → 기존 `handleLeave`(`/leave` POST + `left` 전환). 발표자는 기존 `라이브 종료`(무변경).
2. **전체화면:** 공유 중 영상 패널 우상단 버튼 클릭(사용자 제스처) → 컨테이너 전체화면 → 영상 풀블리드 + 얼굴 우상단 + (발표자) 펜/레이저 그대로. ESC 또는 버튼으로 해제. 공유 종료 시 자동 해제.

## 테스트 (TDD — 먼저 작성)

JSDOM은 Fullscreen API 미구현 → `Element.prototype.requestFullscreen`/`document.exitFullscreen`/`document.fullscreenElement`를 목으로 주입하고 `fullscreenchange` 디스패치로 상태 전이를 흉내낸다.

- `live-room.test.tsx`(보강):
  - 시청자 `나가기` 클릭 → 확인 다이얼로그 노출, **즉시 퇴장 안 함**(leave fetch 미호출).
  - `취소` → 룸 유지. `나갈게요` → `/leave` 경로/`left` 전환(기존 동작).
  - 발표자 뷰엔 `나가기` 대신 `라이브 종료`(회귀 확인).
- `room-stage.test.tsx`(보강):
  - 화면공유 시 전체화면 버튼 노출(발표자·시청자 모두).
  - 클릭 → `requestFullscreen` 호출. `fullscreenchange`로 `isFs` 진입 시 얼굴 스트립·주석 오버레이 여전히 렌더(발표자는 `onDraw` 존재).
  - 전체화면에서 −/+ 가 동작(개수 클램프 유지).

## 구현 순서 (각 단계 RED→GREEN)

1. `live-room.tsx` — `ConfirmDialog` 일반화 + 나가기 확인(테스트 먼저). 종료 회귀 그린 유지.
2. `room-stage.tsx` — `ScreenShareStage` 추출(동작 보존, 기존 `room-stage.test.tsx` 그린 유지).
3. `room-stage.tsx` — 전체화면 토글/레이아웃 + 버튼(테스트 먼저).
4. 전체 `tsc`/`vitest`/`lint` 그린 + (영향 시) E2E 확인.

## 커밋 정책

사용자가 지시할 때, 위 델타 파일 경로만 스테이징해 단독 커밋. conventional commits(`feat(live): …`). 그 전까지 미커밋 유지.

## 가정 / 미해결

- 표준 Fullscreen API(unprefixed) 가정. 미지원 브라우저는 버튼 no-op(옵셔널 체이닝) — 룸은 정상.
- 전체화면엔 마이크/카메라/나가기 컨트롤바 미포함(목업대로). 마이크 토글만 얹는 건 추후 옵션.
- 얼굴 스트립 −/+ 한도는 참가자 수(기존 유지). 오버레이 반투명 배경 토큰은 기존 색 토큰(R20)만 사용.
