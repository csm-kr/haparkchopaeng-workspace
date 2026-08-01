# 라이브 내 얼굴 숨기기 & 얼굴 스트립 접기·이동 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 라이브 룸에서 (1) 내 화면에서만 내 얼굴을 숨기고, (2) 발표 중 얼굴 스트립을 0명까지 접고, (3) 전체화면에서 스트립을 원하는 자리로 옮길 수 있게 한다.

**Architecture:** 세 기능 모두 **클라이언트 로컬 뷰 상태**다 — LiveKit 데이터 채널로 전파하지 않고 서버·DB도 건드리지 않는다. `hideSelf`는 무대(`RoomStage`)와 컨트롤바(`MeetControls`)의 공통 조상인 `MeetRoom`이 소유하고, 스트립의 표시 개수·위치는 공유 소스가 바뀌어도 살아남도록 `RoomStage`가 소유한다(`StageShell`은 발표자료↔화면공유 전환 시 리마운트된다).

**Tech Stack:** Next.js 15 App Router · React 19 · TypeScript · Tailwind v4(디자인 토큰) · `@livekit/components-react` · `lucide-react` · Vitest + @testing-library/react (jsdom)

## Global Constraints

- 코드를 제외한 설명·주석은 **한국어**로 작성한다. 코드·식별자는 원문 유지.
- **TDD**: 각 태스크는 실패하는 테스트 → 최소 구현 → 통과 → 커밋 순서로 진행한다.
- **Surgical**: 요청과 무관한 인접 코드·주석·포매팅을 손대지 않는다. 기존 스타일(주석 톤, `cn()`, `CtrlButton`/`StepButton` 재사용)을 따른다.
- **R29(색 단독 금지)**: 상태 표시는 색만이 아니라 아이콘 + 텍스트를 병행한다.
- **R20(토큰만)**: 색상은 하드코딩하지 말고 기존 토큰 클래스(`text-fg-subtle`, `bg-bg-subtle`, `border-border-token` 등)만 쓴다.
- **R30(따뜻한 안내)**: 사용자에게 보이는 문구는 사람 말로 쓴다.
- 데이터 채널(`publishData`)로 새 메시지 종류를 추가하지 않는다. `lib/live-messages.ts`는 **수정하지 않는다**.
- 테스트 명령: `npm test -- components/live/__tests__/<파일>` (전체는 `npm test`). 린트: `npm run lint`.

## File Structure

| 파일 | 책임 | 변경 |
|---|---|---|
| `components/live/room-stage.tsx` | 무대 렌더 — 그리드/공유 무대, 얼굴 스트립(개수·위치), 전체화면 | 수정 (Task 1·2·4) |
| `components/live/meet-controls.tsx` | 컨트롤바 버튼 | 수정 (Task 3) |
| `components/live/meet-room.tsx` | 룸 셸 — 무대·컨트롤바 공통 상태 소유 | 수정 (Task 3) |
| `components/live/__tests__/room-stage.test.tsx` | 무대 단위 테스트 | 수정 (Task 1·2·4) |
| `components/live/__tests__/meet-controls.test.tsx` | 컨트롤바 단위 테스트 | 수정 (Task 3) |
| `components/live/__tests__/meet-room.test.tsx` | 룸 통합 테스트 | 수정 (Task 3) |

새로 만드는 파일은 없다. `room-stage.tsx`는 현재 541줄이고 이번 변경으로 ~120줄 늘어나지만, 스트립·무대·타일이 한 화면의 한 가지 관심사라 분리하지 않는다(기존 구조 유지).

---

### Task 1: 얼굴 스트립을 0명까지 접기

**Files:**
- Modify: `components/live/room-stage.tsx:400-450` (`FaceStrip`)
- Test: `components/live/__tests__/room-stage.test.tsx`

**Interfaces:**
- Consumes: 없음(기존 `FaceStrip({ count, max, onCountChange, floating, children })`)
- Produces: `FaceStrip`의 클램프 하한이 `0`. `count === 0`이면 타일 목록 컨테이너를 렌더하지 않고 헤더만 남긴다. 이후 태스크는 이 헤더가 항상 존재한다고 가정한다.

- [ ] **Step 1: 실패하는 테스트를 작성한다**

`components/live/__tests__/room-stage.test.tsx`의 `describe("RoomStage 화면공유", ...)` 블록 안, `"기본 2명 표시 + '+'로 늘리고 '−'로 줄인다"` 테스트 **바로 뒤에** 추가한다.

```tsx
  it("'−'로 0명까지 접으면 얼굴이 사라지고 헤더만 남는다", () => {
    lk.participants = [{ identity: "jo" }, { identity: "ha" }, { identity: "bak" }];
    lk.tracks = [share()];
    const { container } = renderStage();

    const minus = screen.getByRole("button", { name: "얼굴 수 줄이기" });
    fireEvent.click(minus); // 2 → 1
    fireEvent.click(minus); // 1 → 0

    expect(container.querySelectorAll("[data-identity]")).toHaveLength(0);
    // 헤더는 남아 있어야 다시 늘릴 수 있다.
    expect(screen.getByText(/얼굴 0/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "얼굴 수 줄이기" })).toBeDisabled();
  });

  it("0명에서 '+'를 누르면 다시 1명이 보인다", () => {
    lk.participants = [{ identity: "jo" }, { identity: "ha" }, { identity: "bak" }];
    lk.tracks = [share()];
    const { container } = renderStage();

    const minus = screen.getByRole("button", { name: "얼굴 수 줄이기" });
    fireEvent.click(minus);
    fireEvent.click(minus);
    expect(container.querySelectorAll("[data-identity]")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "얼굴 수 늘리기" }));
    expect(container.querySelectorAll("[data-identity]")).toHaveLength(1);
  });
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `npm test -- components/live/__tests__/room-stage.test.tsx`
Expected: FAIL — 두 번째 `−` 클릭이 무시되어 타일이 1개 남고, `얼굴 0` 텍스트를 찾지 못한다.

- [ ] **Step 3: 최소 구현 — `FaceStrip`의 하한을 0으로 내리고 0일 때 목록을 숨긴다**

`components/live/room-stage.tsx`의 `FaceStrip` 본문에서 아래 3곳을 바꾼다.

(a) 클램프 하한 `1` → `0`:

```tsx
  const clamped = Math.min(Math.max(0, count), Math.max(0, max));
```

(b) 루트 `div`의 className — 0명일 땐 폭을 차지하지 않게 한다(무대를 넓히는 게 요청의 목적):

```tsx
    <div
      className={cn(
        "flex shrink-0 flex-col gap-2",
        clamped === 0 ? "w-auto" : "w-40 sm:w-44",
        floating &&
          "absolute top-1/2 right-3 z-10 max-h-[calc(100vh-1.5rem)] -translate-y-1/2 rounded-lg bg-bg-elevated/85 p-2 backdrop-blur",
      )}
    >
```

(c) `−` 버튼의 `disabled` 조건과 타일 목록 렌더:

```tsx
          <StepButton
            label="얼굴 수 줄이기"
            disabled={clamped <= 0}
            onClick={() => onCountChange(clamped - 1)}
          >
            <Minus size={13} aria-hidden="true" />
          </StepButton>
```

```tsx
      {/* 0명이면 목록 자체를 접는다 — 헤더(−/+)는 남겨야 다시 늘릴 수 있다. */}
      {clamped > 0 && (
        <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto">
          {children}
        </div>
      )}
```

또한 `FaceStrip`의 JSDoc 주석을 사실에 맞게 고친다:

```tsx
/** 오른쪽 얼굴 스트립 + 표시 개수 −/+ 조절. 0..max(참가자 수). 0이면 헤더만 남는다. */
```

- [ ] **Step 4: 테스트를 돌려 통과를 확인한다**

Run: `npm test -- components/live/__tests__/room-stage.test.tsx`
Expected: PASS — 기존 테스트("기본 2명 표시 + '+'로 늘리고 '−'로 줄인다" 포함) 전부 통과.

- [ ] **Step 5: 커밋**

```bash
git add components/live/room-stage.tsx components/live/__tests__/room-stage.test.tsx
git commit -m "feat(live): 얼굴 스트립을 0명까지 접을 수 있게"
```

---

### Task 2: 내 얼굴 숨기기 — 무대에서 내 타일 제외

**Files:**
- Modify: `components/live/room-stage.tsx:39-203` (`RoomStageProps`, `RoomStage` 본문)
- Test: `components/live/__tests__/room-stage.test.tsx`

**Interfaces:**
- Consumes: Task 1의 `FaceStrip`(하한 0)
- Produces: `RoomStage`가 새 옵셔널 prop `hideSelf?: boolean`을 받는다. `true`면 그리드·스트립·개수 한도(`max`)에서 `currentMemberId`가 빠진다. Task 3이 이 prop을 넘긴다.

- [ ] **Step 1: 실패하는 테스트를 작성한다**

`components/live/__tests__/room-stage.test.tsx` 파일 맨 끝에 새 `describe` 블록을 추가한다. 기존 `renderStage()`는 `currentMemberId="ha"`(하수현)이므로, 숨김 대상은 `ha`다.

```tsx
describe("RoomStage 내 얼굴 숨기기", () => {
  function renderHidden(extra?: {
    present?: { presentationId: string; page: number; pageCount: number };
  }) {
    return render(
      <RoomStage
        members={members}
        presenterId="jo"
        currentMemberId="ha"
        hands={new Set()}
        hideSelf
        present={extra?.present}
      />,
    );
  }

  it("그리드에서 내 타일만 빠지고 친구들은 그대로 보인다", () => {
    lk.participants = [{ identity: "jo" }, { identity: "ha" }, { identity: "bak" }];
    const { container } = renderHidden();

    expect(container.querySelector('[data-identity="ha"]')).toBeNull();
    expect(container.querySelector('[data-identity="jo"]')).not.toBeNull();
    expect(container.querySelector('[data-identity="bak"]')).not.toBeNull();
  });

  it("발표 중 얼굴 스트립 후보에서도 내가 빠진다", () => {
    lk.participants = [{ identity: "jo" }, { identity: "ha" }, { identity: "bak" }];
    const { container } = renderHidden({
      present: { presentationId: "pres-1", page: 1, pageCount: 3 },
    });

    // 기본 2명: 숨기지 않았다면 jo(발표자)·ha 순서지만, 숨기면 jo·bak이 뜬다.
    expect(container.querySelectorAll("[data-identity]")).toHaveLength(2);
    expect(container.querySelector('[data-identity="ha"]')).toBeNull();
    expect(container.querySelector('[data-identity="bak"]')).not.toBeNull();
    // 개수 한도도 친구 수(2명) 기준 — 더 늘릴 수 없다.
    expect(screen.getByRole("button", { name: "얼굴 수 늘리기" })).toBeDisabled();
  });

  it("혼자 있는 방에서 숨기면 따뜻한 안내를 보여준다", () => {
    lk.participants = [{ identity: "ha" }];
    renderHidden();
    expect(screen.getByText(/내 얼굴을 숨겼어요/)).toBeInTheDocument();
  });

  it("숨기지 않으면 내 타일이 그대로 보인다", () => {
    lk.participants = [{ identity: "jo" }, { identity: "ha" }];
    const { container } = renderStage(); // hideSelf 없음
    expect(container.querySelector('[data-identity="ha"]')).not.toBeNull();
  });
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `npm test -- components/live/__tests__/room-stage.test.tsx`
Expected: FAIL — `hideSelf` prop이 없어 TypeScript 에러 또는 `[data-identity="ha"]`가 계속 존재.

- [ ] **Step 3: 최소 구현 — `hideSelf` prop과 `visible` 필터**

(a) `RoomStageProps`에 prop 추가 (`onChangePage` 아래):

```tsx
  /** 내 화면에서만 내 타일을 숨긴다(로컬 뷰 설정) — 카메라는 계속 송출되어 상대에겐 그대로 보인다. */
  hideSelf?: boolean;
```

(b) 구조 분해에 `hideSelf` 추가:

```tsx
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
```

(c) `stripTiles` 계산 **바로 위**에 필터를 두고, 스트립 계산을 `visible` 기준으로 바꾼다:

```tsx
  // 내 얼굴 숨기기 — 내 화면에서만 뺀다(상대에겐 그대로 보인다). 그리드·스트립·개수 한도에 모두 적용.
  const visible = hideSelf
    ? participants.filter((p) => p.identity !== currentMemberId)
    : participants;

  const stripTiles = orderParticipantsForStrip(visible, presenterId)
    .slice(0, Math.min(visibleCount, visible.length))
    .map(renderTile);
```

(d) 두 `StageShell`의 `max={participants.length}`를 `max={visible.length}`로 바꾼다(발표자료 분기·화면공유 분기 **둘 다**).

(e) 그리드 분기를 안내 문구 분기와 함께 바꾼다:

```tsx
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
```

(f) 파일 상단 주석 블록의 무대 설명에 한 줄 덧붙인다:

```
// '내 얼굴 숨기기'(hideSelf)는 내 화면에서만 내 타일을 뺀다 — 카메라는 계속 송출된다(로컬 뷰 설정).
```

- [ ] **Step 4: 테스트를 돌려 통과를 확인한다**

Run: `npm test -- components/live/__tests__/room-stage.test.tsx`
Expected: PASS — 새 4건 + 기존 전부 통과.

- [ ] **Step 5: 커밋**

```bash
git add components/live/room-stage.tsx components/live/__tests__/room-stage.test.tsx
git commit -m "feat(live): 무대에서 내 얼굴만 숨기는 hideSelf 옵션"
```

---

### Task 3: 컨트롤바 '내 얼굴' 버튼 + MeetRoom 배선

**Files:**
- Modify: `components/live/meet-controls.tsx:63-92` (props), `:215-233` 뒤(버튼 배치)
- Modify: `components/live/meet-room.tsx:91-106`(state), `:329-342`(RoomStage), `:406-417`(MeetControls)
- Test: `components/live/__tests__/meet-controls.test.tsx`, `components/live/__tests__/meet-room.test.tsx`

**Interfaces:**
- Consumes: Task 2의 `RoomStage`의 `hideSelf?: boolean`
- Produces: `MeetControlsProps`에 `hideSelf: boolean`과 `onToggleHideSelf: () => void`가 **필수**로 추가된다(기존 콜백들과 동일한 규약). `MeetRoom`이 `hideSelf` state를 소유한다.

- [ ] **Step 1: 실패하는 테스트를 작성한다**

(a) `components/live/__tests__/meet-controls.test.tsx`의 `renderControls` 기본 props에 두 줄을 추가한다:

```tsx
      onOpenPresent={vi.fn()}
      onStopPresent={vi.fn()}
      hideSelf={false}
      onToggleHideSelf={vi.fn()}
      {...overrides}
```

그리고 `describe("MeetControls", ...)` 블록 끝(`"시청자(발표자 아님): 발표자료 공유 버튼이 보이지 않는다(R7)"` 뒤)에 추가한다:

```tsx
  it("'내 얼굴' 버튼 클릭 → onToggleHideSelf 호출", () => {
    const onToggleHideSelf = vi.fn();
    renderControls({ onToggleHideSelf });
    fireEvent.click(
      screen.getByRole("button", { name: "내 화면에서 내 얼굴 숨기기" }),
    );
    expect(onToggleHideSelf).toHaveBeenCalled();
  });

  it("숨김 상태면 버튼이 '다시 보기'로 바뀌고 aria-pressed=true", () => {
    renderControls({ hideSelf: true });
    const btn = screen.getByRole("button", { name: "내 얼굴 다시 보기" });
    expect(btn).toHaveAttribute("aria-pressed", "true");
  });

  it("숨기기를 켤 때 상대에겐 계속 보인다고 안내한다(카메라 끄기와 구분)", () => {
    renderControls({ hideSelf: false });
    fireEvent.click(
      screen.getByRole("button", { name: "내 화면에서 내 얼굴 숨기기" }),
    );
    expect(screen.getByText(/친구들에겐 그대로 보여요/)).toBeInTheDocument();
  });
```

(b) `components/live/__tests__/meet-room.test.tsx`의 `describe("MeetRoom", ...)` 블록 끝에 통합 1건을 추가한다:

```tsx
  it("컨트롤바에서 '내 얼굴'을 누르면 무대에서 내 타일이 사라진다", () => {
    lk.participants = [{ identity: "ha" }, { identity: "jo" }];
    const { container } = renderRoom({ currentMemberId: "jo" });
    expect(container.querySelector('[data-identity="jo"]')).not.toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "내 화면에서 내 얼굴 숨기기" }),
    );

    expect(container.querySelector('[data-identity="jo"]')).toBeNull();
    expect(container.querySelector('[data-identity="ha"]')).not.toBeNull();
  });
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `npm test -- components/live/__tests__/meet-controls.test.tsx components/live/__tests__/meet-room.test.tsx`
Expected: FAIL — "내 화면에서 내 얼굴 숨기기" 버튼을 찾지 못한다(`Unable to find an accessible element`).

- [ ] **Step 3: 최소 구현**

(a) `components/live/meet-controls.tsx` — lucide 아이콘 import에 `Eye`, `EyeOff`를 알파벳 순서에 맞게 추가한다(현재 `Check, Hand, MessageSquare, ...` 순):

```tsx
import {
  Check,
  Eye,
  EyeOff,
  Hand,
  MessageSquare,
  Mic,
  MicOff,
  MonitorUp,
  Presentation,
  Sparkles,
  Video,
  VideoOff,
} from "lucide-react";
```

(b) `MeetControlsProps`에 추가:

```tsx
  /** 내 화면에서만 내 얼굴을 숨긴 상태. */
  hideSelf: boolean;
  /** 내 얼굴 숨기기 토글. */
  onToggleHideSelf: () => void;
```

(c) 구조 분해에 `hideSelf`, `onToggleHideSelf` 추가.

(d) 카메라 `CtrlButton` **바로 뒤**(배경 팝오버 앞)에 버튼을 넣는다:

```tsx
        {/* 내 얼굴 숨기기 — 내 화면에서만 숨긴다(카메라 끄기와 달리 상대에겐 계속 보인다). */}
        <CtrlButton
          label="내 얼굴"
          ariaLabel={hideSelf ? "내 얼굴 다시 보기" : "내 화면에서 내 얼굴 숨기기"}
          active={hideSelf}
          icon={
            hideSelf ? (
              <EyeOff size={18} aria-hidden="true" />
            ) : (
              <Eye size={18} aria-hidden="true" />
            )
          }
          onClick={() => {
            // 카메라 끄기와 헷갈리지 않게 켤 때 한 줄 안내(R30). 끌 땐 지운다.
            setNotice(
              hideSelf
                ? null
                : "내 화면에서만 숨겼어요. 친구들에겐 그대로 보여요.",
            );
            onToggleHideSelf();
          }}
        />
```

(e) 파일 상단 주석 블록에 한 줄 덧붙인다:

```
// '내 얼굴' 버튼은 로컬 뷰만 바꾼다 — 트랙을 끄지 않으므로 상대 화면엔 그대로 보인다(카메라 끄기와 구분).
```

(f) `components/live/meet-room.tsx` — `panel` state 선언 바로 아래에 state를 추가한다:

```tsx
  // 내 얼굴 숨기기 — 내 화면에서만 내 타일을 감춘다(로컬 전용, 데이터 채널 전파 없음).
  const [hideSelf, setHideSelf] = React.useState(false);
```

(g) `RoomStage`에 prop 전달(`onChangePage` 아래):

```tsx
            onChangePage={isPresenter ? changePage : undefined}
            hideSelf={hideSelf}
```

(h) `MeetControls`에 prop 전달(`onStopPresent` 아래):

```tsx
        onStopPresent={stopPresent}
        hideSelf={hideSelf}
        onToggleHideSelf={() => setHideSelf((v) => !v)}
```

- [ ] **Step 4: 테스트를 돌려 통과를 확인한다**

Run: `npm test -- components/live/__tests__/meet-controls.test.tsx components/live/__tests__/meet-room.test.tsx`
Expected: PASS — 새 4건 + 기존 전부 통과.

- [ ] **Step 5: 커밋**

```bash
git add components/live/meet-controls.tsx components/live/meet-room.tsx components/live/__tests__/meet-controls.test.tsx components/live/__tests__/meet-room.test.tsx
git commit -m "feat(live): 컨트롤바에 '내 얼굴' 숨기기 버튼 추가"
```

---

### Task 4: 전체화면 얼굴 스트립 드래그·방향키 이동

**Files:**
- Modify: `components/live/room-stage.tsx` — `RoomStage`(위치 state·키보드 가드), `StageShell`(prop 전달), `FaceStrip`(핸들·드래그), 새 export `clampStripPos`
- Test: `components/live/__tests__/room-stage.test.tsx`

**Interfaces:**
- Consumes: Task 1의 `FaceStrip`, Task 2의 `visible`
- Produces:
  - `export function clampStripPos(pos: {x:number;y:number}, size: {width:number;height:number}, bounds: {width:number;height:number}): {x:number;y:number}`
  - `FaceStrip`에 `pos?: {x:number;y:number} | null`, `onPosChange?: (p:{x:number;y:number}) => void` 추가
  - `StageShell`에 동일한 `pos`/`onPosChange` 추가(그대로 통과시킴)
  - 드래그 손잡이는 `data-strip-handle` 속성과 `aria-label="얼굴 위치 옮기기(드래그 또는 방향키)"`를 갖는다

- [ ] **Step 1: 실패하는 테스트를 작성한다**

먼저 파일 상단의 import 라인을 바꿔 `clampStripPos`도 가져온다:

```tsx
const { RoomStage, orderParticipantsForStrip, clampStripPos } = await import(
  "@/components/live/room-stage"
);
```

그리고 파일 맨 끝에 새 `describe` 두 개를 추가한다. **주의**: jsdom은 `PointerEvent`를 구현하지 않을 수 있어 `clientX/clientY`가 전달되지 않는다 — `MouseEvent`로 대체한다(기존 Fullscreen API 스텁과 같은 성격의 환경 보강).

```tsx
describe("clampStripPos", () => {
  it("컨테이너 안으로 제한한다", () => {
    expect(
      clampStripPos({ x: 900, y: 500 }, { width: 200, height: 300 }, { width: 1000, height: 600 }),
    ).toEqual({ x: 800, y: 300 });
  });

  it("음수는 0으로 막는다", () => {
    expect(
      clampStripPos({ x: -50, y: -10 }, { width: 200, height: 300 }, { width: 1000, height: 600 }),
    ).toEqual({ x: 0, y: 0 });
  });

  it("컨테이너를 잴 수 없으면(0) 상한을 두지 않는다", () => {
    expect(
      clampStripPos({ x: 300, y: 200 }, { width: 0, height: 0 }, { width: 0, height: 0 }),
    ).toEqual({ x: 300, y: 200 });
  });
});

describe("RoomStage 스트립 위치 이동", () => {
  // JSDOM은 PointerEvent를 구현하지 않을 수 있다 — MouseEvent로 대체해 clientX/Y가 전달되게 한다.
  const hadPointerEvent = typeof window.PointerEvent !== "undefined";

  function setFsElement(el: Element | null) {
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: el,
    });
  }

  beforeEach(() => {
    if (!hadPointerEvent) {
      (window as unknown as { PointerEvent: unknown }).PointerEvent =
        window.MouseEvent;
    }
    setFsElement(null);
    Element.prototype.requestFullscreen = vi.fn(function (this: Element) {
      setFsElement(this);
      document.dispatchEvent(new Event("fullscreenchange"));
      return Promise.resolve();
    }) as unknown as typeof Element.prototype.requestFullscreen;
    (document as { exitFullscreen: typeof document.exitFullscreen }).exitFullscreen =
      vi.fn(() => {
        setFsElement(null);
        document.dispatchEvent(new Event("fullscreenchange"));
        return Promise.resolve();
      }) as unknown as typeof document.exitFullscreen;
  });

  afterEach(() => {
    if (!hadPointerEvent) {
      delete (window as unknown as { PointerEvent?: unknown }).PointerEvent;
    }
    delete (Element.prototype as Partial<Element>).requestFullscreen;
    delete (document as Partial<Document>).exitFullscreen;
    setFsElement(null);
  });

  function enterFullscreen() {
    lk.participants = [{ identity: "jo" }, { identity: "ha" }];
    lk.tracks = [share()];
    const rendered = renderStage();
    fireEvent.click(screen.getByRole("button", { name: "전체화면" }));
    return rendered;
  }

  it("전체화면이 아니면 이동 손잡이가 없다", () => {
    lk.participants = [{ identity: "jo" }, { identity: "ha" }];
    lk.tracks = [share()];
    renderStage();
    expect(
      screen.queryByRole("button", { name: /얼굴 위치 옮기기/ }),
    ).toBeNull();
  });

  it("전체화면에서 손잡이를 끌면 스트립 위치가 바뀐다", () => {
    const { container } = enterFullscreen();
    const handle = screen.getByRole("button", { name: /얼굴 위치 옮기기/ });
    const strip = container.querySelector("[data-face-strip]") as HTMLElement;
    expect(strip.style.left).toBe("");

    fireEvent.pointerDown(handle, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(handle, { clientX: 300, clientY: 200 });
    fireEvent.pointerUp(handle, { clientX: 300, clientY: 200 });

    expect(strip.style.left).toBe("300px");
    expect(strip.style.top).toBe("200px");
  });

  it("전체화면에서 손잡이에 방향키를 주면 24px씩 움직인다", () => {
    const { container } = enterFullscreen();
    const handle = screen.getByRole("button", { name: /얼굴 위치 옮기기/ });
    const strip = container.querySelector("[data-face-strip]") as HTMLElement;

    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(strip.style.left).toBe("24px");

    fireEvent.keyDown(handle, { key: "ArrowDown" });
    expect(strip.style.top).toBe("24px");
  });

  it("손잡이에서 누른 방향키는 발표 페이지를 넘기지 않는다", () => {
    lk.participants = [{ identity: "jo" }, { identity: "ha" }];
    const onChangePage = vi.fn();
    render(
      <RoomStage
        members={members}
        presenterId="jo"
        currentMemberId="jo"
        hands={new Set()}
        present={{ presentationId: "pres-1", page: 2, pageCount: 5 }}
        onChangePage={onChangePage}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "전체화면" }));

    const handle = screen.getByRole("button", { name: /얼굴 위치 옮기기/ });
    fireEvent.keyDown(handle, { key: "ArrowRight" });

    expect(onChangePage).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `npm test -- components/live/__tests__/room-stage.test.tsx`
Expected: FAIL — `clampStripPos`가 export되지 않아 `undefined`이고, `얼굴 위치 옮기기` 손잡이를 찾지 못한다.

- [ ] **Step 3: 최소 구현**

(a) `components/live/room-stage.tsx` lucide import에 `GripVertical`을 추가한다(알파벳 순: `ChevronRight` 뒤, `Hand` 앞):

```tsx
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
```

(b) `orderParticipantsForStrip` 아래에 순수 함수를 추가한다:

```tsx
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
```

(c) `RoomStage` 안, `visibleCount` state 아래에 위치 state를 추가한다:

```tsx
  // 전체화면 오버레이 스트립의 위치(px, 무대 컨테이너 기준). null이면 기본 자리(우측 세로 중앙).
  // StageShell은 공유 소스가 바뀌면 리마운트되므로 위치도 여기서 갖는다(visibleCount와 같은 이유).
  const [stripPos, setStripPos] = React.useState<{ x: number; y: number } | null>(
    null,
  );
```

(d) 발표자 키보드 내비 effect의 폼 요소 가드에 손잡이 조건을 더한다(손잡이에 포커스가 있을 때 페이지가 같이 넘어가지 않도록):

```tsx
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable ||
          t.closest("[data-strip-handle]"))
      )
        return;
```

(e) 두 `StageShell` 호출(발표자료 분기·화면공유 분기)에 `onCountChange` 아래로 두 줄씩 추가한다:

```tsx
          onCountChange={setVisibleCount}
          pos={stripPos}
          onPosChange={setStripPos}
```

(f) `StageShell`의 props 타입과 구조 분해에 추가하고 `FaceStrip`에 그대로 넘긴다:

```tsx
  count: number;
  max: number;
  onCountChange: (n: number) => void;
  /** 전체화면 오버레이 스트립의 위치(px). null이면 기본 자리. */
  pos: { x: number; y: number } | null;
  onPosChange: (p: { x: number; y: number }) => void;
```

```tsx
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
```

(g) `FaceStrip`을 아래로 교체한다(Task 1의 변경을 포함한 최종 형태):

```tsx
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
  /** 전체화면일 때 공유 화면 위 오버레이로 띄운다(가독성 위해 반투명 배경). */
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
    // 포인터 캡처가 없는 환경(구형·jsdom)에서도 드래그 자체는 동작한다.
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
        clamped === 0 ? "w-auto" : "w-40 sm:w-44",
        floating &&
          "absolute z-10 max-h-[calc(100vh-1.5rem)] rounded-lg bg-bg-elevated/85 p-2 backdrop-blur",
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
```

(h) 파일 상단 주석 블록의 무대 설명 두 번째 줄을 갱신한다:

```
//   공유(발표자료/화면)가 있으면: 공유 무대(왼쪽 크게, '발표 중' 라벨) + 얼굴 세로 스트립(오른쪽, 개수 0..N 조절).
//   전체화면에선 스트립이 공유 화면 위에 뜨므로 손잡이로 위치를 옮길 수 있다(드래그·방향키, 화면 안 클램프).
```

- [ ] **Step 4: 테스트를 돌려 통과를 확인한다**

Run: `npm test -- components/live/__tests__/room-stage.test.tsx`
Expected: PASS — 새 7건 + 기존 전부 통과.

- [ ] **Step 5: 커밋**

```bash
git add components/live/room-stage.tsx components/live/__tests__/room-stage.test.tsx
git commit -m "feat(live): 전체화면 얼굴 스트립을 드래그·방향키로 옮기기"
```

---

### Task 5: 전체 검증

**Files:**
- Modify: 없음(문제 발견 시에만 수정)

**Interfaces:**
- Consumes: Task 1~4 전부
- Produces: 없음

- [ ] **Step 1: 전체 유닛 테스트**

Run: `npm test`
Expected: PASS — 실패 0건. 실패가 있으면 원인을 고치고 다시 돌린다.

- [ ] **Step 2: 린트·타입 검사**

Run: `npm run lint`
Expected: 에러 0건. 특히 `components/live/room-stage.tsx`·`meet-controls.tsx`·`meet-room.tsx`에 미사용 import가 남지 않았는지 확인한다.

- [ ] **Step 3: 프로덕션 빌드로 타입 확인**

Run: `npm run build`
Expected: 성공. `MeetControlsProps`에 필수 prop 두 개를 추가했으므로 `MeetControls`를 쓰는 다른 호출부가 있으면 여기서 잡힌다.

참고: `next dev`가 떠 있으면 Windows에서 Prisma 엔진 DLL 잠금(EPERM)이 날 수 있다 — 개발 서버를 끄고 빌드한다.

- [ ] **Step 4: 커밋할 변경이 남았으면 커밋**

```bash
git status --short components/live
```

변경이 남아 있으면:

```bash
git add components/live
git commit -m "fix(live): 얼굴 숨기기·스트립 이동 검증 중 발견한 문제 수정"
```

깨끗하면 이 스텝은 건너뛴다.

---

## 수동 확인(선택)

`npm run dev`로 띄우고 라이브 룸에서:

1. 컨트롤바 **내 얼굴** → 내 타일이 사라지고 친구들만 남는지, 안내 문구가 뜨는지
2. 다른 브라우저(또는 시크릿 창)로 같은 방에 들어가 **내가 상대에게는 계속 보이는지** — 이게 카메라 끄기와의 핵심 차이
3. 발표자료 공유 → 전체화면 → 손잡이를 끌어 스트립을 좌상단·하단으로 옮기고, 창 밖으로 안 나가는지
4. `−`를 눌러 얼굴 0명 → 슬라이드가 넓어지고, `+`로 다시 늘어나는지
