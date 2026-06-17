# 라이브 — 발표자 이탈 시 세션 자동 종료 설계

- 날짜: 2026-06-17
- 상태: 승인됨 (구현 진행)
- 관련: `phases/7-live-conference`(LiveKit 다자간), `live-room.tsx`의 `/end`·`/leave` 분리(ADR-001/R6), 2026-06-16 나가기 확인 설계

## 배경 / 문제

발표자에게는 `나가기` 버튼이 없고 `라이브 종료`(`/end`, 전역 종료)만 있다. 그래서 발표자가 **버튼을 누르지 않고 탭/창을 닫거나 다른 페이지로 이탈**하면 `/end`가 호출되지 않아 `LiveSession.active`가 `true`로 남는다. 다른 멤버에게는 라이브가 계속 진행 중으로 보인다(관찰된 버그: "계속 유지되네").

## 목표

발표자가 의도적으로 라이브 페이지를 **이탈(탭/창 닫기, 새로고침, 다른 사이트로 이동)**하면 세션이 자동으로 전역 종료(`/end`)된다.

## 범위

**In**
- `live-room.tsx`에 발표자 전용 언로드 핸들러 추가: 현재 사용자가 **활성 세션의 발표자일 때만** `window`의 `pagehide`(보조로 `beforeunload`)에서 `POST /api/live/<id>/end`를 `navigator.sendBeacon`(폴백 `fetch(..., { keepalive: true })`)으로 전송.
- 중복 전송 방지(`endSentRef`): `pagehide`+`beforeunload` 동시 발화, 또는 `라이브 종료` 버튼 종료 후 언로드돼도 **최대 1회**.

**Out (이번 범위 아님 — best-effort 합의)**
- **크래시·강제종료·네트워크 끊김·노트북 절전** — 언로드 이벤트가 발화하지 않아 못 잡는다. 필요해지면 LiveKit 웹훅(`participant_left`)을 추후 추가. 그때까지는 관리자 강제 종료(👑, 기존 `/end` 권한)로 보완.
- **앱 내부 SPA 이동**(Next `<Link>`로 /dashboard 등) — soft nav라 `pagehide` 미발화. 별개의 기존 거친 부분(발표자는 토큰 유실로 복귀 불가)이며 이번 변경 대상 아님.
- 서버 라우트·LiveKit·DB·Prisma 스키마 무변경. `/end`를 그대로 재사용.

## 아키텍처 (델타)

| 파일 | 변경 |
|---|---|
| `components/live/live-room.tsx` | 발표자 언로드 종료 effect + `endSentRef` 추가. 버튼 종료(`handleEnd`)는 effect 의존성(`live`/`session`)이 바뀌며 리스너가 자동 정리되므로 별도 플래그 세팅 불필요 |
| `components/live/__tests__/live-room.test.tsx` | 발표자 `pagehide` → end beacon / 시청자 미전송 / 단일 언로드 `beforeunload`+`pagehide` 1회 전송 테스트 보강 |

**안 건드림:** `app/api/live/[id]/end/route.ts`(인증·발표자 권한·팀 스코핑·LiveKit 룸 삭제·`live.ended` 브로드캐스트를 이미 다 함), `/leave`·`/start`·`livekit.ts`·다른 live 컴포넌트.

## 동작 상세

### 트리거: `pagehide` (+ `beforeunload` 보조)

- `pagehide`는 탭/창 닫기·새로고침·외부 이동 등 **풀 언로드**에서 발화하며 bfcache·모바일에서도 `beforeunload`보다 신뢰도가 높다. 둘 다 등록하되 `endSentRef`로 1회만 전송.
- **탭 전환(visibilitychange)은 쓰지 않는다** — 단순 탭 전환은 이탈이 아니므로 종료하면 안 된다.

### 전송: `navigator.sendBeacon`

```ts
// live-room.tsx (발표자 전용 effect)
React.useEffect(() => {
  if (!live || !session || !isPresenter) return;
  const endOnUnload = () => {
    if (endSentRef.current) return;
    endSentRef.current = true;
    const url = `/api/live/${session.id}/end`;
    if (navigator.sendBeacon) navigator.sendBeacon(url); // POST, 같은 출처 쿠키 포함
    else void fetch(url, { method: "POST", keepalive: true });
  };
  window.addEventListener("pagehide", endOnUnload);
  window.addEventListener("beforeunload", endOnUnload);
  return () => {
    window.removeEventListener("pagehide", endOnUnload);
    window.removeEventListener("beforeunload", endOnUnload);
  };
}, [live, session, isPresenter]);
```

- `sendBeacon`은 언로드 중에도 안전하게 전송되고 **같은 출처 쿠키를 포함**하므로 `/end`의 `requireAuth`(세션 쿠키)·발표자 권한 검증이 그대로 동작. `/end`는 본문을 읽지 않아 빈 비콘으로 충분.
- `endSentRef`(`React.useRef(false)`)는 **단일 언로드에서 `pagehide`+`beforeunload`가 둘 다 발화해도 1회만** 보내도록 막는다. 버튼 종료(`라이브 종료`) 후엔 `live=false`로 effect가 정리돼 리스너가 사라지므로 별도 처리가 필요 없다.

### 발표자 새로고침 = 종료 (의도된 동작 변화)

기존: 발표자가 새로고침하면 토큰을 잃고 "종료 후 다시 시작해주세요" 막다른 화면 + 세션은 `active` 유지. 변경 후: 새로고침(=풀 언로드) 시 `/end`가 호출돼 세션이 종료되고, 발표자는 깨끗한 `라이브 시작` 상태로 돌아온다. 어차피 새로고침은 발표 화면 복구가 불가했으므로 종료가 더 정직하다(사용자 승인).

## 흐름

1. 발표자가 라이브 중 탭/창 닫기·새로고침·외부 이동 → `pagehide` → `sendBeacon('/api/live/<id>/end')`.
2. `/end`(기존): 발표자/팀 검증 → `active=false`·`endedAt` → LiveKit 룸 삭제 → `live.ended` 브로드캐스트.
3. 다른 멤버는 Realtime `live.ended`로 라이브 종료를 즉시 반영(폴링 아님, R33).
4. 시청자 이탈은 변화 없음 — 기존 `나가기`(`/leave`, 본인만 퇴장) 유지.

## 테스트 (TDD — 먼저 작성)

JSDOM에는 `navigator.sendBeacon`이 없으므로 `vi.stubGlobal`/`Object.defineProperty`로 목 주입하고, `window.dispatchEvent(new Event("pagehide"))`로 발화시킨다.

- `live-room.test.tsx`(보강):
  - **발표자**: 시작해 룸 진입 후 `pagehide` 발화 → `sendBeacon`이 `/api/live/<id>/end`로 호출.
  - **시청자**: 룸 진입 후 `pagehide` 발화 → `sendBeacon` **미호출**(발표자만).
  - **중복 방지**: 발표자 단일 언로드에서 `beforeunload`+`pagehide` 둘 다 발화 → `sendBeacon` **1회만**.
  - 회귀: 기존 발표자/시청자 시나리오 그린 유지.

## 구현 순서 (각 단계 RED→GREEN)

1. `live-room.test.tsx` — 위 3개 테스트 추가(RED).
2. `live-room.tsx` — `endSentRef` + 발표자 언로드 effect(GREEN).
3. 전체 `tsc`/`vitest`/`lint` 그린 확인.

## 커밋 정책

사용자가 지시할 때, 위 델타 파일 경로만 스테이징해 단독 커밋. conventional commits(`feat(live): …`). 그 전까지 미커밋 유지.

## 가정 / 미해결

- `pagehide`/`beforeunload` 미발화 경로(크래시·네트워크·절전·SPA 이동)는 best-effort로 미보장 — 합의된 범위. 빈번해지면 LiveKit 웹훅으로 승격.
- `sendBeacon` 미지원(구형) 시 `fetch(keepalive)` 폴백. 둘 다 같은 출처 쿠키를 보낸다고 가정.
- 서버 `/end`는 멱등에 가깝다고 가정(중복 호출 시 `active=false` 재설정·룸 재삭제 best-effort·`live.ended` 재브로드캐스트). 중복은 클라 `endSentRef`로 1차 차단.
