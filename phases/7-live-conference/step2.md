# Step 2: live-room-video

시청자 HLS 플레이어를 **LiveKit 다자간 화상 룸**으로 교체한다. `components/live/live-room.tsx`를 재작성해 토큰으로 LiveKit 룸에 접속하고, 참가자 비디오 타일(실제 영상 / 카메라 꺼지면 아바타)과 발표자 화면공유 표면을 렌더한다. 이 step은 **영상 연결 + 타일 + 생명주기**까지. 컨트롤바·채팅·반응·타이머는 step 3.

## 읽어야 할 파일

먼저 아래 문서를 읽고 아키텍처와 설계 의도를 파악하라. **정본은 루트 `README.md` · `CLAUDE.md` · `PRD.md`이며, 충돌 시 이를 따른다.**

항상:
- `docs/dev/ARCHITECTURE.md` — RSC/클라이언트 경계
- `docs/agent/ADR.md` — **ADR-019(LiveKit)·ADR-001(앱 레벨 live)·ADR-015(읽기 RSC·쓰기 라우트)**
- `docs/dev/CODING_CONVENTION.md` — 네이밍·RSC 경계·타입

화면/UI 레이어:
- `docs/design/DESIGN_GUIDE.md` — **디자인 토큰(R20: hex 하드코딩 금지)**·접근성(R29)
- `docs/design/SCREENS.md` · `docs/user/USER_FLOW.md` — 라이브 룸 흐름
- `docs/agent/RULES.md` — 특히 **R5·R6·R7·R20·R26·R27·R29·R30·R32**

이전 step 산출물:
- `lib/livekit.ts`·`lib/live-messages.ts`(step 1)
- 개조된 라우트 `app/api/live/start|[id]/join|[id]/leave|[id]/end`(step 1)
- `types/entities.ts`의 라이브 DTO(step 1)

교체/참고할 기존 코드:
- `components/live/live-room.tsx` — **재작성 대상**(현재 HLS 시청자/발표자 송출 자격증명 구조)
- `components/live/broadcast-panel.tsx` · `components/live/hls-player.tsx` — **이 step에서 더 이상 쓰지 않게 된다**(파일 삭제는 step 4). live-room이 이들을 import하지 않도록 바꾼다.
- `components/live/index.ts` — export 목록
- `components/providers/live-provider.tsx` — `useLive()`(앱 레벨 단일 소스, 그대로 사용)
- `app/(app)/meeting/page.tsx` — RSC가 `currentMemberId`·`initialSession`·`members` 주입
- `components/ui` — `Button`·`Card`·`Avatar`·`Badge`·`EmptyState`(토큰 기반 프리미티브)
- `src/meeting.jsx` — **비주얼/레이아웃 참고용**(`MeetTile`·filmstrip·발표 stage). 단 프로토타입 CSS 클래스(`meet-*`)를 그대로 쓰지 말고 Tailwind+토큰으로 재현한다(R20). `window.*`·`getUserMedia` 가짜 다자간 로직은 포팅 금지.

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

### 0. 의존성

```bash
npm i @livekit/components-react livekit-client
```

(스타일은 `@livekit/components-styles`를 쓰지 말고 우리 토큰으로 직접 — R20.)

### 1. `components/live/live-room.tsx` 재작성 (`"use client"` 인터랙티브 섬)

기존 props 형태 유지(필요 시 확장):
```ts
export interface LiveRoomMember { id: string; name: string; initial: string; color: string; }
export interface LiveRoomSession { id: string; presenterId: string; participantIds: string[]; }
export interface LiveRoomProps {
  currentMemberId: string;
  initialSession: LiveRoomSession | null;
  members: LiveRoomMember[];
}
```

동작:
- `useLive()`로 앱 전역 `live`를 읽는다. **`live`를 이 컴포넌트 state로 보관하지 마라(R5).** 시작/종료 시 `setLive` 낙관적 호출(Realtime이 확정, R33).
- **라이브 없음(`!live`)**: `EmptyState` + `[라이브 시작]`. 동시 시작 409 → "이미 진행 중 — 입장?" 안내 후 입장(`handleEnter`로 `setLive(true)`). 미설정 503 → 서버의 친절한 사유를 그대로 노출(R30).
- **시작(`handleStart`)**: `POST /api/live/start` → `{ session, token, url }` 수신 → 발표자 토큰으로 룸 접속.
- **입장(시청자)**: `live && session && !isPresenter`이면 `POST /api/live/:id/join` → `{ token, url }` 수신 → 룸 접속.
- **룸 접속**: `@livekit/components-react`의 `<LiveKitRoom serverUrl={url} token={token} connect>` 로 컨텍스트 제공. 접속 옵션: 처음엔 **카메라/마이크 publish 없이** subscribe-only로 들어간다(카메라 토글은 step 3). 발표자도 마찬가지(화면공유 시작은 step 3).
- **타일 렌더**(`RoomStage`/`ParticipantTiles` 같은 하위 컴포넌트로 분리해 step 3가 헤더·컨트롤을 끼울 seam을 만든다):
  - `useTracks([Track.Source.Camera, Track.Source.ScreenShare])` + `useParticipants()`로 참가자별 타일.
  - 참가자 `identity`(=`Member.id`)로 `members`에서 이름/아바타/색을 매핑. 매핑 없으면 identity로 폴백.
  - 카메라 트랙 있으면 `<VideoTrack>`, 없으면 **아바타 타일**(이니셜+색) — 프로토타입 `MeetTile`의 정직한 재현.
  - 발화 중 참가자는 링/테두리 강조(`isSpeaking`). **색만으로 정보 전달 금지 — 아이콘/텍스트 병행(R29).**
  - 발표자가 화면공유 중이면 그 트랙을 메인 stage로 크게, 참가자 카메라는 filmstrip으로.
- **참가자 수·로스터**: LiveKit presence(`useParticipants`) 기준으로 표시. "발표자"/"시청자"는 색+텍스트 배지(R29).
- **생명주기 액션**(R6/R27):
  - 발표자: `[라이브 종료]` → 확인 다이얼로그(파괴적, R27) → `POST /api/live/:id/end` → 룸 disconnect + `setLive(false)`.
  - 시청자: `[나가기]` → 룸 disconnect + `POST /api/live/:id/leave`(best-effort). 전역 `live`는 유지(R6).
- **상태 3종(R26)**: 로딩(접속 중 "연결 중이에요…")·빈(라이브 없음)·에러(접속 실패 → "다시 시도"). LiveKit 연결 에러는 throw하지 말고 graceful 자리로(R30).

### 2. 보조

- `components/live/index.ts`: `LiveRoom` export 유지. (broadcast-panel/hls-player export는 step 4에서 정리.)
- `app/(app)/meeting/page.tsx`: 기존 props 주입 유지. LiveKit 토큰은 페이지가 아니라 **룸이 라우트에서 fetch**한다(RSC가 토큰을 들고 있지 않는다 — 토큰은 참가자별·단기).

## Acceptance Criteria

```bash
npm run build
npm test
npm run lint
```

테스트(먼저 작성, `components/live/__tests__/live-room.test.tsx` 갱신):
- **`livekit-client`·`@livekit/components-react`를 `vi.mock`** 으로 가짜 처리(실제 WebSocket 연결 금지). `useLive`는 LiveProvider로 감싸거나 목.
- 검증 케이스:
  - 라이브 없음 → `[라이브 시작]` 보임.
  - `handleStart`가 `POST /api/live/start`를 부르고, 503 응답 시 친절한 사유를 노출(R30).
  - 409 → "이미 진행 중 — 입장" 안내.
  - 발표자 세션 → 화면공유/종료 진입점, `[라이브 종료]`는 확인 다이얼로그(R27).
  - 시청자 세션 → `POST /api/live/:id/join`을 부르고 토큰으로 룸 컨텍스트 진입, `[나가기]` 동작.
  - 참가자 타일: 카메라 트랙 있는 참가자는 비디오, 없으면 아바타(이니셜) — 목 트랙으로 분기 확인.
- RTL은 LiveKit 훅을 목한 상태에서 **조건부 UI**를 검증한다(실제 미디어 없이).

## 검증 절차

1. 위 AC 커맨드 실행.
2. 아키텍처 체크리스트:
   - `live`가 `useLive()` 단일 소스인가, 컴포넌트 state로 새지 않는가(R5)?
   - 토큰을 라우트에서 받아오고, 클라가 DB/LiveKit 서버 키를 직접 보지 않는가(R32/R2)?
   - 색·간격·반경이 전부 토큰인가(R20)? 깜빡임/발화 표시가 색+텍스트 병행인가(R29)?
   - 상태 3종(로딩/빈/에러)이 모두 있는가(R26)? 종료는 확인을 거치는가(R27)?
3. `phases/7-live-conference/index.json`의 step 2 업데이트(성공 `completed`+summary / 실패 `error` / 사람 개입 `blocked`).

## 금지사항

- **화면 컴포넌트에 `live` boolean을 보관하지 마라.** 이유: 사이드바 배지·홈 배너·룸이 어긋난다(ADR-001/R5).
- **`@livekit/components-styles`나 hex 색을 쓰지 마라.** 이유: 라이트/다크·액센트 토큰 스위칭이 깨진다(R20).
- **`src/meeting.jsx`의 `window.*`·가짜 다자간(`getUserMedia`로 내 카메라만 진짜) 로직을 포팅하지 마라.** 이유: 이제 진짜 SFU 다자간이다. 프로토타입은 레이아웃 참고용일 뿐.
- **클라이언트에서 LiveKit 서버 SDK(`livekit-server-sdk`)를 import하지 마라.** 이유: API_SECRET이 번들에 샌다(R2). 클라는 `livekit-client`만.
- **컨트롤바·채팅·반응·타이머를 여기서 만들지 마라.** 이유: step 3의 범위다 — 이 step은 영상 연결+타일+생명주기까지만(scope 최소화).
- **`broadcast-panel.tsx`·`hls-player.tsx`·`lib/cloudflare.ts`·`lib/whip.ts`를 삭제하지 마라.** 이유: step 4의 정리 범위. 단 live-room이 이들을 import하지 않게는 만든다.
- 기존 테스트를 깨뜨리지 마라(live-room 테스트는 새 구조로 갱신).
