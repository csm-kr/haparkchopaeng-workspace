# 환경 변수 · 논문 분석 파이프라인 (ENV)

> 예시 파일은 루트 [`/.env.example`](../../.env.example)다. 실제 값은 `.env`에 넣고 **절대 커밋하지 않는다**(`.gitignore` 처리됨). API·모델은 [`./API.md`](./API.md), 시퀀스는 [`./SEQUENCE_DIAGRAM.md`](./SEQUENCE_DIAGRAM.md)를 본다.

## 원칙

- **CRITICAL: 모든 비밀(API 키·토큰·시크릿)은 `.env`에서 읽고, 서버 코드에서만 접근한다.** 클라이언트 컴포넌트/번들에 노출 금지(CLAUDE.md: 외부 API 직접 호출 금지). `NEXT_PUBLIC_` 접두사를 비밀에 붙이지 마라.
- `.env`는 커밋 금지. 새 변수를 추가하면 `.env.example`에 키와 한 줄 설명을 함께 추가한다.

## 변수 목록

| 변수 | 용도 | 비고 |
|---|---|---|
| `GEMINI_API_KEY` / `GEMINI_MODEL` | 레거시 Gemini 어댑터 설정 | ADR-026의 업로드·명시적 로컬 분석·연구 채팅에서는 사용하지 않음. 자동 대체 경로도 없음. 키는 비밀이며 서버 전용 |
| `PAPER_WEEKLY_LIMIT` | 인당 주간(월요일 00:00 KST 리셋) 논문 업로드 한도 | 미설정 시 운영=20·그 외 무제한, 0 이하=무제한. CLI 구독 한도와 별개 |
| `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` | 잡 러너(프로덕션) | 로컬은 Inngest Dev Server(키 불필요) |
| `DATABASE_URL` | Prisma 연결(pooler) | Supabase Postgres(ADR-016) |
| `DIRECT_URL` | Prisma `db push`/마이그레이션 직결 | Supabase |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 프로젝트 URL | 공개 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon 키 | 공개(클라이언트 OK) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase 서버 권한 키 | **비밀! 서버 전용** — 클라 노출 금지 |
| `AUTH_SECRET` | 세션 서명 | **비밀** |
| `INVITE_TOKEN_SECRET` | 초대 토큰 서명 | **비밀** (초대 전용, ADR-007) |
| `APP_BASE_URL` | 초대 링크·OAuth 리디렉트 | 예: `http://localhost:3000` |
| `SUPABASE_STORAGE_BUCKET` | PDF·에셋·figure 스토리지 | 비공개 버킷 + 서명 URL(→ [`../security/SECURITY.md`](../security/SECURITY.md)) |
| `LIVEKIT_URL` | 라이브 다자간 화상(LiveKit) WebSocket URL | 예: `wss://xxx.livekit.cloud`. ADR-019 |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | LiveKit 입장 토큰 서명 | **비밀. 서버 전용.** ADR-019 |
| `MAX_TEAMS` | 전역 팀 생성 상한 **폴백** | 기본 `2`. `AppSetting.maxTeams`가 있으면 그쪽이 이긴다(ADR-024) |
| `ADMIN_EMAIL` | 관리자 콘솔(`/admin`) 접근 허용 이메일 | 기본 `de8167@gmail.com`. `Member.email`과 일치해야 통과 |
| `LIVE_MINUTES_QUOTA` | 월 라이브 한도(분) 표시 기준 | 기본 `1000` (LiveKit 플랜 값). 조절 UI 없음 |

## 인증 (Google OAuth via Supabase Auth)

로그인은 **Supabase Auth의 Google OAuth**(ADR-017). **초대 전용 유지**(ADR-007) — Google 로그인 성공 이메일이 수락된 `Member`이거나 유효한 초대일 때만 합류/세션. Google OAuth 클라이언트(Client ID/Secret)는 앱이 아니라 **Supabase 대시보드 Auth > Providers > Google**에 입력한다. `SUPABASE_SERVICE_ROLE_KEY`는 서버에서만. 키가 없을 땐 step4의 dev 이메일 로그인이 로컬 폴백.

## 논문 분석 파이프라인 (ADR-026)

논문 분석과 개인 연구 채팅은 사용자가 선택한 로컬 Codex·Claude Code로 실행한다. 별도 CLI OAuth 키나 제공자 API 키를 서버에 넣지 않는다. 기존 구독 로그인은 해당 PC의 CLI가 유지하며 연결기는 기기 자격을 OS 암호화 저장소에 보관한다. 분석 초안은 사람이 섹션 노트로 검수·보강한다(ADR-005).

```text
PDF 저장 → paper/analyze{paperId} → Inngest에서 원문 본문 준비(AI 0회)
  → sourceText/sourceDigest 저장 → awaiting_ai
사용자가 PC·제공자·실제 모델 선택 → POST /api/papers/:id/reanalyze
  → Job(prepare_local_analysis) → Inngest 준비 → LocalAgentJob(paper_analysis)
  → 승인한 PC에서 CLI 추론 → 서버 completed 접수
  → Inngest durable sleep/DB 조회 → strict JSON·원문 인용 검증·Figure 렌더
  → 최신 analysisRequestId CAS → research/repro/공통 Figure 저장
```

- 업로드와 새 분석 요청은 장기 추론을 기다리지 않는다. Inngest는 짧은 준비·조회·후처리 단계와 durable sleep으로 구성하며, 서버리스 요청에서 CLI나 장기 대기 Promise를 실행하지 않는다.
- 원문은 1~30쪽·본문 합계 12만 자까지 읽고 페이지 번호를 유지한다. PDF 준비 입력은 최대 20MB다. 스캔·초과·손상은 준비 실패로 안내하며 원본 PDF는 보존한다.
- 원문·문맥과 고정 프롬프트는 서버에서 구성한다. 분석은 JSON 형식·페이지·원문 인용·Figure 캡션을 검사한 뒤에만 저장한다. 현재 CLI는 텍스트 전용이므로 Figure는 본문·캡션 기반 추론, 외부 저장소는 미검증으로 표시한다.
- 모델 기본값은 없다. 현재 실제 CLI 목록에서 사용자가 선택하며, 연결·로그인·사용 한도 문제가 생겨도 Gemini나 다른 제공자·원격 유료 API로 자동 전환하지 않는다.
- 유효한 grant(2분) 중 서버가 이미 `completed`로 접수한 결과는 로그아웃 후 후처리·저장을 허용한다. 이후 새 추론·계속 실행·미접수 결과는 거절하며 최종 저장 시 현재 멤버십을 재확인한다.
- `/ai-chat`은 같은 연결과 선택 모델을 사용한다. 개인 이력을 읽어도 과거 실행 권한을 갱신하지 않는다. 기존 논문은 `POST /api/research-chat/sources {paperIds}`로 모델 없이 본문만 준비할 수 있으며 기존 분석을 다시 추론·변경하지 않는다. 상세 제한·응답은 [API](./API.md), 모델·수동 SQL은 [DB](./DB.md#local-ai-schema)를 따른다.

## 로컬 셋업

```bash
cp .env.example .env   # 서버 Supabase/Auth/Storage 설정. 로컬 AI에는 Gemini 키 불필요
npm install
npx inngest-cli dev    # (jobs용) 로컬 Inngest Dev Server
npm run dev
```

로컬 DB 스키마를 준비할 때도 공유 운영 URL을 상속하지 않는다. 자동 검증은 아래 격리 런처를 사용하고, 운영 스키마를 `db push`·`seed`로 동기화하지 않는다.

## 로컬 AI 연결

기존 서버 `AUTH_SECRET`를 사용하며 별도 CLI OAuth 키를 서버에 넣지 않는다. `LOCAL_AGENT_RELEASES`는 실제 설치 파일의 `platform`, `url`, `version`과 선택 `architecture`·`filename`을 담는 JSON 배열이다. 미설정은 빈 배포 목록이다. 설치앱 빌드에는 `CONNECTOR_APP_ORIGIN=https://hapark.vercel.app`을 주입한다. 이 값들은 `NEXT_PUBLIC_*`로 노출하지 않는다. [설치·검증·미설정 동작](./LOCAL_AGENT.md).

검증은 `npm run test:isolated` 또는 `test:local-agent*`를 사용한다. 공유 DB에 `db seed`를 실행해 테스트 실패를 고치지 않는다. 기존 연결 5개 테이블과 ADR-026 확장은 [DB 수동 적용 순서](./DB.md#local-ai-schema) 및 [운영 런북](./LOCAL_AGENT_RELEASE.md)을 따른다. 현재 운영 DB 적용은 하지 않았고 추가 전체 품질 검증은 진행 중이다(ADR-020/022/025/026).
