# 환경 변수 · 논문 분석 파이프라인 (ENV)

> 예시 파일은 루트 [`/.env.example`](../../.env.example)다. 실제 값은 `.env`에 넣고 **절대 커밋하지 않는다**(`.gitignore` 처리됨). API·모델은 [`./API.md`](./API.md), 시퀀스는 [`./SEQUENCE_DIAGRAM.md`](./SEQUENCE_DIAGRAM.md)를 본다.

## 원칙

- **CRITICAL: 모든 비밀(API 키·토큰·시크릿)은 `.env`에서 읽고, 서버 코드에서만 접근한다.** 클라이언트 컴포넌트/번들에 노출 금지(CLAUDE.md: 외부 API 직접 호출 금지). `NEXT_PUBLIC_` 접두사를 비밀에 붙이지 마라.
- `.env`는 커밋 금지. 새 변수를 추가하면 `.env.example`에 키와 한 줄 설명을 함께 추가한다.

## 변수 목록

| 변수 | 용도 | 비고 |
|---|---|---|
| `GEMINI_API_KEY` | 논문 분석 LLM(Google Gemini) 호출 | **비밀.** 서버 전용 |
| `GEMINI_MODEL` | 분석 모델 ID | 기본 `gemini-2.5-pro` |
| `PAPER_WEEKLY_LIMIT` | 인당 주간(월요일 00:00 KST 리셋) 논문 업로드 한도 — Gemini 비용 가드 | 미설정 시 운영=20·그 외 무제한, 0 이하=무제한 |
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

## 인증 (Google OAuth via Supabase Auth)

로그인은 **Supabase Auth의 Google OAuth**(ADR-017). **초대 전용 유지**(ADR-007) — Google 로그인 성공 이메일이 수락된 `Member`이거나 유효한 초대일 때만 합류/세션. Google OAuth 클라이언트(Client ID/Secret)는 앱이 아니라 **Supabase 대시보드 Auth > Providers > Google**에 입력한다. `SUPABASE_SERVICE_ROLE_KEY`는 서버에서만. 키가 없을 땐 step4의 dev 이메일 로그인이 로컬 폴백.

## 논문 분석 파이프라인 (LLM)

PRD는 "AI 자동 요약을 핵심 기능으로 내세우는 것"을 폐기했다(→ [`../user/PRD.md`](../user/PRD.md) §3). 그러나 분석 데이터의 비교/ablation 표·figure 해석에는 **"AI 추출"** 표기가 있다 — LLM은 **헤드라인 기능이 아니라, 사람이 검수·보강하는 구조화 추출 보조**로 쓴다. 추출된 분석은 항상 섹션별 협업 노트로 사람이 덧쓴다(ADR-005).

### 동작 (S1 보강 → [`./SEQUENCE_DIAGRAM.md`](./SEQUENCE_DIAGRAM.md))

```
PDF 업로드/arXiv → 스토리지 저장(pdfUrl) → Paper 저장(analysisStatus=pending) + Job 적재 → 즉시 응답
   ↓ (외부 durable 잡 러너)
   잡 러너가 Gemini에 PDF inlineData + responseSchema(구조화 출력)로 호출
   → Analysis(research)/Analysis(repro) payload + Figure[] 저장, analysisStatus=ready|failed
   → 사람이 섹션 노트로 검수·보강
```

> **CRITICAL: 분석은 요청 경로(route handler)에서 인라인으로 돌리지 않는다.** Gemini 분석은 분 단위라 Vercel 함수 시간 제한·HTTP 타임아웃을 넘는다. 반드시 **Inngest 잡**에서 처리한다(→ [`./ARCHITECTURE.md`](./ARCHITECTURE.md) §백그라운드 작업, ADR-013→016). `POST /api/papers`는 잡만 트리거하고 즉시 응답한다.

### 구현 지침 (시그니처 수준) — Google Gemini

- **SDK:** `@google/genai` (Google 최신 통합 GenAI SDK; 구 `@google/generative-ai`는 deprecated). **Anthropic SDK·claude-api 가이드는 쓰지 않는다.**
- **클라이언트:** `new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })` — 키는 서버 환경에서만, 하드코딩 금지.
- **모델:** `process.env.GEMINI_MODEL ?? "gemini-2.5-pro"`.
- **PDF 입력:** PDF를 `inlineData`(base64, mimeType `application/pdf`) 또는 Files API로 contents에 넣는다.
- **구조화 출력:** `config.responseMimeType="application/json"` + `config.responseSchema`로 두 관점 스키마(problem/contributions/io/comparison/ablation | data/model/loss/metrics/training/gpu)를 강제 — 파싱 안정성 확보.
- **figure 해석:** 추출된 figure 이미지를 비전 입력(inlineData image)으로 캡션·해석 생성. 이미지가 없으면 `imageUrl=null`로 두고 수동 업로드 허용(미결 → [`../agent/ISSUES.md`](../agent/ISSUES.md)).

```ts
// lib/analysis.ts (시그니처 예시 — 서버 전용, Inngest 잡에서 호출)
import { GoogleGenAI } from "@google/genai";
const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function extractAnalysis(pdf: Buffer, lens: "research" | "repro"): Promise<AnalysisPayload> {
  // generateContent({ model, contents: [inlineData(pdf) + 프롬프트],
  //   config: { responseMimeType: "application/json", responseSchema } }) → JSON 파싱
}
```

- **CRITICAL: 잡 러너에서 실행.** `extractAnalysis`는 Inngest 잡이 호출한다 — route handler 인라인 호출 금지(타임아웃, ADR-013→016). route handler는 잡만 트리거.
- **CRITICAL: 비용·실패 처리.** 분석 실패가 업로드 자체를 막지 않게 한다 — Paper는 저장되고 `analysisStatus=failed`로 재시도 가능. Gemini 안전 차단(`blockReason`)·빈 응답을 처리한다.
- **CRITICAL: 키는 서버에서만.** 클라이언트는 절대 Gemini를 직접 호출하지 않는다. 클라이언트는 `/api/papers`만 호출한다(→ [`./CODING_CONVENTION.md`](./CODING_CONVENTION.md)).

## 로컬 셋업

```bash
cp .env.example .env   # 값 채우기 (최소 GEMINI_API_KEY, Supabase 키, AUTH_SECRET)
npm install
npx prisma db push     # Supabase 스키마 동기화 + npx prisma db seed
npx inngest-cli dev    # (jobs용) 로컬 Inngest Dev Server
npm run dev
```
