# 논문 분석: arXiv 외 학술 PDF URL 지원

> 작성일 2026-06-17 · 상태: 설계 승인됨(구현 대기)

## 배경 / 문제

현재 논문 업로드는 두 경로뿐이다.

1. PDF 파일 직접 업로드(프리사인)
2. **arXiv URL** — 서버가 `arxiv.org`에서 PDF를 받아 저장

`lib/arxiv.ts`의 `parseArxivId`는 SSRF 방어를 위해 **호스트를 `arxiv.org`만** 허용한다(`SECURITY.md` §파일 스토리지, `lib/arxiv.ts` CRITICAL 주석). 그래서 CVF Open Access(`https://openaccess.thecvf.com/.../paper.pdf`)처럼 arXiv가 아닌 학술 PDF는 가져올 수 없다.

**목표:** arXiv 외의 주요 학술 출처 PDF URL도 분석할 수 있게 한다. SSRF 보안 경계는 유지하되 화이트리스트를 넓히는 방식으로.

## 위협 모델 / 보안 판단

- 이 앱은 **초대제 4인 비공개**(`SECURITY.md` §위협 모델). 업로드는 신뢰된 멤버만 가능하므로 공개 앱 대비 SSRF 위험이 낮다.
- 그래도 내부망/메타데이터 주소(`169.254.169.254`, `localhost`, 사설 IP) fetch는 막아야 한다.
- **결정:** 임의 URL 허용이 아니라 **학술 호스트 화이트리스트 확장**(기존 패턴과 동일, 가장 안전). 새 출처는 그때그때 목록에 추가한다.

## 설계

### 핵심 아이디어

`parseArxivId`(arxiv 전용)를 일반화한 **PDF 소스 해석기**를 둔다.
- arXiv는 기존처럼 ID 파싱 + `/abs`→`/pdf` 변환을 유지한다.
- 그 외 화이트리스트 호스트는 **사용자가 붙여넣은 직접 PDF 링크를 그대로 사용**한다(URL 변환 없음).
- PDF 여부는 기존 route의 `Content-Type: application/pdf` 검사가 이미 보장한다 — 그래서 비-arxiv는 `.pdf` 확장자를 강제하지 않는다(OpenReview `/pdf?id=...`처럼 확장자 없는 직접 링크 허용).

### 1) 새 모듈 `lib/paper-url.ts` (순수 함수, 서버 전용)

```ts
interface PaperSource {
  pdfUrl: string;        // 서버가 fetch할 직접 PDF URL
  arxivId: string | null; // arxiv면 표준 ID, 아니면 null
  title: string;         // 생성 시 넣을 플레이스홀더 제목
}

function resolvePaperSource(input: string): PaperSource | null
```

해석 규칙:
- **arxiv**: `parseArxivId`(기존)로 ID 추출 성공 시
  → `{ pdfUrl: arxivPdfUrl(id), arxivId: id, title: "arXiv:" + id }`
- **화이트리스트 호스트**: `https` + 호스트 정확 일치 시
  → `{ pdfUrl: 입력 URL, arxivId: null, title: <URL 파일명 유도> }`
- 그 외: `null` (SSRF 거부)

화이트리스트:
```
openaccess.thecvf.com    // CVF (CVPR/ICCV/WACV) — 직접 .pdf
openreview.net           // ICLR/NeurIPS — /pdf?id=...
aclanthology.org         // ACL/EMNLP/NAACL — /xxx.pdf
proceedings.mlr.press    // PMLR (ICML/AISTATS) — 직접 .pdf
proceedings.neurips.cc   // NeurIPS — 직접 .pdf
```

- `https`만 허용(http 거부). 호스트는 **정확 일치**(서브도메인 사칭·유사 도메인 차단 — 기존 arxiv 패턴 그대로 `Set.has(hostname)`).
- 제목 유도: URL 마지막 경로 세그먼트에서 `.pdf`를 떼고 `decodeURIComponent`.
  예) `.../Shastry_Favoring_One_Among_Equals_..._WACV_2024_paper.pdf`
  → `Shastry_Favoring_One_Among_Equals_..._WACV_2024_paper`
  경로 세그먼트가 비면(쿼리만 있는 경우 등) 호스트명을 제목으로 둔다.
- **이유:** 분석 잡(`persistAnalysis`)은 제목을 채우지 않는다(`analysisStatus`만 `ready`로 전이). 따라서 생성 시점 제목이 그대로 노출된다 → 의미 있는 플레이스홀더가 필요.

### 2) `app/api/papers/route.ts`

- 요청 필드 `arxivUrl` → **`sourceUrl`** 로 일반화(`ArxivBody` → `SourceBody`, `hasKey(body, "sourceUrl")`).
- `resolvePaperSource(sourceUrl)` 호출 → `null`이면 400("논문 주소를 확인해주세요.").
- 해석된 `pdfUrl`을 fetch — 이후 흐름은 **기존 arxiv 경로와 동일**:
  Content-Type=`application/pdf` 검사(415) → `assertPageLimit`(30쪽, 413) → `uploadPdf` → `prisma.paper.create`.
- `create` 데이터: `title`은 해석기가 준 제목, `arxiv`는 `arxivId`(null 가능). 나머지(teamId·uploadedBy·pending)는 기존과 동일.
- fetch 실패 메시지는 arxiv 특정 문구 대신 일반화("논문 PDF를 가져오지 못했어요.").

### 3) `components/upload/upload-modal.tsx` (현재 워킹트리 quota 버전 위에 얹음)

- 라벨 "또는 arXiv 주소로 가져오기" → **"또는 논문 URL로 가져오기"**.
- placeholder를 CVF/arXiv 예시로(예: `https://arxiv.org/abs/... 또는 https://openaccess.thecvf.com/.../paper.pdf`).
- 상태/함수명 `arxivUrl`→`sourceUrl`, `importArxiv`→`importUrl`, body 키 `sourceUrl`.
- 빈 입력 안내문 "arXiv 주소를 입력해주세요." → "논문 주소를 입력해주세요."
- 에러 폴백 문구 일반화.

### 4) 문서

- `SECURITY.md` §파일 스토리지: SSRF 화이트리스트 설명을 arxiv 단일 → 학술 호스트 목록으로 갱신.
- `lib/arxiv.ts` 상단 CRITICAL 주석: "arxiv.org만" → 새 화이트리스트 모듈로의 포인터 추가(arxiv.ts 자체는 여전히 arxiv 전용).

## 데이터 흐름

```
[모달] sourceUrl 입력 → POST /api/papers { sourceUrl }
  → requireAuth · getActiveTeam · 주간 한도 검사
  → resolvePaperSource(sourceUrl)            // SSRF 게이트(화이트리스트)
      ├ null → 400
      └ { pdfUrl, arxivId, title }
  → fetch(pdfUrl)                            // 화이트리스트 호스트에 한정
      ├ !ok → 502
      ├ content-type ≠ application/pdf → 415
      └ bytes
  → assertPageLimit(bytes)                   // >30쪽 → 413
  → uploadPdf(path, bytes)
  → paper.create({ title, arxiv: arxivId, pdfUrl: path, teamId, uploadedBy, pending })
  → inngest.send(paper/analyze)              // 분석은 잡에서(R31)
  → 201 { id }
```

## 에러 처리

| 상황 | 응답 |
|---|---|
| 화이트리스트 밖 호스트 / http / 형식 오류 | 400 BAD_REQUEST |
| 원격 fetch 실패(네트워크/4xx/5xx) | 502 BAD_GATEWAY |
| Content-Type이 PDF 아님 | 415 UNSUPPORTED_MEDIA_TYPE |
| 30쪽 초과 | 413 PDF_TOO_LONG |
| 주간 한도 초과 | 429 (기존) |

SSRF 안전성: `resolvePaperSource`가 통과시킨 URL만 fetch하므로 fetch 대상은 화이트리스트 호스트로 한정된다(기존 arxiv 불변식과 동일).

## 테스트 (TDD — 테스트 먼저, CLAUDE.md CRITICAL)

- **새** `lib/__tests__/paper-url.test.ts`:
  - arxiv 입력 → `{ pdfUrl: arxiv pdf, arxivId, title }`
  - 화이트리스트 각 호스트(https) → 입력 URL 그대로 + arxivId=null + 제목 유도
  - 거부: 화이트리스트 밖 호스트, `http://`, 사설/링크로컬 IP(`169.254.169.254`), 사칭 서브도메인(`openaccess.thecvf.com.evil.com`), 빈 입력/비-URL
  - 제목 유도: `.pdf` 제거 + decode, 세그먼트 없을 때 호스트 폴백
- **갱신** `app/api/papers/__tests__/papers-create.test.ts`: `arxivUrl`→`sourceUrl`, `@/lib/arxiv` 목 → `@/lib/paper-url` 목으로(또는 resolvePaperSource 목 추가). 비-arxiv URL 경로가 teamId·uploadedBy를 올바로 넣는지.
- **갱신** `components/upload/__tests__/upload-modal.test.tsx`: 라벨/필드 `sourceUrl` 반영.
- 기존 `lib/__tests__/arxiv.test.ts`는 변경 없음(arxiv 로직 불변).

## 범위 밖 (YAGNI)

- OpenReview `/forum?id=`→`/pdf?id=` 등 호스트별 URL 자동 변환(직접 PDF 링크 요구로 충분).
- 임의 호스트 허용 / DNS 리바인딩·리다이렉트 IP 재검증(4인 신뢰 모델 + 정적 호스트 화이트리스트로 충분, 기존 arxiv와 동일한 리다이렉트 정책 유지).
- 호스트별 서지 메타데이터(제목/저자/연도) 스크래핑 — 제목은 URL 유도 플레이스홀더로 둔다.

## 영향 받는 파일

- 신규: `lib/paper-url.ts`, `lib/__tests__/paper-url.test.ts`
- 수정: `app/api/papers/route.ts`, `components/upload/upload-modal.tsx`,
  `app/api/papers/__tests__/papers-create.test.ts`, `components/upload/__tests__/upload-modal.test.tsx`,
  `docs/security/SECURITY.md`, `lib/arxiv.ts`(주석)
