# 브라우저 송출 (Cloudflare WHIP) 설계

- 날짜: 2026-06-14
- 상태: 승인됨 (구현 진행)
- 관련: `phases/1-live`(완료 — RTMP/SRT 송출 + HLS 시청)

## 배경 / 목표

`phases/1-live`에서 Cloudflare Stream Live 백엔드·UI는 완성됐다. 다만 발표자가 **송출(broadcast)** 하려면 OBS 등 외부 프로그램에 RTMP/SRT 자격증명을 넣어야 한다. 이 작업은 발표자가 **브라우저에서 바로** 화면+마이크로 송출하도록 만든다 — Cloudflare Stream Live의 **WHIP(WebRTC-HTTP Ingestion)** 사용.

시청자 재생(HLS)·DB·Realtime·종료(`/end`)는 **기존 그대로**. Cloudflare는 WHIP ingest도 HLS로 트랜스코딩하므로 시청자 측 변경 0.

## 범위

**In**
- 발표자 브라우저 송출: 화면공유(`getDisplayMedia`) + 마이크(`getUserMedia`) → WHIP publish
- 로컬 미리보기(`<video muted>`), 송출 상태 표시(준비/연결 중/송출 중/실패)
- 기존 RTMP/SRT 자격증명은 *"고급: OBS로 송출"* 접이식 폴백으로 유지

**Out (이번 범위 아님)**
- 시청자 WHEP 저지연 재생 (시청자는 HLS 유지)
- 화면+웹캠 PiP 합성
- 송출 중지/재개 토글 (전체 종료는 기존 `라이브 종료`로)
- 실제 Cloudflare 계정 env 연결·검증 (키는 운영 설정 영역)

## 아키텍처 (델타)

| 파일 | 변경 |
|---|---|
| `lib/whip.ts` | **신규** — 주입 가능한 WHIP publish 클라이언트(무의존성) |
| `components/live/broadcast-panel.tsx` | **신규** — 캡처·미리보기·송출 상태 + OBS 폴백 |
| `lib/cloudflare.ts` | `LiveInput.webRTC` 추가 + `createLiveInput`/`mapLiveInput`/`CloudflareLiveInput` 매핑 |
| `app/api/live/start/route.ts` | 응답에 `webRTC` 추가 (발표자 전용 라우트라 R36 위배 없음) |
| `components/live/live-room.tsx` | `Credentials.webRTC`, `PresenterPanel`→`BroadcastPanel` 렌더 + OBS 접이식, 종료/언마운트 시 `stop()` |

**안 건드림(충돌 회피):** `package.json`(무의존성), `phases/index.json`(옆 세션 소유), `.env.example`/`docs/dev/ENV.md`(새 env 없음 — 동일 Cloudflare 키). `docs/dev/API.md`는 옆 세션이 수정 중이므로 **맨 마지막에** 1줄(=`/start` 응답 `webRTC`) 추가, 충돌 시 재적용.

## WHIP 클라이언트 (`lib/whip.ts`)

```ts
export interface WhipSession { stop(): Promise<void>; }

export async function publishWhip(opts: {
  stream: MediaStream;
  endpoint: string;                      // Cloudflare Live Input의 webRTC.url
  createPeer?: () => RTCPeerConnection;  // 테스트 주입(기본: new RTCPeerConnection())
  fetchImpl?: typeof fetch;              // 테스트 주입(기본: globalThis.fetch)
}): Promise<WhipSession>;
```

동작(non-trickle, 단순/테스트 용이):
1. `createPeer()` → `stream`의 각 track을 `addTrack`
2. `createOffer` → `setLocalDescription` → ICE 수집 완료 대기(`iceGatheringState==='complete'` 또는 짧은 타임아웃)
3. `endpoint`에 offer SDP를 `POST` (`Content-Type: application/sdp`)
4. 2xx가 아니면 친절한 `Error` throw. 성공 시 응답 본문(answer SDP) `setRemoteDescription`, `Location` 헤더 보관
5. `stop()`: `Location`이 있으면 `DELETE`(best-effort) + `pc.close()`

## 흐름

1. `라이브 시작` → `POST /api/live/start`(기존) — 응답에 `webRTC.url` 포함
2. 발표자 뷰에 `BroadcastPanel`: `[화면 공유로 송출 시작]` + 접이식 *고급: OBS로 송출*
3. 버튼 클릭(**사용자 제스처** — `getDisplayMedia` 요건) → 화면+마이크 캡처 → 미리보기 → `publishWhip()` → **송출 중**
4. 종료 경로(`라이브 종료`/언마운트/화면공유 중단 `track.onended`) → `stop()` + 트랙 정지. `/end`가 Live Input 삭제(기존)

## UI 상태기계 (`broadcast-panel.tsx`)

`idle`(송출 준비) → (버튼) `requesting`(권한/연결 중) → `live`(송출 중, pulse) → `error`(재시도 + OBS 폴백)

- `webRTC.url` 없음(새로고침 등) → OBS 폴백만 노출
- 권한 거부/미지원 → "화면 공유 권한이 필요해요" + OBS 폴백 유지

## 보안

- `webRTC.url`은 송출 자격증명 → **발표자 `/start` 응답에만**. 시청자 `/join`은 기존대로 HLS만(R36).
- DB에는 기존처럼 `cloudflareLiveInputId`만 저장(자격증명 미저장).

## 테스트 (TDD — 먼저 작성)

- `lib/__tests__/whip.test.ts`(신규): offer가 `application/sdp`로 POST됨 · answer 적용 · `stop()`이 `pc.close()`+Location `DELETE` · 非2xx → throw. (가짜 `RTCPeerConnection`+`fetch` 주입)
- `components/live/__tests__/broadcast-panel.test.tsx`(신규): 버튼→`getDisplayMedia`+`getUserMedia` 목→`publishWhip` 목이 `webRTC.url`+합성 스트림으로 호출→"송출 중"; 권한 거부→폴백; `webRTC.url` 없음→폴백만
- `lib/__tests__/cloudflare.test.ts`(보강): `createLiveInput`이 `webRTC.url` 매핑
- `app/api/live/__tests__/live-routes.test.ts`(보강): `/start` 응답에 `webRTC` 포함(설정 시)·미설정 503 유지·`/join`엔 `webRTC` 미포함
- `components/live/__tests__/live-room.test.tsx`(보강): 발표자 뷰에 송출 시작 노출 + OBS 접이식
- E2E(`tests/e2e/meeting.spec.ts`, 경량): 송출 시작 affordance 노출 + 미설정 503 경로. 실제 WHIP은 헤드리스 제약으로 단위/RTL이 커버.

## 구현 순서 (각 단계 RED→GREEN)

1. `lib/whip.ts` — 테스트 먼저 → 구현
2. `lib/cloudflare.ts` — `webRTC` 매핑(테스트 보강 먼저)
3. `app/api/live/start/route.ts` — 응답 `webRTC`(라우트 테스트 보강 먼저)
4. `components/live/broadcast-panel.tsx` — RTL 먼저 → 구현
5. `components/live/live-room.tsx` — `PresenterPanel` 교체 + 종료 시 `stop()`(테스트 보강)
6. `docs/dev/API.md` 1줄(맨 마지막, 충돌 시 재적용)
7. 전체 `tsc`/`vitest`/`lint`/E2E 그린 확인

## 커밋 정책

옆 세션 phase-2 작업과 분리. 커밋은 사용자가 지시할 때, `git add`로 **위 델타 파일 경로만** 스테이징해 단독 커밋. 그 전까지 미커밋 유지.

## 가정 / 미해결

- Cloudflare Live Input 응답에 `webRTC.url`이 항상 포함된다고 가정(표준 동작). 부재 시 graceful 폴백(OBS) 동작.
- 송출 오디오 = 마이크. 화면공유의 시스템/탭 오디오는 범위 외(브라우저별 편차).
