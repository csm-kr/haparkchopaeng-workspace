# 라이브 내 얼굴 숨기기 & 얼굴 스트립 접기·이동 — 설계

- 날짜: 2026-08-01
- 범위: 라이브 룸(LiveKit) 무대 — (1) 내 화면에서만 내 얼굴 숨기기 (2) 발표 중 얼굴 스트립 0명까지 접기 (3) 전체화면에서 얼굴 스트립 드래그 이동
- 관련: ADR-019(LiveKit 데이터 채널), R7(발표자 grant), R20(토큰만), R29(색 단독 금지), R30(따뜻한 안내)

## 배경(문맥)

사용자 요청 2가지:

1. 공유 없이 그냥 모여 있을 때 **내 얼굴이 내 화면에 안 뜨게** 하는 버튼. 친구들 얼굴만 보고 싶다.
2. 발표를 최대화(전체화면)하면 오른쪽에 얼굴 스트립이 뜨는데, **그 자리에 중요한 내용이 있으면 가려서 못 본다**. 얼굴을 아예 0명까지 줄이거나, 스트립 위치를 옮길 수 있게 해달라.

## 현재 코드(확인한 사실)

`components/live/room-stage.tsx`

- 공유가 없으면 `participants.map(renderTile)` — **나를 포함한** 전원 그리드.
- 발표자료/화면공유가 있으면 `StageShell` + 오른쪽 `FaceStrip`. 스트립에 보이는 얼굴은
  `orderParticipantsForStrip(participants, presenterId).slice(0, min(visibleCount, participants.length))`.
- `FaceStrip`의 클램프가 `Math.min(Math.max(1, count), Math.max(1, max))` — **최소 1명이라 0이 안 된다**.
- 전체화면(`isFs`)이면 `FaceStrip`이 `absolute top-1/2 right-3` **고정 오버레이** → 슬라이드 오른쪽을 항상 가린다.
- `visibleCount`는 `RoomStage`의 state라 공유 소스가 바뀌어도(=`StageShell` 리마운트) 유지된다. 반면 `isFs`는 `StageShell` state라 유지되지 않는다.

`components/live/meet-controls.tsx`

- 마이크/카메라/배경/화면공유/발표자료/손들기/반응/채팅 버튼을 `CtrlButton`으로 나열. 장치 거부 등은 `notice` 한 줄로 안내(R30).
- 카메라 **끄기**는 이미 있다(`localParticipant.setCameraEnabled(false)`) — 이건 상대에게도 안 보이는 것이라 이번 요청과 다르다.

`components/live/meet-room.tsx`

- 무대(`RoomStage`)와 컨트롤바(`MeetControls`)는 형제 컴포넌트. 둘이 공유하는 상태(`hands`, `present`, `panel`)는 `MeetRoom`이 소유한다.

## 설계

### 1. 내 얼굴 숨기기 (self-view 끄기)

**의미**: 내 브라우저에서만 내 타일을 감춘다. 카메라 트랙은 그대로 송출되어 **친구들 화면엔 내 얼굴이 계속 보인다**. 카메라 끄기와 명확히 다른 기능이다.

**상태 소유**: `MeetRoom`이 `hideSelf: boolean`을 갖는다(기존 `hands`/`present`와 같은 자리). 무대와 컨트롤바가 형제라 공통 조상이 소유해야 한다.

```
MeetRoom
  ├─ RoomStage      hideSelf
  └─ MeetControls   hideSelf, onToggleHideSelf
```

**적용 지점** — `RoomStage`에서 `participants`를 쓰기 **직전에 한 번** 걸러 그리드와 스트립에 모두 적용한다.

```ts
const visible = hideSelf
  ? participants.filter((p) => p.identity !== currentMemberId)
  : participants;
```

- 그리드: `visible.map(renderTile)`
- 스트립: `orderParticipantsForStrip(visible, presenterId).slice(0, min(visibleCount, visible.length))`
- `FaceStrip`의 `max`도 `visible.length` — 숨긴 내 얼굴이 개수 한도에 잡히지 않는다.

**로컬 전용**: 데이터 채널로 전파하지 않는다. 상대에게 알릴 이유가 없고, `present`처럼 신뢰 판별이 필요한 상태도 아니다(ADR-019 범위 밖).

**UI** — `MeetControls`, 카메라 버튼 옆:

- `CtrlButton` 라벨 "내 얼굴", 아이콘 `Eye`(보임) / `EyeOff`(숨김), `aria-pressed={hideSelf}`.
- `aria-label`: 숨김 상태면 "내 얼굴 다시 보기", 아니면 "내 화면에서 내 얼굴 숨기기".
- 켤 때 기존 `notice`에 "내 화면에서만 숨겼어요. 친구들에겐 그대로 보여요."를 띄운다(카메라 끄기와의 혼동 방지, R30). 끌 때는 `notice`를 지운다.

**엣지 케이스**

- 혼자 있는 방에서 숨기면 그리드가 빈다 → 그리드 자리에 안내: "내 얼굴을 숨겼어요. 친구들이 들어오면 여기에 보여요."
- 발표 중이고 나 말고 아무도 없으면 스트립이 0개 → 헤더("얼굴 0")만 남는다. 아래 2번의 0명 상태와 같은 화면이라 별도 처리 없음.
- 채팅/참가자 패널의 "참가자 N"은 **실제 인원**이므로 그대로 둔다(내 얼굴을 숨겼다고 방에 사람이 준 게 아니다).

### 2. 얼굴 스트립 — 0명까지 접기

- `FaceStrip`의 클램프를 `Math.min(Math.max(0, count), Math.max(0, max))`로 바꾼다(하한 1 → 0).
- `count === 0`이면 타일 목록 컨테이너를 렌더하지 않고 **헤더 알약("얼굴 0" + −/+)만** 남긴다. 헤더까지 사라지면 다시 늘릴 방법이 없으므로 반드시 유지한다.
- `−`는 `clamped <= 0`에서, `+`는 `clamped >= max`에서 `disabled`.
- 초기값은 지금과 같이 `2`.

### 3. 전체화면에서 스트립 드래그 이동

**활성 조건**: **전체화면(떠 있는 오버레이)일 때만**. 비전체화면에서는 스트립이 무대 옆 컬럼이라 슬라이드를 가리지 않으므로 이동이 필요 없다.

**핸들**: 헤더 왼쪽에 전용 손잡이(`GripVertical`)를 둔다. 헤더 전체를 드래그 영역으로 쓰면 −/+ 클릭과 충돌한다.

**상호작용**

- Pointer Events: 손잡이 `pointerdown` → `setPointerCapture` → `pointermove`로 `{x, y}` 갱신 → `pointerup`/`pointercancel`로 종료. 마우스·터치·펜을 한 코드로 처리한다.
- 위치는 전체화면 컨테이너 기준 **절대 좌표(px)**. 매 이동마다 컨테이너 `getBoundingClientRect()`와 스트립 크기로 **화면 안에 클램프**한다(밖으로 나가 잃어버리지 않게).
- 키보드: 손잡이는 `<button>`이라 포커스를 받는다. 방향키로 24px씩 이동하고 같은 클램프를 적용한다(드래그 전용이면 키보드 사용자가 못 옮긴다).
- 손잡이 `aria-label`: "얼굴 위치 옮기기(드래그 또는 방향키)".

**상태 소유**: 위치는 `visibleCount`와 함께 **`RoomStage`가 소유**한다. `StageShell`은 발표자료↔화면공유 전환 시 리마운트되므로, 그 안에 두면 위치가 초기화된다.

- 초기값 `null` = 지금과 같은 기본 자리(우측 세로 중앙, `top-1/2 right-3`).
- `null`이 아니면 `left`/`top` 인라인 스타일로 배치하고 `-translate-y-1/2`를 걷어낸다.
- 전체화면을 나가면 위치는 무시되고 다시 옆 컬럼으로 돌아간다. 값은 유지되어 다시 들어가면 두었던 자리에 뜬다.

**범위 밖**: 스냅/자석, 크기 조절, 위치 초기화 버튼(클램프가 있어 잃어버리지 않는다).

## 테스트(TDD — 먼저 작성)

`components/live/__tests__/room-stage.test.tsx`

- `−`로 0까지 줄이면 타일 0개, "얼굴 0" 헤더는 남고 `−`가 비활성.
- 0에서 `+`를 누르면 타일 1개로 복귀.
- `hideSelf`면 그리드에서 내 타일(`[data-identity="ha"]`)이 빠지고 친구들만 남는다.
- `hideSelf`면 발표 중 스트립 후보에서도 내가 빠진다(2명 표시일 때 뜨는 얼굴이 달라진다).
- 혼자 있는데 `hideSelf`면 안내 문구가 보인다.
- 전체화면에서 손잡이에 `pointerdown`→`pointermove`→`pointerup`을 주면 스트립의 인라인 `left`/`top`이 바뀐다.
- 전체화면에서 손잡이에 방향키를 주면 위치가 바뀐다.
- 비전체화면에는 손잡이가 없다.

`components/live/__tests__/meet-controls.test.tsx`

- "내 얼굴" 버튼 클릭 시 `onToggleHideSelf` 호출.
- `hideSelf`에 따라 `aria-pressed`/`aria-label`이 바뀐다.
- 숨김으로 켤 때 "친구들에겐 그대로 보여요" 안내가 뜬다.

`components/live/__tests__/meet-room.test.tsx`

- 컨트롤바에서 토글하면 `RoomStage`에 `hideSelf`가 전달되어 내 타일이 사라진다(통합 1건).

JSDOM 주의: `setPointerCapture`/`releasePointerCapture`는 미구현이라 테스트에서 no-op 스텁을 붙인다. 클램프에 쓰는 `getBoundingClientRect()`도 0을 반환하므로, 테스트에서 컨테이너·스트립 크기를 스텁하거나 클램프가 0 크기에서도 안전하도록 `Math.max(0, ...)`로 방어한다.

## 범위 밖(YAGNI)

설정 영속화(localStorage) · 스트립 타일 크기 조절 · 비전체화면 드래그 · 내 숨김 상태를 상대에게 알리기 · 스트립 위치 스냅/프리셋 · 그리드 모드에서의 스트립화.
