# Figure 이미지 자동 추출 (PDF → 크롭 이미지)

작성일: 2026-06-14

## 배경

논문 분석 잡(`analyzePaper`)은 Gemini로 figure **메타데이터**(제목·캡션·해석·`sourcePage`)만
추출하고 `imageUrl`은 항상 `null`로 둔다. 코드 주석에 "이미지 렌더 파이프라인은 추후(I-1) —
수동 업로드 허용"으로 명시돼 있다. 그 결과 화면에는 "이미지 없음 — 수동 업로드 대기"가 뜨고,
지금은 사람이 그림을 손으로 채워 넣어야 한다.

## 목표

분석할 때 **PDF에서 figure 이미지까지 자동으로 추출**해 `imageUrl`을 채운다. 수동 업로드 단계를 없앤다.

## 결정 사항 (사용자 확정)

1. **표시 형태**: figure **그림 영역만 잘라낸 크롭 이미지**. (페이지 전체 X, 내장 이미지 추출 X)
2. **bbox 실패 시**: 해당 figure의 위치를 못 잡으면 **그 페이지 전체를 렌더링**해 fallback으로 보여준다.
   ("이미지 없음"으로 비우지 않는다.)

## 접근법

채택: **① Gemini bounding box + 단일 호출 + 페이지 래스터화 + 크롭.**

- 기존 figure 추출 Gemini 호출의 응답 스키마에 `box` 필드만 추가한다(호출 횟수 증가 없음).
- `box`가 가리키는 페이지를 wasm PDF 렌더러로 이미지화하고, bbox 영역만 크롭해 저장한다.

반려한 대안:
- **② 2단계 이미지 그라운딩**(모든 페이지 렌더 → 페이지 이미지로 bbox 재검출): bbox 정확도는 최고지만
  전 페이지 렌더 + Gemini 호출·토큰 대폭 증가. 과도하다.
- **③ PDF 내장 이미지(XObject) 직접 추출**: 벡터 다이어그램(ML 논문에 흔함)이 누락된다. 부적합.

## 아키텍처 / 모듈 경계

| 모듈 | 변경 | 책임 |
|---|---|---|
| `lib/analysis.ts` | 수정 | `FIGURES_SCHEMA`/`FIGURES_PROMPT`에 `box` 추가, `FigureExtract`에 `box` 필드. `extractFigures`가 box 파싱 |
| `lib/figure-render.ts` | **신규** | 서버 전용. PDF + figure 목록 → 페이지 렌더 → 크롭/페이지 fallback → PNG 업로드 → `imageUrl`(스토리지 경로) 채워 반환 |
| `lib/storage.ts` | 수정 | `uploadPng(path, body)` 헬퍼 추가(비공개 버킷, contentType image/png) |
| `lib/analysis.ts` (오케스트레이션) | 수정 | `AnalyzePaperDeps`에 `renderFigures` 추가. `extractFigures` 결과를 렌더 단계에 넘겨 imageUrl을 채운 뒤 persist |
| `app/api/figures/[id]/image/route.ts` | **신규** | 비공개 버킷 → 단기 서명 URL 302 리디렉트(PDF 라우트와 동일 패턴, R36) |
| `lib/papers.ts` | 수정 | figure 매핑: `imageUrl: f.imageUrl ? `/api/figures/${f.id}/image` : null` |
| `app/api/papers/[id]/route.ts` | 수정 | 논문 삭제 시 `figures/{paperId}/` 객체 정리(best-effort) |

`Figure.imageUrl`(String?) 컬럼이 이미 존재하므로 **DB 마이그레이션은 없다**. `pdfUrl`처럼
스토리지 **경로**를 저장한다(서명 URL·공개 URL을 DB에 박지 않는다, R36).

## 데이터 흐름

```
PDF 로드
  → Promise.all( extractAnalysis(research), extractAnalysis(repro), extractFigures(+box) )
  → renderFigures(pdf, paperId, figures)      // 페이지 렌더 → 크롭/fallback → 업로드 → imageUrl 채움
  → persistAnalysis (트랜잭션: Analysis upsert · Figure 재생성(imageUrl=경로) · status=ready)
```

`renderFigures`는 `loadPdf`/`extractFigures`와 같은 주입 의존성(`AnalyzePaperDeps`)으로 둔다 —
테스트에서 가짜를 주입한다(기존 패턴 유지).

## 상세 설계

### figure 스키마 / 프롬프트 (`lib/analysis.ts`)

- `FIGURES_SCHEMA.items.properties`에 `box` 추가:
  `box: { type OBJECT, properties: { ymin, xmin, ymax, xmax: INTEGER } }` (정규화 0–1000).
- `FIGURES_PROMPT`에 "각 figure를 감싸는 bounding box를 0–1000 정규화 좌표 `[ymin,xmin,ymax,xmax]`로
  채운다"를 추가한다. (Gemini 객체 검출 규약과 동일 포맷.)
- `FigureExtract`에 `box: FigureBox | null` 추가, `imageUrl`은 렌더 단계가 채우므로 추출 단계에선 `null` 유지.

### 렌더 파이프라인 (`lib/figure-render.ts`)

`renderFigures(pdf: Buffer, paperId: string, figures: FigureExtract[]): Promise<FigureExtract[]>`

figure 하나당:
1. `pageIndex = clamp(sourcePage - 1, 0, pageCount - 1)` (sourcePage는 1-based).
2. mupdf로 페이지를 `scale = 150/72`(≈150 DPI)로 렌더 → 페이지 PNG + 픽셀 폭/높이 `W,H`.
3. `box`가 유효하면 픽셀 변환 후 sharp로 크롭:
   - `left=xmin/1000·W`, `top=ymin/1000·H`, `width=(xmax-xmin)/1000·W`, `height=(ymax-ymin)/1000·H`
   - 경계 클램프. `width<=0 || height<=0`이면 무효 → fallback.
4. **fallback**(box 없음/무효): 페이지 PNG 전체를 그대로 사용.
5. `uploadPng("figures/{paperId}/{index}.png", buf, upsert:true)` → `imageUrl = 그 경로`.
6. 페이지 렌더는 페이지 인덱스별로 1회만(같은 페이지의 여러 figure가 공유).

### 서빙 (`app/api/figures/[id]/image/route.ts`)

`requireAuth` → `figure.imageUrl`(경로) 조회 → 없으면 404 → `signedDownloadUrl(path, 60)` → 302 리디렉트.
`<img src="/api/figures/{id}/image">`가 302를 따라가 이미지를 받는다. (PDF 라우트와 동일.)

### 매핑 (`lib/papers.ts`)

`getPaperDetail`의 figure 매핑에서 저장 경로를 라우트 URL로 변환:
`imageUrl: f.imageUrl ? `/api/figures/${f.id}/image` : null`.
`analysis-view.tsx`는 변경 없음(`f.imageUrl` 있으면 `<img>`, 없으면 기존 "이미지 없음" UI).

## 에러 처리 / 격리

- **figure 단위 격리**: 한 figure의 렌더/크롭/업로드가 실패하면 그 figure만 `imageUrl=null`로 두고
  나머지는 계속 처리한다. 분석 전체를 `failed`로 만들지 않는다(R28 정신).
- PDF 자체를 못 열면 모든 figure가 fallback 없이 `imageUrl=null` — 메타데이터 분석(research/repro)은
  보존된다.
- 스토리지 정리(논문 삭제)는 best-effort — 실패해도 DB 삭제를 막지 않는다(기존 `removeObject` 정책).

## 의존성

- **추가**: `mupdf`(Artifex 공식 wasm PDF 렌더러, native 의존성 없음 → Vercel Node 서버리스 호환).
- **기존 활용**: `sharp`(이미 설치됨, 크롭용).
- `next.config.ts`의 `serverExternalPackages`에 `mupdf` 등록이 필요할 수 있다(번들 제외) — 구현 중 검증.

## 테스트 전략 (TDD — CLAUDE.md CRITICAL)

기존 `lib/__tests__/analysis.test.ts`의 의존성 주입·모킹 패턴을 확장한다.

- `extractFigures`: 응답에 `box`가 오면 파싱해 `FigureExtract.box`에 담는다 / `box` 없으면 `null`.
- `figure-render`(mupdf·sharp·storage 모킹):
  - box 유효 → 올바른 픽셀 좌표로 sharp.extract 호출 + `figures/{paperId}/{i}.png` 업로드.
  - box 무효/없음 → 페이지 전체 PNG로 fallback 업로드.
  - 같은 페이지의 두 figure → 페이지 렌더 1회만.
  - 한 figure 업로드 실패 → 그 figure만 `imageUrl=null`, 나머지는 채움.
- 오케스트레이션: `renderFigures`가 채운 `imageUrl`이 `figure.createMany`에 반영되는지.
- 서빙 라우트: 경로 있으면 302 + 서명 URL, 없으면 404, 미인증 차단.

## 리스크

- **Gemini bbox 정확도**가 핵심 변수다. PDF 입력에서 bbox 품질이 들쭉날쭉할 수 있다 → 구현 초기에
  실제 논문 1편으로 "bbox→크롭" 결과를 눈으로 검증하는 스파이크를 먼저 한다. 품질이 나쁘면 fallback
  비중이 높아질 뿐 기능은 깨지지 않는다.
- **서버리스 실행 시간/메모리**: 페이지 렌더가 잡 시간을 늘린다. Inngest 스텝 단위 타임아웃에 유의.
  필요하면 렌더를 별도 `step.run`으로 분리(후속 최적화, 1차 범위 밖).
- mupdf 페이지 인덱싱(0-based) vs `sourcePage`(1-based) off-by-one — 클램프로 방어.

## 범위 밖 (YAGNI)

- 수동 figure 이미지 업로드 UI(자동 추출로 대체되므로 추가하지 않는다).
- 렌더를 별도 Inngest 스텝으로 분리하는 최적화(필요 확인 후 후속).
- figure 이미지 캐싱/리사이즈 변형, 줌/라이트박스 UI.
