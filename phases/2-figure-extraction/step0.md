# Step 0: figure-bbox-schema

## 읽어야 할 파일

- `/docs/superpowers/specs/2026-06-14-figure-image-extraction-design.md` — 설계 스펙(특히 "figure 스키마 / 프롬프트")
- `/docs/agent/ADR.md`, `/docs/agent/RULES.md` — 분석 파이프라인 규칙(R28 격리, ADR-011 Gemini)
- `lib/analysis.ts` — `FIGURES_SCHEMA`, `FIGURES_PROMPT`, `FigureExtract`, `extractFigures`
- `lib/__tests__/analysis.test.ts` — 의존성 주입·Gemini 모킹 테스트 패턴

## 작업

`lib/analysis.ts`에 figure bounding box를 추가한다(추출 단계). 렌더링은 이 step에서 하지 않는다.

- `FigureBox` 타입을 export한다: `{ ymin: number; xmin: number; ymax: number; xmax: number }` — 0–1000 정규화 좌표(Gemini 객체 검출 규약).
- `FIGURES_SCHEMA.items.properties`에 `box`(OBJECT, 하위 `ymin/xmin/ymax/xmax`: INTEGER)를 추가한다. **`required`에는 넣지 않는다.**
- `FIGURES_PROMPT`에 "각 figure를 감싸는 bounding box를 0–1000 정규화 좌표 `[ymin,xmin,ymax,xmax]`로 `box`에 채운다. 못 찾으면 생략한다." 한 문장을 추가한다.
- `FigureExtract`에 `box: FigureBox | null`을 추가한다. `imageUrl`은 추출 단계에선 계속 `null`(렌더 단계가 채움).
- `extractFigures`의 매핑에서 `box`를 파싱한다: 네 좌표가 모두 유한한 숫자면 `FigureBox`, 아니면 `null`.

## Acceptance Criteria

```bash
npx tsc --noEmit
npx vitest run lib/__tests__/analysis.test.ts
```

TDD: `extractFigures` 테스트를 먼저 추가한다 — (a) 응답에 `box`가 오면 `FigureExtract.box`가 채워짐, (b) `box`가 없으면 `box=null`. 그다음 구현해 통과시킨다.

## 금지사항

- DB 마이그레이션을 하지 마라. 이유: `Figure.imageUrl` 컬럼은 이미 있고, `box`는 DB에 저장하지 않는다(렌더 입력일 뿐).
- 여기서 `imageUrl`을 채우지 마라. 이유: 렌더는 step 1·2 책임이다.
- `box`를 `required`로 만들지 마라. 이유: Gemini가 bbox를 못 잡는 figure도 있어야 step 1의 페이지 fallback이 동작한다.
- 기존 테스트를 깨뜨리지 마라.
