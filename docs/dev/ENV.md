# 환경 변수 · 논문 분석 파이프라인 (ENV)

> 예시 파일은 루트 [`/.env.example`](../../.env.example)다. 실제 값은 `.env`에 넣고 **절대 커밋하지 않는다**(`.gitignore` 처리됨). API·모델은 [`./API.md`](./API.md), 시퀀스는 [`./SEQUENCE_DIAGRAM.md`](./SEQUENCE_DIAGRAM.md)를 본다.

## 원칙

- **CRITICAL: 모든 비밀(API 키·토큰·시크릿)은 `.env`에서 읽고, 서버 코드에서만 접근한다.** 클라이언트 컴포넌트/번들에 노출 금지(CLAUDE.md: 외부 API 직접 호출 금지). `NEXT_PUBLIC_` 접두사를 비밀에 붙이지 마라.
- `.env`는 커밋 금지. 새 변수를 추가하면 `.env.example`에 키와 한 줄 설명을 함께 추가한다.

## 변수 목록

| 변수 | 용도 | 비고 |
|---|---|---|
| `ANTHROPIC_API_KEY` | 논문 분석 LLM 호출 | **비밀.** 서버 전용 |
| `ANALYSIS_MODEL` | 분석 모델 ID | 기본 `claude-opus-4-8` |
| `DATABASE_URL` | Prisma 연결 | 개발 `file:./dev.db`(SQLite), 운영 Supabase Postgres(ADR-016) |
| `DIRECT_URL` | Prisma 마이그레이션 직결 | 운영(Supabase) 시 |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 프로젝트 URL | 공개 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon 키 | 공개(클라이언트 OK) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase 서버 권한 키 | **비밀! 서버 전용** — 클라 노출 금지 |
| `AUTH_SECRET` | 세션 서명 | **비밀** |
| `INVITE_TOKEN_SECRET` | 초대 토큰 서명 | **비밀** (초대 전용, ADR-007) |
| `APP_BASE_URL` | 초대 링크·OAuth 리디렉트 | 예: `http://localhost:3000` |
| `SUPABASE_STORAGE_BUCKET` | PDF·에셋·figure 스토리지 | 비공개 버킷 + 서명 URL(→ [`../security/SECURITY.md`](../security/SECURITY.md)) |
| `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_STREAM_API_TOKEN` | 라이브(Stream Live) | **비밀.** ADR-002 |

## 인증 (Google OAuth via Supabase Auth)

로그인은 **Supabase Auth의 Google OAuth**(ADR-017). **초대 전용 유지**(ADR-007) — Google 로그인 성공 이메일이 수락된 `Member`이거나 유효한 초대일 때만 합류/세션. Google OAuth 클라이언트(Client ID/Secret)는 앱이 아니라 **Supabase 대시보드 Auth > Providers > Google**에 입력한다. `SUPABASE_SERVICE_ROLE_KEY`는 서버에서만. 키가 없을 땐 step4의 dev 이메일 로그인이 로컬 폴백.

## 논문 분석 파이프라인 (LLM)

PRD는 "AI 자동 요약을 핵심 기능으로 내세우는 것"을 폐기했다(→ [`../user/PRD.md`](../user/PRD.md) §3). 그러나 분석 데이터의 비교/ablation 표·figure 해석에는 **"AI 추출"** 표기가 있다 — LLM은 **헤드라인 기능이 아니라, 사람이 검수·보강하는 구조화 추출 보조**로 쓴다. 추출된 분석은 항상 섹션별 협업 노트로 사람이 덧쓴다(ADR-005).

### 동작 (S1 보강 → [`./SEQUENCE_DIAGRAM.md`](./SEQUENCE_DIAGRAM.md))

```
PDF 업로드/arXiv → 스토리지 저장(pdfUrl) → Paper 저장(analysisStatus=pending) + Job 적재 → 즉시 응답
   ↓ (외부 durable 잡 러너)
   잡 러너가 Claude에 PDF document 블록 + 구조화 출력 스키마로 호출
   → Analysis(research)/Analysis(repro) payload + Figure[] 저장, analysisStatus=ready|failed
   → 사람이 섹션 노트로 검수·보강
```

> **CRITICAL: 분석은 요청 경로(route handler)에서 인라인으로 돌리지 않는다.** Claude 분석은 분 단위라 Vercel 함수 시간 제한·HTTP 타임아웃을 넘는다. 반드시 **외부 durable 잡 러너**(Inngest/Trigger.dev/QStash)에서 처리한다(→ [`./ARCHITECTURE.md`](./ARCHITECTURE.md) §백그라운드 작업, ADR-013→016). `POST /api/papers`는 잡만 트리거하고 즉시 응답한다.

### 구현 지침 (시그니처 수준)

- **SDK:** `@anthropic-ai/sdk` (이 프로젝트는 TS). 클라이언트는 `new Anthropic()`이 `ANTHROPIC_API_KEY`를 환경에서 읽는다 — 키를 하드코딩하지 않는다.
- **모델:** `process.env.ANALYSIS_MODEL ?? "claude-opus-4-8"`.
- **PDF 입력:** 메시지에 `document` 블록(`source.type: "base64"` 또는 Files API `file_id`)으로 원문 PDF를 넣는다.
- **구조화 출력:** `output_config.format`(json_schema)으로 두 관점 스키마(problem/contributions/io/comparison/ablation | data/model/loss/metrics/training/gpu)를 강제한다 — 파싱 안정성 확보.
- **긴 출력:** 분석 페이로드가 크므로 스트리밍 + `.finalMessage()` 권장(타임아웃 방지).
- **figure 해석:** 추출된 figure 이미지는 vision(image 블록)으로 캡션·해석을 생성하되, 이미지가 없으면 `imageUrl=null`로 두고 수동 업로드 허용(미결 → [`../agent/ISSUES.md`](../agent/ISSUES.md)).

```ts
// lib/analysis.ts (시그니처 예시 — 서버 전용)
import Anthropic from "@anthropic-ai/sdk";
const client = new Anthropic(); // ANTHROPIC_API_KEY 자동 사용

export async function extractAnalysis(pdf: Buffer, lens: "research" | "repro"): Promise<AnalysisPayload> {
  // document(PDF) 블록 + output_config.format(json_schema)로 호출,
  // 스트리밍 후 finalMessage()에서 구조화 결과 파싱.
}
```

- **CRITICAL: 잡 러너에서 실행.** `extractAnalysis`는 외부 durable 잡 러너가 호출한다 — route handler 인라인 호출 금지(타임아웃, ADR-013→016). route handler는 잡만 트리거.
- **CRITICAL: 비용·실패 처리.** 분석 실패가 업로드 자체를 막지 않게 한다 — Paper는 저장되고 `analysisStatus=failed`로 재시도 가능. `stop_reason`을 확인하고 `refusal`/`max_tokens`를 처리한다.
- **CRITICAL: 키는 서버에서만.** 클라이언트는 절대 Anthropic을 직접 호출하지 않는다. 클라이언트는 `/api/papers`만 호출한다(→ [`./CODING_CONVENTION.md`](./CODING_CONVENTION.md)).

## 로컬 셋업

```bash
cp .env.example .env   # 값 채우기 (최소 ANTHROPIC_API_KEY, AUTH_SECRET)
npm install
npx prisma migrate dev # DATABASE_URL 기준 스키마 적용 + 시드
npm run dev
```
