# Step 4: live-cleanup-e2e

이제 LiveKit 경로가 완성됐으니, ADR-019로 **죽은 Cloudflare 단방향 방송 코드를 제거**하고, 배선을 정리하고, **Playwright E2E**로 라이브 룸 흐름(헤드리스·실 SFU 없이)을 검증한다.

## 읽어야 할 파일

먼저 아래 문서를 읽고 아키텍처와 설계 의도를 파악하라. **정본은 루트 `README.md` · `CLAUDE.md` · `PRD.md`이며, 충돌 시 이를 따른다.**

항상:
- `docs/dev/ARCHITECTURE.md` · `docs/agent/ADR.md`(**ADR-019**) · `docs/dev/CODING_CONVENTION.md`

레이어:
- `docs/user/USER_FLOW.md` — E2E로 검증할 핵심 경로
- `docs/dev/API.md` — 라이브 엔드포인트(웹훅 제거 반영됨)
- `docs/agent/RULES.md` — R26·R29·R30

이전 step 산출물:
- `lib/livekit.ts`·`lib/live-messages.ts`(step 1)
- 개조된 라이브 라우트(step 1)
- `components/live/live-room.tsx` + 하위 컴포넌트(step 2·3)

**삭제 대상**(읽어서 의존 관계 확인 후 제거):
- `lib/cloudflare.ts` · `lib/__tests__/cloudflare.test.ts`
- `lib/whip.ts` · `lib/__tests__/whip.test.ts`
- `components/live/broadcast-panel.tsx` · `components/live/__tests__/broadcast-panel.test.tsx`
- `components/live/hls-player.tsx` · `components/live/__tests__/hls-player.test.tsx`
- `app/api/webhooks/cloudflare/route.ts`(+ 그 `__tests__`가 있으면)

배선/정리 대상:
- `components/live/index.ts` — 삭제된 컴포넌트 export 제거
- `app/(app)/meeting/page.tsx` · `app/(app)/meeting/loading.tsx` — 룸 props 정합 확인
- `components/shell/live-banner.tsx` · `components/shell/nav.ts` — `/meeting` 링크 유지 확인(보통 변경 없음)
- `tests/e2e/meeting.spec.ts` — 새 룸 흐름으로 갱신
- `package.json` — `hls.js` 의존성 제거

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

### 1. 죽은 Cloudflare 방송 코드 제거
- 위 "삭제 대상" 파일을 모두 삭제한다.
- 이들을 import하던 곳을 정리한다. 이 시점엔 step 1~3에서 이미 라우트·live-room이 LiveKit으로 옮겨갔으므로, 남은 참조는 `components/live/index.ts`의 export 정도여야 한다. `grep -ri "cloudflare\|hls-player\|broadcast-panel\|publishWhip\|getLiveInputPlayback\|hls.js" app lib components` 로 잔여 참조 0을 확인한다.
- `package.json`에서 `hls.js`를 제거하고(더 이상 import 없음) `npm install`로 lockfile 정합.
- `prisma/schema.prisma`의 `LiveSession.cloudflareLiveInputId`·`recordingUrl`은 **그대로 둔다**(미사용 레거시). 이유: 컬럼 제거는 공유 운영 DB에 `db push`를 유발 — 이번 phase 범위 밖(ADR-019 트레이드오프에 명시).

### 2. 배선 정리
- `components/live/index.ts`: `LiveRoom`만(필요 시 step 2/3 하위 컴포넌트) export. 삭제된 컴포넌트 export 제거.
- `app/(app)/meeting/page.tsx`·`loading.tsx`: 룸이 토큰을 라우트에서 받으므로 페이지는 `currentMemberId`·`initialSession`·`members`만 주입(정합 확인). 스켈레톤은 룸 레이아웃과 어긋나지 않게.

### 3. Playwright E2E (`tests/e2e/meeting.spec.ts` 갱신)
**실제 SFU/미디어 없이 헤드리스로 통과해야 한다**(execute.py 비대화형). LiveKit 키가 없을 때의 정직한 동작을 검증:
- `/meeting` 진입 → 라이브 없음 빈 상태 + `[라이브 시작]` 보임(R26 빈).
- (키 미설정 환경) `[라이브 시작]` → 503의 친절한 사유 메시지 노출(R30) — "연결되지 않았어요" 류. **실제 LiveKit 연결을 요구하지 않는다.**
- 사이드바 LIVE 배지/`/meeting` 링크 등 셸 정합.
- 공유 운영 DB 비파괴 원칙(메모리: e2e는 비파괴·데이터 가변 가정)을 지킨다 — 실제 세션을 만들어 두고 떠나지 않는다. 세션 생성 흐름은 유닛(step 1 라우트 테스트)이 이미 커버하므로, E2E는 **빈/게이팅/미설정 안내**에 집중.

> 다자간 실제 연결(두 참가자 영상)은 키가 필요해 E2E로 검증하지 않는다 — 그건 실행 후 사람이 키를 넣고 수동 확인한다(아래 검증 절차 참고).

## Acceptance Criteria

```bash
npm run build
npm test
npm run lint
npx playwright test
```

- `npm test`: 삭제된 테스트 제외 후 전부 green. Cloudflare/whip/hls 잔여 참조 0.
- `npx playwright test`: 라이브 빈 상태·미설정 안내 흐름 통과(헤드리스).

## 검증 절차

1. 위 AC 커맨드 실행.
2. 아키텍처 체크리스트:
   - 라이브 경로에 Cloudflare/HLS/WHIP 잔여 참조가 0인가(grep 확인)?
   - `hls.js` 의존성이 제거됐고 빌드가 깨지지 않는가?
   - E2E가 실제 SFU/키 없이 헤드리스로 통과하는가(빈/미설정 안내)?
   - 스키마 변경·`db push`가 없는가(레거시 컬럼은 남겨둠)?
3. `phases/7-live-conference/index.json`의 step 4 업데이트(성공 `completed`+summary / 실패 `error` / 사람 개입 `blocked`).
4. **summary에 다음을 반드시 적는다**: "실 다자간 검증은 LiveKit Cloud 키(`LIVEKIT_URL`/`LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET`) 주입 후 수동" — 운영 배선의 마지막 수동 단계를 다음 사람이 알도록.

## 금지사항

- **라이브 외의 코드를 건드리지 마라.** 이유: 이 step은 Cloudflare 방송 제거 + 라이브 배선/E2E 한정(surgical). 무관한 리팩터 금지.
- **스키마 컬럼을 제거하거나 `prisma db push`를 실행하지 마라.** 이유: 공유 운영 DB 영향 — 레거시 컬럼은 무해하게 남긴다(ADR-019).
- **E2E에서 실제 LiveKit 연결·미디어 권한을 요구하지 마라.** 이유: execute.py는 비대화형 헤드리스 — 키·카메라 없이 통과해야 한다.
- **E2E에서 공유 운영 DB에 파괴적 데이터를 남기지 마라.** 이유: 공유 DB·비파괴 원칙(라이브 세션을 active로 켜둔 채 종료하지 않기).
- 기존 테스트(라이브 외)를 깨뜨리지 마라.
