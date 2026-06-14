# Step 1: figure-render

## 읽어야 할 파일

- `/docs/superpowers/specs/2026-06-14-figure-image-extraction-design.md` — "렌더 파이프라인", "에러 처리 / 격리", "의존성"
- `lib/analysis.ts` — step 0에서 추가된 `FigureExtract`(+`box`), `FigureBox`
- `lib/storage.ts` — `uploadPdf`/`signedDownloadUrl`/`removeObject` 패턴(서버 전용, 비공개 버킷, 호출 시점 env)

## 작업

서버 전용 figure 렌더 모듈을 신규로 만든다.

- `lib/storage.ts`: `uploadPng(path: string, body: Buffer): Promise<void>` 추가 — `uploadPdf`와 동일 패턴, `contentType: "image/png"`, `upsert: true`.
- `lib/figure-render.ts` (신규):
  - `renderFigures(pdf: Buffer, paperId: string, figures: FigureExtract[]): Promise<FigureExtract[]>`
  - figure 하나당:
    1. `pageIndex = clamp(sourcePage - 1, 0, pageCount - 1)` (sourcePage는 1-based).
    2. mupdf로 해당 페이지를 `scale = 150/72`로 렌더 → 페이지 PNG 버퍼 + 픽셀 `W,H`. **같은 페이지는 1회만 렌더**(인덱스별 캐시).
    3. `box` 유효 시 픽셀 변환 후 `sharp`로 크롭: `left=xmin/1000*W`, `top=ymin/1000*H`, `width=(xmax-xmin)/1000*W`, `height=(ymax-ymin)/1000*H`. 경계 클램프, `width<=0||height<=0`이면 무효 → fallback.
    4. fallback(box 없음/무효): 페이지 PNG 전체 사용.
    5. `uploadPng("figures/{paperId}/{index}.png", buf)` → `imageUrl = 그 경로`.
  - **figure 단위 격리**: 한 figure 렌더/크롭/업로드 실패 시 그 figure만 `imageUrl=null`로 두고 나머지는 계속(R28 정신). 반환은 입력과 같은 길이·순서.
- 의존성 추가: `mupdf`(wasm), `sharp`. `next.config.ts`의 `serverExternalPackages`에 `"mupdf"` 등록.

## Acceptance Criteria

```bash
npm install
npx tsc --noEmit
npx vitest run lib/__tests__/figure-render.test.ts
```

TDD: mupdf·sharp·storage를 모킹하고 — box 유효→올바른 픽셀 좌표로 `sharp.extract` + `figures/{paperId}/{i}.png` 업로드 / box 무효·없음→페이지 전체 fallback 업로드 / 같은 페이지 두 figure→페이지 렌더 1회 / 한 figure 업로드 실패→그 figure만 `imageUrl=null`.

## 금지사항

- `renderFigures`를 route handler/클라이언트에서 호출하지 마라. 이유: 서버 전용·Inngest 잡 경로다(R31).
- 서명 URL·공개 URL을 반환하지 마라. `imageUrl`엔 스토리지 **경로**만(R36).
- 한 figure 실패로 전체를 throw하지 마라. 이유: 격리(R28).
- 기존 테스트를 깨뜨리지 마라.
