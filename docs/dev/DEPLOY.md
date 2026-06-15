# 배포 런북 (Deploy)

> 코드는 **모든 문서화된 기능이 구현 완료**다(build·test·lint·E2E green). 이 문서는 그 코드를 **운영에 올리는 단계**만 다룬다. 대부분 외부 계정/키 설정이라 사용자가 직접 수행한다. 스택 근거는 [`../agent/ADR.md`](../agent/ADR.md) ADR-016, 변수는 [`./ENV.md`](./ENV.md).

## 구성 요약 (ADR-016)

| 구성 | 서비스 | 앱이 이미 갖춘 것 | 사용자가 할 일 |
|---|---|---|---|
| 호스팅 | **Vercel** (Next.js 15) | `next build`·`postinstall: prisma generate` | 프로젝트 연결 + 환경변수 입력 |
| DB | **Supabase Postgres** | `schema.prisma`(postgresql·directUrl) | 프로젝트 생성 + `prisma db push` |
| 인증 | **Supabase Auth (Google OAuth)** + 초대 게이트 | `/api/auth/google`·`/auth/callback`·invite-gate | 대시보드에 Google Client ID/Secret 입력 |
| 실시간 | **Supabase Realtime** | `lib/realtime.ts`·LiveProvider 구독 | Realtime 활성(기본 on) |
| 스토리지 | **Supabase Storage** | `lib/storage.ts`(프리사인/서명 URL) | 비공개 버킷 생성 |
| 잡 | **Inngest** | `app/api/inngest`·`worker/analyze-paper` | Inngest 앱 연결(prod 키) |
| 라이브 | **Cloudflare Stream Live** | `lib/cloudflare.ts`·live 라우트 | 계정 토큰 + 웹훅 등록 |
| 분석 | **Google Gemini** | `lib/analysis.ts`(`@google/genai`) | `GEMINI_API_KEY` 발급 |

## 순서

### 1. Supabase
1. 프로젝트 생성 → `Project Settings > Database`에서 **pooler**(`DATABASE_URL`)와 **direct**(`DIRECT_URL`) 연결 문자열 복사.
2. 스키마 적용: 로컬에서 두 URL을 `.env`에 넣고 `npx prisma db push` (마이그레이션 파일 대신 push — ADR-016 노트). 시드가 필요하면 `npx prisma db seed`.
3. **Auth > Providers > Google** 활성 + Google Cloud Console의 OAuth Client ID/Secret 입력. 리디렉트 URL에 `{APP_BASE_URL}/auth/callback` 등록(→ [`./ENV.md`](./ENV.md) §인증). **공개 가입 없음** — 합류는 초대받은 이메일만(ADR-007/R18).
4. **Storage**: `SUPABASE_STORAGE_BUCKET`(예: `hapark`) **비공개** 버킷 생성. 앱이 서명 URL로만 접근(R36).
5. **Realtime**: 기본 활성. `live` 브로드캐스트 채널을 쓴다(별도 설정 불필요).
6. `NEXT_PUBLIC_SUPABASE_URL`·`NEXT_PUBLIC_SUPABASE_ANON_KEY`·`SUPABASE_SERVICE_ROLE_KEY` 복사. **service role은 서버 전용**(R2).

### 2. Cloudflare Stream (라이브가 필요할 때만)
1. `CLOUDFLARE_ACCOUNT_ID` + Stream 권한 API 토큰(`CLOUDFLARE_STREAM_API_TOKEN`) 발급.
2. 녹화 완료 웹훅을 `{APP_BASE_URL}/api/webhooks/cloudflare`로 등록하고 서명 시크릿을 `CLOUDFLARE_WEBHOOK_SECRET`에 넣는다(HMAC 검증, S4.6).
> 키가 없으면 앱은 정상 배포되고 라이브 화면의 빈 상태/시작 버튼까지 동작한다 — **실제 송출만** 키가 있어야 한다.

### 3. Inngest
1. Inngest 앱 생성 → `INNGEST_EVENT_KEY`·`INNGEST_SIGNING_KEY` 발급.
2. 배포 후 Inngest 대시보드에서 서브 URL `{APP_BASE_URL}/api/inngest`를 등록(sync). 분석 잡(`paper/analyze`)이 여기로 라우팅된다.

### 4. Gemini
- `GEMINI_API_KEY` 발급(서버 전용). 모델은 `GEMINI_MODEL`(기본 `gemini-2.5-pro`).

### 5. Vercel
1. 레포 연결(프레임워크 Next.js 자동 감지, 별도 `vercel.json` 불필요).
2. **Environment Variables**에 [`./ENV.md`](./ENV.md) 변수 전부 입력. `APP_BASE_URL`은 운영 도메인. `AUTH_SECRET`·`INVITE_TOKEN_SECRET`은 새 난수.
3. 배포. `postinstall`이 `prisma generate`를 돌린다. 빌드 후 §3-2 Inngest sync, §2-2 Cloudflare 웹훅의 도메인을 운영 URL로 갱신.

## 배포 전 체크 (로컬에서 green 확인)

```bash
npm run build
npm test            # 153 passed
npm run lint        # No ESLint warnings or errors
npx playwright test # 9 passed
```

## 키 없이도 되는 것 / 키가 있어야 하는 것

- **키 없이 배포·동작:** 전 화면 렌더, 초대/팀/스케줄/논문 목록·상세·노트/발표 자료·회고 댓글, 라이브 **빈 상태 + 시작 버튼**.
- **키가 있어야 실제 동작:** 논문 분석 결과 생성(Gemini+Inngest), PDF 업로드 저장(Supabase Storage), Google 로그인(Supabase Auth), 라이브 **송출/시청**(Cloudflare), 전이 실시간 푸시(Supabase Realtime).

> 비밀 키는 `.env`/Vercel 환경변수에만. **커밋 금지**(`.gitignore`). `NEXT_PUBLIC_`은 anon·URL 같은 공개값에만 — service role·API 토큰·시크릿에 붙이지 마라(R2).

## 팀 스코핑 마이그레이션 (ADR-020) — 검토 후 수동 실행

> `8-team-scoping` phase가 코드/스키마에 도메인 엔티티 팀 스코핑(`teamId`)을 도입했다(ADR-020/R37). `schema.prisma`는 6개 모델(Paper · Presentation · ScheduleMonth · FineConfig · MemberLedger · LiveSession)에 `teamId`를 **이미** 갖고 있으나, **운영 Supabase에는 아직 push되지 않았다.** 아래 절차를 사람이 검토 후 실행하기 전까지 prod 스키마는 `teamId` 미반영 상태다(그동안 운영 앱은 phase 8 이전 코드로 배포된 상태를 유지한다 — 팀 스코핑 코드와 prod 스키마를 동시에 올린다).
>
> **CRITICAL: 자동/헤드리스로 실행하지 마라.** 공유 운영 DB이며 제약/PK 변경이 포함된다(ADR-020). 순서를 지킨다: **컬럼 추가 → 백필 → (필요 시) 제약 확정.** 데이터가 있는 테이블에 non-null + 제약을 한 번에 적용하면 기존 행 때문에 실패할 수 있다.

### 절차

1. **백업/스냅샷 확인(Supabase).** Dashboard > Database > Backups에서 최신 백업(또는 PITR 복구 지점)을 확인한다. 제약/PK 변경 전 복구 지점을 확보한다.

2. **스키마 push (teamId 추가).** 현재 `schema.prisma`는 `teamId String @default("")`로 모델링돼 있다 — 기존 행은 빈 문자열로 채워지므로 컬럼 추가가 안전하다(non-null 위반 없음). 이 `@default("")`는 "default 후 백필"을 위한 의도적 sentinel이다(step 1).
   ```bash
   npx prisma db push   # DIRECT_URL = Supabase 직결(5432)
   ```
   - 복합 제약/PK도 이 schema에 이미 포함돼 있다(`ScheduleMonth @@unique([teamId,year,month])` · `FineConfig @@id([teamId,year])` · `MemberLedger` 관계+`@@unique`). 기존 단일 워크스페이스에선 `year`/`(year,month)`가 이미 유일하므로 `teamId=""` 동안에도 복합 키가 유일해 push가 통과한다.
   - **단계적 대안**(데이터 상태상 제약 충돌로 막힐 때): 임시 브랜치에서 `teamId`를 우선 nullable(`String?`)로 두고 복합 제약을 뺀 schema로 push → 3번 백필 → 4번에서 non-null + 제약 복원 push.

3. **백필 실행.** 빈(`""`) `teamId` 행을 부트스트랩 팀(가장 먼저 생성된 `Team` = 시드 이관 '하박조팽')으로 채운다 — `backfillTeamScoping()`(`lib/backfill-teams.ts`, **멱등**). 일회용 tsx 스크립트(`@/` 별칭은 tsconfig paths로 해소)나 seed에서 호출한다.
   ```bash
   # 예: backfillTeamScoping()를 호출하는 임시 스크립트(prisma/backfill-run.ts) 작성 후
   npx tsx prisma/backfill-run.ts   # 모델별 갱신 행 수를 출력. 0팀이면 no-op(안전).
   ```
   - `""` 행만 대상이라 이미 다른 팀에 속한 행은 건드리지 않는다(다른 팀에 새지 않게). 두 번 돌려도 안전하다.

4. **(2의 단계적 대안을 썼을 때만) 제약 확정 push.** `teamId`를 non-null로 되돌리고 복합 제약을 schema에 복원한 뒤 `npx prisma db push`. 기본 경로(2에서 한 번에 push)면 생략한다.

5. **Vercel 재배포.** 새 스키마와 정합한 빌드(phase 8 코드)로 배포한다.

6. **검증.** 두 팀으로 로그인(또는 활성 팀 전환)해 대시보드/라이브러리/발표자료/스케줄/라이브가 **활성 팀 데이터로만** 보이는지 확인한다(R37). 다른 팀 논문 URL 직접 진입은 "찾을 수 없음"(404 등가, R19). 로컬에서 운영 DB를 가리킨 채 `npx playwright test`(`tests/e2e/team-scoping.spec.ts` 포함)가 green이어야 한다 — **이 마이그레이션 전에는 팀 스코핑된 읽기가 prod 스키마와 불일치해 인앱 E2E가 실패한다.**
