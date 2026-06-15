# Step 3: live-controls-chat

LiveKit 룸에 **Google Meet/Zoom 스타일 유틸**을 입힌다: 송출 타이머, 컨트롤바(마이크/카메라/화면공유/손들기/반응/채팅), 채팅 패널, 플로팅 반응, 손들기, 참가자 패널. 영상·발화·publish는 step 2의 LiveKit 룸, 채팅/반응/손들기는 step 1의 `lib/live-messages.ts` + LiveKit 데이터 채널을 쓴다.

## 읽어야 할 파일

먼저 아래 문서를 읽고 아키텍처와 설계 의도를 파악하라. **정본은 루트 `README.md` · `CLAUDE.md` · `PRD.md`이며, 충돌 시 이를 따른다.**

항상:
- `docs/dev/ARCHITECTURE.md` · `docs/agent/ADR.md`(**ADR-019**) · `docs/dev/CODING_CONVENTION.md`

화면/UI 레이어:
- `docs/design/DESIGN_GUIDE.md` — **토큰(R20)**·애니메이션(허용 keyframes만)·접근성(R29: reduced-motion)
- `docs/design/SCREENS.md` · `docs/design/SCREEN_FLOW.md`
- `docs/agent/RULES.md` — 특히 **R20·R26·R29·R30**

이전 step 산출물:
- `lib/live-messages.ts`(step 1) — `LiveMessage`·`encodeLiveMessage`·`decodeLiveMessage`
- `components/live/live-room.tsx`와 그 하위 컴포넌트(step 2) — LiveKit 룸 컨텍스트·타일·생명주기

비주얼 참고:
- `src/meeting.jsx` — **레이아웃/인터랙션 레퍼런스**: `meet-head`(LIVE pill·제목·`fmtElapsed` 타이머·참가자 수), `meet-controls`(마이크/카메라/공유/손들기/반응 `["👍","🔥","👏","🤔","🎉"]`/채팅/나가기), `meet-panel`(채팅/참가자/자료 탭), `float-emoji`(플로팅 반응). **CSS 클래스(`meet-*`)·`window.*`는 포팅 금지 — Tailwind+토큰으로 재현(R20).**
- `src/styles.css` — 토큰 값 참고만(직접 import 금지).

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

step 2의 룸 안에 아래를 추가한다. 가능한 한 작은 클라이언트 컴포넌트로 분리한다(`MeetHeader`·`MeetControls`·`ChatPanel`·`PeoplePanel`·`ReactionsLayer` 등). 모두 LiveKit 룸 컨텍스트(`@livekit/components-react` 훅) 안에서 동작한다.

### 1. 송출 타이머 (`MeetHeader`)
- 서버 `LiveSession.startedAt`을 기준으로 경과 시간을 1초마다 갱신해 `mm:ss`(1시간↑은 `h:mm:ss`)로 표시. 프로토타입 `fmtElapsed` 로직 재현.
- LIVE 표시는 **색 알약 + "LIVE" 텍스트 병행**(R29), `prefers-reduced-motion`에서 펄스를 정적으로.
- 참가자 수는 LiveKit presence(`useParticipants().length`).

### 2. 컨트롤바 (`MeetControls`)
LiveKit `useLocalParticipant()`로 로컬 트랙을 토글:
- **마이크**: `localParticipant.setMicrophoneEnabled(v)`.
- **카메라**: `setCameraEnabled(v)`. 켜면 내 타일이 아바타→비디오로(step 2 타일이 자동 반영).
- **화면공유**: `setScreenShareEnabled(v)`. **발표자만 노출/동작** — 토큰에 grant 없으면(시청자) 버튼을 숨기거나 비활성(서버가 이미 grant로 막지만 UI도 정직하게). 권한 거부는 graceful 안내(R30).
- **손들기**: 데이터 채널로 `{ kind:"hand", up }` 전송 + 본인 타일/로스터에 손 아이콘. (LiveKit attribute 또는 로컬+broadcast 상태로.)
- **반응**: `["👍","🔥","👏","🤔","🎉"]` → `{ kind:"reaction", emoji }` 전송 → `ReactionsLayer`가 플로팅.
- **채팅 토글**: 패널 열기/닫기.
- **나가기**: step 2의 `handleLeave` 재사용.

### 3. 데이터 채널 배선
- 송신: `room.localParticipant.publishData(encodeLiveMessage(msg), { reliable: true, topic: "live" })`.
- 수신: `useDataChannel("live", (msg) => { const m = decodeLiveMessage(msg.payload); ... })` 또는 `RoomEvent.DataReceived`. **작성자는 `msg.from?.identity`로 판별**(페이로드 author 미신뢰, R3) → `members`에서 이름/아바타 매핑.
- `decodeLiveMessage`가 `null`이면 무시.

### 4. 채팅 패널 (`ChatPanel`)
- 수신한 `kind:"chat"` 메시지를 시간순 표시(아바타+이름+텍스트). 입력+Enter로 전송. **휘발(미저장)** — 새로고침/재입장 시 비어 있어도 정상(정직한 빈 상태, R21).
- 빈 상태 카피 제공(R26: 빈).

### 5. 참가자 패널 (`PeoplePanel`)
- LiveKit presence 기준 로스터. 발표자/시청자, 마이크 on/off, 손든 사람 표시(색+아이콘 병행, R29).

### 6. 반응 레이어 (`ReactionsLayer`)
- `kind:"reaction"` 수신 시 이모지를 잠깐 떠올렸다 사라지게(허용된 keyframes만; reduced-motion 존중, R29).

### 7. 자료 패널 (간소화)
- 프로토타입의 "자료" 탭은 **세션↔발표자료 연결이 스키마에 없으므로** 가짜 데이터를 만들지 말고(R21), `/presentations`로 가는 링크 한 개로 대체한다. (세션별 자료 연결은 미결 → ISSUES.)

## Acceptance Criteria

```bash
npm run build
npm test
npm run lint
```

테스트(먼저 작성):
- 컨트롤 토글이 LiveKit 로컬 트랙 API(`setMicrophoneEnabled`/`setCameraEnabled`/`setScreenShareEnabled`)를 부르는지(목으로 확인).
- **화면공유 버튼이 시청자(화면공유 grant 없음)에겐 안 보이거나 비활성**인지.
- 채팅 전송이 `publishData(encodeLiveMessage(...))`를 부르고, 수신 `DataReceived`→`decodeLiveMessage`→화면 반영. `decodeLiveMessage` null이면 무시.
- 타이머가 `startedAt`에서 경과로 렌더(고정 시계 주입해 `mm:ss` 검증).
- 빈 채팅/참가자 패널의 빈 상태(R26).
- `@livekit/components-react`·`livekit-client`는 목.

## 검증 절차

1. 위 AC 커맨드 실행.
2. 아키텍처 체크리스트:
   - 색·간격·애니메이션이 전부 토큰/허용 keyframes인가(R20)? 발화·LIVE·손들기가 색+텍스트/아이콘 병행인가(R29)?
   - 채팅 작성자가 LiveKit identity로 판별되는가(페이로드 author 미신뢰, R3)?
   - 화면공유가 발표자에게만인가(R7 — UI도 정직하게)?
   - 상태 3종·정직한 빈 상태(R21/R26), 권한 거부 graceful(R30)?
3. `phases/7-live-conference/index.json`의 step 3 업데이트(성공 `completed`+summary / 실패 `error` / 사람 개입 `blocked`).

## 금지사항

- **채팅/반응/손들기를 위해 새 DB 테이블·API 라우트·Supabase 채널을 만들지 마라.** 이유: 룸에 이미 붙은 LiveKit 데이터 채널로 충분하다(ADR-019). 앱 전역 `live` 전이만 Supabase Realtime(R33) — 그건 기존 그대로 둔다.
- **자료 패널에 가짜 데이터를 넣지 마라.** 이유: 세션↔발표자료 연결이 없다. 정직한 링크 하나로(R21).
- **hex·임의 애니메이션을 쓰지 마라.** 이유: 토큰/허용 keyframes만(R20, DESIGN_GUIDE).
- **메시지 페이로드의 author를 신뢰하지 마라.** 이유: 위조 가능 — 작성자는 LiveKit `identity`로(R3).
- 기존 테스트를 깨뜨리지 마라.
