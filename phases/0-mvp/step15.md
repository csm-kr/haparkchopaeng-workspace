# Step 15: jobs-analysis

논문 분석 파이프라인을 완성한다: **Inngest 잡**이 업로드된 PDF를 **Google Gemini**(`@google/genai`)로 두 관점 구조화 분석 + figure 해석 → `Analysis`/`Figure` 저장, `analysisStatus` pending→ready/failed. 분석은 요청 경로가 아니라 잡에서 실행한다.

## 읽어야 할 파일

먼저 아래 문서를 읽고 설계 의도를 파악하라. **정본은 루트 `README.md` · `CLAUDE.md` · `PRD.md`이며, 충돌 시 이를 따른다.**

항상:
- `docs/dev/ARCHITECTURE.md` — §백그라운드 작업(ADR-013→016)·외부 경계
- `docs/agent/ADR.md` — **ADR-011(Gemini 보조 추출)·ADR-013→016(잡 러너=Inngest)·ADR-004(두 관점·figure)**. 고치지 말 것.
- `docs/dev/CODING_CONVENTION.md`

이 step(잡 + LLM):
- `docs/dev/ENV.md` — **§구현 지침(Google Gemini)**: `@google/genai`·responseSchema·inlineData PDF·비전. `GEMINI_API_KEY`/`GEMINI_MODEL`·Inngest.
- `docs/dev/DB.md` — `Analysis(lens, payload)`·`Figure`·`Paper.analysisStatus`·`Job`(상태 미러)
- `docs/dev/SEQUENCE_DIAGRAM.md` — **S1**(업로드→잡→Gemini→ready/failed)
- `docs/dev/API.md` — `POST /api/papers/:id/reanalyze`
- `docs/agent/RULES.md` — R28(업로드≠분석)·R31(잡 러너, 인라인 금지)·R2(키 서버전용)·R32

이전 step 산출물(재사용):
- `lib/storage.ts`(서명 다운로드로 PDF 바이트 획득), `lib/prisma.ts`, `types/`(Analysis<L>·Figure·AnalysisStatus·Job)
- `app/api/papers/route.ts`(step14: Paper pending 생성 — **여기서 Inngest 이벤트 전송 추가**)
- `app/(app)/papers/[id]`(step9: pending/failed 상태블록·"다시 분석" 버튼 — reanalyze에 연결)

## 작업

### 1. Inngest 설정
- `inngest` 패키지 + `lib/inngest.ts`: `export const inngest = new Inngest({ id: "hapark" })`.
- `app/api/inngest/route.ts`: `serve({ client: inngest, functions: [analyzePaper] })`(inngest/next). 로컬은 Inngest Dev Server로 동작(키 없이), 프로덕션은 `INNGEST_*` 키.

### 2. 분석 함수 — `lib/analysis.ts` + Inngest function
- `lib/analysis.ts`(서버 전용): `@google/genai`로 호출.
  - `const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })`; 모델 `process.env.GEMINI_MODEL ?? "gemini-2.5-pro"`.
  - `extractAnalysis(pdfBytes, lens)`: PDF를 `inlineData`(base64, `application/pdf`) + 프롬프트로 `generateContent`, `config.responseMimeType="application/json"` + `config.responseSchema`(두 관점 스키마)로 호출 → `response.text` JSON 파싱.
  - figure 해석: 추출 figure 이미지(있으면)를 비전 입력으로 캡션/해석. 이미지 없으면 `imageUrl=null` 유지(수동 업로드 허용).
- `inngest.createFunction({ id: "analyze-paper", retries: 3 }, { event: "paper/analyze" }, async ({ event, step }) => {...})`:
  - `step.run`으로 ① Storage에서 PDF 로드 ② Gemini research ③ Gemini repro ④ figure 해석 ⑤ DB 저장(Analysis×2·Figure[]·`analysisStatus="ready"`). 실패 시 `analysisStatus="failed"` + `Job.lastError`. 멱등.

### 3. 트리거 + 재시도
- `POST /api/papers`(step14): Paper(pending) 생성 직후 `await inngest.send({ name: "paper/analyze", data: { paperId } })`. **분석을 인라인 실행하지 마라**(R28/R31).
- `POST /api/papers/:id/reanalyze`(requireAuth): `analysisStatus="pending"`으로 되돌리고 같은 이벤트 재전송. step9의 "다시 분석" 버튼에 연결.

### 4. 안전·실패 처리
- Gemini 안전 차단(`promptFeedback.blockReason`)·빈 후보·JSON 파싱 실패를 잡아 `failed`로. **업로드/Paper는 영향 없음**(R28).
- **키는 서버에서만**(R2). 클라이언트는 Gemini를 직접 호출하지 않는다.

## Acceptance Criteria

```bash
npm run build
npm test                 # vitest run — Gemini·Inngest 모킹: 분석 페이로드→Analysis/Figure 매핑, pending→ready/failed 전이, responseSchema 형태, 실패 격리(Paper 유지)
npm run lint
```
> 실제 분석은 런타임에 `GEMINI_API_KEY` + Inngest Dev Server(`npx inngest-cli dev`)로 동작. 단위 테스트는 Gemini 호출·Inngest를 모킹한다. 키 부재로 build/test조차 불가하면 `blocked`. (E2E는 이 백엔드 파이프라인에 불필요 — 화면 상태는 step9에서 검증됨.)

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트:
   - 분석이 **요청 경로가 아니라 Inngest 잡**에서 실행되는가(인라인 금지, R31/ADR-013→016)?
   - **업로드 성공 ≠ 분석 성공**이 유지되는가(실패 시 Paper·PDF 보존, `analysisStatus=failed`, R28)?
   - Gemini(`@google/genai`) responseSchema로 두 관점(research/repro) + figure 해석을 생성하는가(ADR-011/004)?
   - `GEMINI_API_KEY`가 서버에서만 쓰이는가(R2)? `Job`이 상태 미러로 갱신되는가?
3. 결과에 따라 `phases/0-mvp/index.json`의 step15를 업데이트:
   - 성공 → `"completed"` + `"summary"`
   - 3회 실패 → `"error"` + `"error_message"`
   - 키/외부설정 필요 → `"blocked"` + `"blocked_reason"`(필요 항목 명시) 후 중단

## 금지사항

- **분석을 route handler에서 인라인 실행하지 마라.** Inngest 잡에서만(R31/ADR-013→016). API는 이벤트만 전송.
- **Anthropic SDK·claude-api 가이드를 쓰지 마라.** LLM은 Google Gemini(`@google/genai`)다(ADR-011). `@anthropic-ai/sdk` 도입 금지.
- **분석 실패가 Paper 생성·원문 PDF를 막게 하지 마라**(R28). 실패는 `analysisStatus=failed` + 재시도.
- **`GEMINI_API_KEY`를 클라이언트에 노출하지 마라**(R2). 클라이언트가 Gemini 직접 호출 금지.
- **모듈 로드 시점에 키를 강제로 읽어 throw하지 마라**(호출 시점). 두 관점/탭 규칙(ADR-004) 위반 금지.
- **`test` 워치 모드 금지**(`vitest run`).
- 기존 테스트를 깨뜨리지 마라.
