# Step 4: scoped-writes-live

도메인 **쓰기**를 활성 팀으로 스코핑하고(teamId 주입 + 교차 팀 차단), **라이브를 팀당 1개**로 만든다. TeamSwitcher 전환이 실제 화면 스코프를 바꾸게 마무리.

## 읽어야 할 파일

먼저 아래를 읽고 설계 의도를 파악하라. **정본은 루트 `README.md` · `CLAUDE.md` · `PRD.md`.**

항상:
- `docs/dev/ARCHITECTURE.md`(쓰기=route handler/Server Action) · `docs/agent/ADR.md`(**ADR-020·ADR-019·ADR-015**) · `docs/dev/CODING_CONVENTION.md`
- `docs/agent/RULES.md` — **R37·R3·R6·R7·R19**

이전 step 산출물:
- step 1 스키마(teamId, LiveSession.teamId), step 2 `getActiveTeam`, step 3 스코핑된 읽기

수정 대상:
- 쓰기 라우트: `POST app/api/papers` · `POST app/api/presentations`(+ comments/reactions) · `PUT/POST app/api/schedule/...` · `PUT app/api/fines/...`
- 라이브: `lib/live.ts`(`getActiveSession`) · `app/api/live/start` · `app/api/live/[id]/join|leave|end` · `lib/livekit.ts`(`roomName`) · `components/live/`(룸이 팀 컨텍스트로)
- `components/shell/TeamSwitcher`(전환 → revalidate 마무리)

## 작업

### 1. 도메인 쓰기 스코핑
- 생성/수정 라우트에서 `const team = await getActiveTeam(session.memberId)`로 teamId를 구하고, **생성 시 teamId를 주입**한다(클라가 보낸 teamId 미신뢰, R3).
- 수정/삭제는 대상 엔티티의 teamId가 활성 팀과 일치하는지 확인 — 불일치 `403`(또는 404). 댓글·반응·노트는 부모(Presentation/Paper)의 teamId로 검사.
- 스케줄/벌금은 `(teamId, year, month)`·`(teamId, year)` 키로 — 낙관적 락(R35) 유지하되 팀 스코프 안에서.

### 2. 라이브 팀당 1개 (ADR-019 → ADR-020 개정)
- `lib/live.ts`: `getActiveSession()` → **`getActiveSession(teamId)`** (where: `{ active: true, teamId }`).
- `POST /api/live/start`: 활성 팀 teamId 주입, `getActiveSession(teamId)` 충돌 검사(팀당 1개, 409), `LiveSession.create({ teamId, presenterId })`. 토큰 룸 이름에 팀 포함.
- `lib/livekit.ts` `roomName(sessionId)` 유지 가능(sessionId가 이미 팀 고유) — 단 세션이 팀 소속이므로 join은 **세션의 teamId가 내 활성 팀(=멤버십)인지 확인** 후 토큰 발급(R19).
- `/join`·`/end`·`/leave`: 대상 세션 teamId가 호출자 멤버십인지 확인(교차 팀 라이브 차단).
- `app/(app)/layout.tsx`의 `getActiveSession`(initialLive)도 활성 팀 인자로.
- `app/(app)/meeting/page.tsx`·`components/live/`: 활성 팀 세션을 주입(룸은 팀 스코프).

### 3. TeamSwitcher 마무리
- 전환 시 활성 팀 쿠키 변경 + `revalidatePath`로 대시보드·라이브러리·발표자료·스케줄·라이브가 새 팀 데이터로 갱신.

## Acceptance Criteria

```bash
npm run build
npm test
npm run lint
```

테스트(먼저 작성):
- **교차 팀 쓰기 차단**: 활성 팀 A로 B의 논문/발표자료/스케줄 수정·삭제 시도 → 403/404. 생성 teamId가 클라 입력이 아니라 활성 팀에서 주입(R3).
- **라이브 팀당 1개**: 팀 A 세션 active 중 A가 또 start → 409. 팀 B는 A 세션과 무관하게 start 가능. `/join`·`/end`가 교차 팀 세션 차단.
- prisma/LiveKit 목.

## 검증 절차

1. AC 실행.
2. 체크리스트: 쓰기 teamId가 활성 팀 주입인가(R3)? 교차 팀 변이 차단(R19)? 라이브 팀당 1개(ADR-020)? `/end`만 전역 종료·`/leave` 본인(R6) 유지? 화면공유 발표자만(R7) 유지?
3. `phases/8-team-scoping/index.json`의 step 4 업데이트.

## 금지사항

- **클라가 보낸 teamId를 신뢰하지 마라.** 이유: 활성 팀(검증된 멤버십)에서 주입 — 아니면 다른 팀에 쓰기 가능(R3/R19).
- **라이브를 다시 전역 1개로 되돌리지 마라.** 이유: ADR-020은 팀당 1개다. 단, "동시 active 1개"의 *팀 내* 불변(R6)은 유지.
- **운영 DB에 쓰지 마라.** 이유: 테스트는 목/테스트 DB. 실 마이그레이션은 step 5 수동.
- 기존 테스트를 깨뜨리지 마라(phase 7 라이브 테스트를 팀 스코프로 갱신하되, /end·/leave·화면공유 불변은 유지).
