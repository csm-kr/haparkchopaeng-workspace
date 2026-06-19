# 재구현 관점: GitHub 구조 분석 + 모델/loss 다이어그램 (Figure는 연구 전용)

작성일: 2026-06-19

## 배경

논문 분석은 두 관점(lens)으로 나뉜다 — `research`(연구: problem·contributions·io·comparison·ablation),
`repro`(재구현: data·model·loss·metrics·training·gpu). **Figure 분석** 섹션은 현재
`AnalysisView`에서 **두 관점 공통**으로 항상 하단에 고정 렌더된다(`components/analyzer/analysis-view.tsx:360`,
스키마 주석 `schema.prisma:138` "특정 lens에 속하지 않음").

문제: figure는 연구(무엇을·왜) 맥락에 속한다. 재구현(어떻게 다시 만드나) 관점에도 같은 figure를 보여주는 건
**중복**이다. 재구현 관점에 진짜 필요한 건 **코드 저장소 구조**와 **모델·손실의 시각적 구조**다.

## 목표

1. Figure 분석 섹션을 **연구(research) 관점에서만** 노출한다(추출 파이프라인·DB는 그대로, UI 노출만 제한).
2. 재구현(repro) 관점에 그 자리를 대신할 두 가지를 추가한다:
   - **GitHub 구조 분석** — 논문이 링크한 공개 코드 저장소를 찾아 디렉터리/핵심 파일 구조를 정리.
   - **모델·loss 다이어그램** — 데이터→모델→손실 흐름을 박스/화살표로 도식화.

## 결정 사항 (사용자 확정)

1. **GitHub 분석 방식**: Gemini가 레포를 **검색(googleSearch 그라운딩)** 해 **있으면 실제 구조를 분석**,
   못 찾으면 **PDF만으로 추론**해 폴백한다(`source: "repo" | "paper"`로 정직하게 구분 표시).
2. **다이어그램 렌더**: **새 의존성 없이** 기존 Tailwind 토큰으로 박스/화살표(선형·계층 위주). mermaid 미사용.
3. **Figure**: 연구 관점에서만 표시. figure 추출 파이프라인·`Figure` 테이블·렌더는 **변경 없음**(UI 노출만 제한).

## 접근법

채택: **repro Analysis.payload(Json) 확장 + 검색 그라운딩 Gemini 호출 1개 추가 + UI 섹션 2개 추가.**

- `Analysis.payload`가 Json이라 **DB 마이그레이션 없음**. `ReproPayload`에 `repo`·`diagram`만 더한다.
- repo/diagram 추출은 **별도 Gemini 호출**(검색 그라운딩). 기존 research/repro/figures 추출과 병렬.

반려한 대안:

- **GitHub API로 실제 트리/README 페치**: 정확도는 높지만 `GITHUB_TOKEN`·네트워크·레이트리밋·대용량 레포
  처리 등 새 인프라가 필요하다. 사용자가 "Gemini 검색" 방식을 택해 과도하다.
- **수동 GitHub URL 입력 필드 추가**: 업로드 UX를 늘린다. Gemini가 PDF에서 URL을 충분히 찾으므로 불필요.
- **mermaid 다이어그램**: 표현력은 좋지만 새 의존성·렌더 실패 폴백이 필요. 선형/계층 도식엔 박스 렌더로 충분.

## 아키텍처 / 모듈 경계

| 모듈 | 변경 | 책임 |
|---|---|---|
| `types/analysis.ts` | 수정 | `RepoStructure`·`ModelDiagram`(+`DiagramNode`/`DiagramEdge`) 타입 추가, `ReproPayload`에 `repo`·`diagram` 필드 |
| `lib/analysis.ts` | 수정 | `extractRepoAndDiagram(pdf)` 신규(검색 그라운딩 + 방어 파싱). `AnalyzePaperDeps`에 추가. `analyzePaper`가 결과를 repro payload에 머지 |
| `components/analyzer/sections.tsx` | 수정 | `reproSections()`에 `repo`·`diagram` 섹션 추가. `RepoBlock`·`DiagramBlock` 렌더러 신규 |
| `components/analyzer/analysis-view.tsx` | 수정 | Figure `<section>`을 `lens === "research"`일 때만 렌더 |
| `lib/papers.ts` | 확인 | repro payload 매핑이 추가 필드(`repo`·`diagram`)를 그대로 통과시키는지(필요 시 기본값 채움) |

`Analysis.payload`(Json)에 담으므로 **Prisma 스키마/마이그레이션 변경 없음**. `Figure` 관련 코드도 무변경.

## 데이터 모델 (`types/analysis.ts`)

```ts
interface RepoStructure {
  found: boolean;            // 공개 레포를 찾았나
  url: string | null;        // 발견된 GitHub URL (없으면 null)
  summary: string;           // 레포 한 줄 요약
  tree: NamedItem[];         // 핵심 디렉터리/파일 → 역할 (name=경로, desc=역할)
  source: "repo" | "paper";  // 실제 레포 분석인지 PDF 추론 폴백인지
}

interface DiagramNode {
  id: string;
  label: string;             // 박스 제목 (예: "Encoder")
  detail: string;            // 한 줄 설명 (예: "12-layer Transformer")
  group: "data" | "model" | "loss";  // 레인 분류
}
interface DiagramEdge { from: string; to: string; label: string }  // 노드 id 연결 (label은 빈 문자열 허용)
interface ModelDiagram { nodes: DiagramNode[]; edges: DiagramEdge[] }

interface ReproPayload {
  data: TableBlock; model: ModelSpec; loss: LossItem[];
  metrics: NamedItem[]; training: TrainingSpec; gpu: GpuSpec;  // 기존
  repo: RepoStructure;       // 신규
  diagram: ModelDiagram;     // 신규
}
```

옛 논문(payload에 이 키 없음)은 매핑/렌더 단계에서 **기본값**으로 폴백한다
(`repo: {found:false, url:null, summary:"", tree:[], source:"paper"}`, `diagram: {nodes:[], edges:[]}`).

## 파이프라인 (`lib/analysis.ts`)

### `extractRepoAndDiagram(pdf: Buffer): Promise<{ repo: RepoStructure; diagram: ModelDiagram }>`

- Gemini 호출에 **`tools: [{ googleSearch: {} }]`** 를 켜 논문이 링크한 GitHub 레포를 실제 검색·열람한다.
- ⚠️ **제약**: Gemini의 검색 그라운딩(도구 사용)은 `responseSchema`/`responseMimeType: application/json`
  (strict JSON 모드)와 **동시 사용이 불가**하다. 따라서 이 호출은 스키마를 걸지 않고, 프롬프트로
  **펜스드 ```json 블록** 출력을 요구한 뒤 **방어적으로 파싱**한다(기존 `extractFigures`의 `RawFigure`
  좁히기 패턴 재사용 — 코드펜스 제거 → `JSON.parse` → 필드별 `String()`/`Boolean()` 정규화).
  *(구현 첫 단계에서 도구+스키마 동시 사용 가부를 실제 SDK로 1회 검증한다. 가능하면 스키마를 쓰고,
  불가하면 펜스드 파싱으로 간다 — 어느 쪽이든 외부 인터페이스는 동일.)*
- 프롬프트 요지(한국어 출력): "이 논문의 공개 코드 저장소(GitHub 등)를 검색해 찾아라. 찾으면 `found:true`,
  `url`, 한 줄 `summary`, 핵심 디렉터리/파일 `tree`(경로→역할)를 채우고 `source:"repo"`. 못 찾으면
  `found:false`, `source:"paper"`로 두고 논문 본문만으로 추론하라. 추가로 데이터→모델→손실 흐름을
  `diagram`(nodes/edges)로 도식화하라. nodes는 group(data|model|loss)으로 분류, edges는 노드 id로 연결."
- **실패 격리**: 파싱·검색이 실패하면 `throw 하지 않고` 기본값을 반환한다
  (`{repo:{found:false,…,source:"paper"}, diagram:{nodes:[],edges:[]}}`). 메타 분석(research/repro/figures)을
  지키기 위해서다(R28 정신, `renderFigures`의 방어 래핑과 동형).

### 오케스트레이션 (`analyzePaper`)

```
PDF 로드
  → Promise.all( extractAnalysis(research), extractAnalysis(repro),
                 extractFigures, extractRepoAndDiagram )   // ← 4번째 추가
  → figures = renderFigures(...)                            // 기존
  → fullRepro = { ...repro, repo: repoDiagram.repo, diagram: repoDiagram.diagram }
  → persistAnalysis(research, fullRepro, figures)           // repro payload에 머지되어 저장
```

`extractRepoAndDiagram`은 `AnalyzePaperDeps`에 주입 의존성으로 추가한다(테스트에서 가짜 주입, 기존 패턴).
`persistAnalysis`는 `repro` 인자를 `fullRepro`로 받기만 하면 되어 **본문 변경 없음**(payload Json 그대로 직렬화).

## UI (`components/analyzer/`)

### Figure 노출 제한 (`analysis-view.tsx`)

Figure `<section>`(현재 360–400, 고정 하단)을 **`{lens === "research" && ( … )}`** 로 감싼다.
재구현 관점에선 사라진다. figure 노트(`sectionId:"figures"`, `lens:"any"`)는 연구 관점에서 계속 보인다.

### 재구현 섹션 추가 (`sections.tsx` `reproSections`)

기존 data·model·training·gpu 뒤에 두 섹션을 더한다(카드+노트 시스템에 그대로 올라감, 새 `sectionId`):

- `{ id: "repo", title: "GitHub 구조", content: <RepoBlock repo={p.repo} /> }`
- `{ id: "diagram", title: "모델 구조", content: <DiagramBlock diagram={p.diagram} /> }`

`SectionNote.sectionId`는 자유 문자열이라 스키마 변경 없이 `"repo"`·`"diagram"` 노트가 동작한다.

### `RepoBlock`

- `found:false` → "공개 코드 저장소를 못 찾았어요" 안내 + (diagram은 논문 기반으로 별도 표시).
- `found:true` → `url` 링크(새 창, 기존 원문 PDF 열기와 동일 처리) + `summary` + `tree`를 `DescList`형
  목록(경로=name, 역할=desc)으로. `source:"paper"`면 "추정" 배지를 단다(정직 표시).

### `DiagramBlock`

그래프 레이아웃 엔진 없이 **선형/계층** 렌더:

- `group`별로 **데이터 → 모델 → 손실** 세 레인. 각 레인은 노드를 등장 순서대로 박스로 쌓고, 박스 사이에 `↓`.
- 레인 사이 전이는 `→`(또는 헤더)로 구분. 박스는 `label`(굵게) + `detail`(보조색).
- `edges` 중 인접 순서가 아닌 연결(분기/스킵)은 박스 하단에 "→ {대상 label}: {edge.label}" 보조 라벨로 나열.
- 색·강조는 토큰만(R20). `nodes` 비면 "다이어그램이 아직 없어요" 안내(기존 빈 상태 패턴).

## 매핑 (`lib/papers.ts`)

repro payload를 화면으로 내릴 때 `repo`·`diagram`이 없을 수 있으니(옛 논문) **기본값 머지**로 통과시킨다.
research payload·figure 매핑은 변경 없음.

## 에러 처리 / 격리

- `extractRepoAndDiagram` 실패(검색·파싱) → 기본값 반환, **분석 전체를 막지 않는다**(R28). repro의 나머지
  필드(data/model/…)와 research·figures는 정상 저장된다.
- 레포를 못 찾음(`found:false`)은 **에러가 아니다** — 정상 상태로 안내 + 논문 기반 다이어그램.
- 옛 논문(필드 부재) → 매핑 기본값으로 빈 섹션. "재분석"으로 채울 수 있다(기존 `/reanalyze` 경로).

## 테스트 전략 (TDD — CLAUDE.md CRITICAL)

기존 `lib/__tests__/analysis.test.ts`(의존성 주입·모킹)와 `components/analyzer/__tests__/analyzer.test.tsx`를 확장한다.

- `extractRepoAndDiagram`(Gemini 모킹):
  - 레포 발견 응답 → `repo.found=true`·`url`·`tree` 파싱, `source:"repo"`, `diagram.nodes` 채움.
  - 레포 미발견 응답 → `found:false`, `source:"paper"`.
  - 코드펜스 감싼 JSON → 펜스 제거 후 정상 파싱.
  - 깨진 JSON/빈 응답 → **throw 없이** 기본값 반환.
- 오케스트레이션: `analyzePaper`가 `extractRepoAndDiagram` 결과를 **repro payload에 머지**해 `persistAnalysis`로
  넘기는지(repro upsert payload에 `repo`·`diagram` 포함).
- `AnalysisView`:
  - 재구현 lens → `GitHub 구조`·`모델 구조` 섹션 보이고 **Figure 분석 섹션 안 보임**.
  - 연구 lens → Figure 분석 보이고 **repo·diagram 안 보임**.
  - `repo.found=false` → "저장소 못 찾음" 안내, `source:"paper"` 배지.

## 리스크

- **검색 그라운딩 + 출력 안정성**: 그라운딩 호출은 strict 스키마를 못 써 출력이 덜 안정적이다 → 방어 파싱 +
  실패 시 기본값으로 격리한다. 구현 첫 단계에서 도구+스키마 동시 사용 가부를 실측해 분기한다.
- **레포 매칭 정확도**: Gemini가 엉뚱한 레포를 고를 수 있다 → `url`을 항상 노출하고 `source` 배지로 신뢰도를
  드러내, 사람이 판단하게 한다(은폐하지 않는다).
- **다이어그램 레이아웃**: 순수 CSS라 복잡한 DAG는 못 그린다 → 범위를 선형/계층으로 한정, 비순차 연결은
  보조 라벨로 처리한다.

## 범위 밖 (YAGNI)

- GitHub API 실제 트리/README 페치, `GITHUB_TOKEN` 도입.
- 수동 GitHub URL 입력 UI.
- mermaid 등 그래프 렌더 엔진, 줌/팬 다이어그램 인터랙션.
- 레포 코드 자체의 정적 분석·라인 수·언어 통계.
