# Step 14: papers-upload

PDF 업로드(드래그앤드롭 또는 arXiv URL) → Supabase Storage 저장 → `Paper`(analysisStatus=pending) 생성. 업로드 모달 + 프리사인 업로드 + 원문 PDF 서명 다운로드. 분석 실행은 다음 step(jobs-analysis).

## 읽어야 할 파일

먼저 아래 문서를 읽고 설계 의도를 파악하라. **정본은 루트 `README.md` · `CLAUDE.md` · `PRD.md`이며, 충돌 시 이를 따른다.**

항상:
- `docs/dev/ARCHITECTURE.md` — §외부 경계(Supabase Storage 프리사인/서명 URL)·데이터 흐름
- `docs/agent/ADR.md` — **ADR-003(PDF 전용)·ADR-016(Supabase)·ADR-013→016(분석은 잡)**. 고치지 말 것.
- `docs/dev/CODING_CONVENTION.md`

이 step(화면 + 스토리지 쓰기):
- `docs/user/USER_FLOW.md` — **F2(업로드)** 단계(idle→uploading→analyzing→done)·에러 분기
- `docs/design/SCREEN_FLOW.md` — §upload 모달 상태 머신
- `docs/design/SCREENS.md` — UploadModal(PDF 전용 드롭존 + arXiv)
- `docs/dev/API.md` — `/api/uploads/presign`·`POST /api/papers`·`/api/papers/:id/pdf`(서명 URL)
- `docs/dev/ENV.md` — `SUPABASE_STORAGE_BUCKET`·service role(서버 전용)
- `docs/security/SECURITY.md` — 프리사인 업로드·비공개 버킷·서명 URL·arXiv SSRF 화이트리스트
- `docs/agent/RULES.md` — R12(PDF 전용)·R28(업로드≠분석)·R36(프리사인/서명 URL)·R2(service role 서버전용)·R3·R20

이전 step 산출물(재사용):
- `lib/supabase/admin.ts`(service role — Storage 서버 작업), `lib/supabase/server.ts`
- `lib/prisma.ts`·`lib/papers.ts`(Paper 생성/조회 패턴), `lib/auth.ts`(세션)
- `components/ui/*`, `app/(app)/dashboard`·`library`의 `＋ 업로드` 진입점(있으면 연결)
- `types/`(Paper·AnalysisStatus), `app/api/auth/login/route.ts`(E2E), `playwright.config.ts`

## 작업

### 1. 스토리지 헬퍼 — `lib/storage.ts` (서버 전용)
- `ensureBucket()`: `SUPABASE_STORAGE_BUCKET`(예: `hapark`) **비공개 버킷**을 멱등 생성(admin/service role). 모듈 로드시 throw 금지(호출 시점 env).
- `createSignedUploadUrl(path)`: 클라이언트 직접 업로드용 서명 URL(프리사인). `signedDownloadUrl(path, ttl)`: 단기 서명 다운로드 URL.
- **CRITICAL: service role 키는 서버에서만**(R2). 공개 버킷·영구 URL 금지(R36).

### 2. 업로드 흐름 — 모달 + Server Action/route
- **UploadModal**(클라이언트 섬): idle → uploading(진행률) → done. **PDF 전용 드롭존**(accept `application/pdf`만, 그 외 인라인 에러 "PDF만 올릴 수 있어요", 415) + **arXiv URL 입력**. PPTX/MD·빈 노트 단축 없음(R12/ADR-003).
- 파일 업로드: `POST /api/uploads/presign`(서명 URL 발급) → 클라가 **Supabase Storage에 직접 업로드** → `POST /api/papers`에 객체 경로 전달.
- arXiv: `POST /api/papers`에 URL → **서버**가 `arxiv.org/pdf/{id}` PDF fetch(**SSRF 화이트리스트: arxiv.org만**) → Storage 저장.
- `POST /api/papers`: `Paper` 생성(`pdfUrl`=스토리지 경로, `analysisStatus="pending"`, `uploadedBy`=세션 R3). **분석을 인라인 실행하지 마라** — pending으로 두고 다음 step의 잡이 처리(R28/ADR-013→016). done 시 `/papers/:id`로 이동.

### 3. 원문 PDF 다운로드 — `app/api/papers/[id]/pdf/route.ts`
- 세션 확인 후 `signedDownloadUrl`로 **리디렉트**(비공개 버킷, 단기 서명 URL, R36). paper-analysis 헤더의 ⬇원문 PDF 버튼을 이 라우트로 연결.

### 4. E2E (핵심 경로 1개)
- `tests/e2e/upload.spec.ts`: dev 로그인 → ＋업로드 모달 열기 → **비-PDF 거부**(인라인 에러)·arXiv 입력 필드 표시 확인. (실제 Storage 업로드는 E2E에서 수행하지 않음 — UI/검증까지.)

## Acceptance Criteria

```bash
npm run build
npm test                 # vitest run — RTL: PDF 전용 검증·arXiv 입력·업로드 단계 전이; storage 헬퍼는 모킹
npm run lint
npx playwright test      # 헤드리스: 모달 열기·비PDF 거부·arXiv 필드
```
> 실제 Supabase Storage 업로드/다운로드는 런타임(키 있음)에서 동작. E2E/단위는 UI·검증·모킹까지. 키/버킷 문제로 빌드·검증조차 불가하면 `blocked`.

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트:
   - **PDF 전용**인가(그 외 415·인라인 에러, R12/ADR-003)?
   - 업로드가 **프리사인 직접 업로드**, 다운로드가 **서명 URL**(비공개 버킷)인가(R36)? service role이 서버 전용인가(R2)?
   - arXiv fetch가 **서버 + arxiv.org 화이트리스트**인가(SSRF)?
   - **분석을 인라인 실행하지 않고** Paper를 pending으로 두는가(R28/ADR-013→016)? 업로더=세션(R3)?
3. 결과에 따라 `phases/0-mvp/index.json`의 step14를 업데이트:
   - 성공 → `"completed"` + `"summary"`
   - 3회 실패 → `"error"` + `"error_message"`
   - 키/버킷 등 외부설정 필요 → `"blocked"` + `"blocked_reason"`(필요 항목 명시) 후 중단

## 금지사항

- **PDF 외 형식(PPTX/MD)·빈 노트/아이디어 메모 업로드 경로를 만들지 마라**(R12/ADR-003).
- **분석을 업로드 요청에서 인라인 실행하지 마라.** pending으로 두고 잡이 처리(R28/ADR-013→016).
- **service role 키를 클라이언트에 노출하지 마라**(R2). 공개 버킷·영구 URL 금지(R36).
- **arXiv 외 임의 URL을 서버가 fetch하지 마라**(SSRF — arxiv.org 화이트리스트).
- **업로더(uploadedBy)를 클라 입력으로 신뢰하지 마라**(세션, R3).
- **모듈 로드 시점에 Storage 키를 강제로 읽어 throw하지 마라**(호출 시점). **hex 하드코딩 금지**(R20).
- **`test` 워치 모드·E2E 비헤드리스 금지**.
- 기존 테스트를 깨뜨리지 마라.
