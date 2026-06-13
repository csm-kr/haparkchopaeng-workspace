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
