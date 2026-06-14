# Step 2: analysis-orchestration

## 읽어야 할 파일

- `/docs/superpowers/specs/2026-06-14-figure-image-extraction-design.md` — "데이터 흐름", "아키텍처 / 모듈 경계"
- `lib/analysis.ts` — `AnalyzePaperDeps`, `realDeps`, `analyzePaper`, `persistAnalysis`
- `lib/figure-render.ts` — step 1의 `renderFigures`
- `lib/__tests__/analysis.test.ts` — 오케스트레이션 테스트 패턴

## 작업

`lib/analysis.ts` 오케스트레이션에 렌더 단계를 끼워 넣는다.

- `AnalyzePaperDeps`에 `renderFigures(pdf: Buffer, paperId: string, figures: FigureExtract[]): Promise<FigureExtract[]>`를 추가한다.
- `realDeps.renderFigures`를 `lib/figure-render.ts`의 구현으로 연결한다.
- `analyzePaper`에서 `extractFigures` 직후, `persistAnalysis` 직전에 `figures = await deps.renderFigures(pdf, paperId, figures)`를 호출해 `imageUrl`을 채운 결과로 영속화한다.
- 렌더 단계 전체가 throw해도(예: PDF 못 엶) 분석 메타(research/repro)는 보존되도록 — 렌더 실패를 격리할지 여부는 스펙의 "에러 처리"를 따른다(figure 단위 격리는 step 1, 여기선 `renderFigures`가 던지지 않는 계약을 신뢰하되 방어적으로 둔다).

## Acceptance Criteria

```bash
npx tsc --noEmit
npx vitest run lib/__tests__/analysis.test.ts
```

TDD: `renderFigures`가 채운 `imageUrl`이 `figure.createMany` 데이터에 반영되는지 검증하는 오케스트레이션 테스트를 추가한다(가짜 `renderFigures` 주입).

## 금지사항

- `persistAnalysis`의 트랜잭션 구조(Analysis upsert·Figure 재생성·status=ready)를 바꾸지 마라. 이유: 멱등·원자성 보장(R28).
- 렌더를 별도 Inngest 스텝으로 분리하지 마라. 이유: 1차 범위 밖(스펙 "범위 밖").
- 기존 테스트를 깨뜨리지 마라.
