# 재구현 관점 GitHub 구조·모델 다이어그램 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 재구현(repro) 관점에 "GitHub 구조 분석"과 "모델/loss 다이어그램" 섹션을 추가하고, Figure 분석은 연구(research) 관점에서만 보이게 한다.

**Architecture:** `Analysis.payload`(Json)에 담는 `ReproPayload`를 `repo`·`diagram` 필드로 확장한다(DB 마이그레이션 없음). 새 Gemini 호출 `extractRepoAndDiagram`(googleSearch 그라운딩 + 방어 파싱)을 분석 파이프라인에 병렬로 추가해 결과를 repro payload에 머지한다. UI는 `reproSections`에 섹션 2개를 더하고, Figure `<section>`을 `lens === "research"`로 가린다.

**Tech Stack:** Next.js 15 (App Router), TypeScript strict, Tailwind v4, Prisma(Postgres/Supabase), `@google/genai`(Gemini), Inngest, Vitest + Testing Library.

## Global Constraints

- 설명·주석·UI 문구는 **한국어**. 코드·식별자·커맨드는 원문 유지.
- **TDD** — 테스트 먼저, 실패 확인, 최소 구현, 통과 확인, 커밋(CLAUDE.md CRITICAL).
- **DB 마이그레이션 없음** — `repo`·`diagram`은 `Analysis.payload`(Json)에 저장. `prisma/schema.prisma` 변경 금지.
- **실패 격리(R28)** — `extractRepoAndDiagram`은 검색·파싱·안전차단 실패 시 `throw 하지 않고` 기본값 반환. 분석 전체(research/repro/figures)를 막지 않는다.
- **색·강조는 토큰만(R20)**. 새 라이브러리 의존성 추가 금지(다이어그램은 Tailwind 박스/화살표).
- **GEMINI_API_KEY는 서버 전용(R2)**. Gemini 추출 함수는 Inngest 잡에서만 호출(R31).
- 테스트 실행: `npx vitest run <파일>`. 전체: `npx vitest run`. 타입체크: `npx tsc --noEmit`. 린트: `npm run lint`.
- 기존 figure 추출 파이프라인·`Figure` 테이블·`figure-render`는 **변경 없음**(UI 노출만 제한).

---

### Task 1: 타입 확장 + 테스트 픽스처 갱신

`ReproPayload`에 `repo`·`diagram`을 **필수 필드**로 추가한다. TS가 모든 구성 지점을 잡아내므로, 같은 태스크에서 두 테스트 픽스처를 채워 빌드를 녹색으로 유지한다.

**Files:**
- Modify: `types/analysis.ts`
- Modify: `lib/__tests__/analysis.test.ts:61-68` (repro 픽스처)
- Modify: `components/analyzer/__tests__/analyzer.test.tsx:64-71` (repro 픽스처)

**Interfaces:**
- Produces: `RepoStructure`, `DiagramNode`, `DiagramEdge`, `ModelDiagram` (모두 `export`, `@/types` 배럴로 노출). `ReproPayload`에 `repo: RepoStructure`, `diagram: ModelDiagram` 추가.

- [ ] **Step 1: 타입 추가 (`types/analysis.ts`)**

`ReproPayload` 인터페이스 **바로 위**에 새 타입을 추가하고, `ReproPayload`에 두 필드를 더한다. 기존 `NamedItem`(name/desc)을 `tree`에 재사용한다.

```ts
// --- GitHub 저장소 구조 (재구현 관점) ---

/** 논문이 링크한 공개 코드 저장소 분석. found=false는 "못 찾음"(에러 아님). source로 신뢰도 표시. */
export interface RepoStructure {
  found: boolean;
  url: string | null;
  summary: string;
  tree: NamedItem[]; // name=경로, desc=역할
  source: "repo" | "paper"; // 실제 레포 분석 vs PDF 추론 폴백
}

// --- 모델/손실 다이어그램 (재구현 관점) ---

/** 다이어그램 노드. group으로 데이터→모델→손실 레인 분류. */
export interface DiagramNode {
  id: string;
  label: string;
  detail: string;
  group: "data" | "model" | "loss";
}

/** 노드 id 연결. label은 빈 문자열 허용(이름 없는 흐름). */
export interface DiagramEdge {
  from: string;
  to: string;
  label: string;
}

export interface ModelDiagram {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}
```

그리고 기존 `ReproPayload`를 다음으로 교체:

```ts
export interface ReproPayload {
  data: TableBlock;
  model: ModelSpec;
  loss: LossItem[];
  metrics: NamedItem[];
  training: TrainingSpec;
  gpu: GpuSpec;
  repo: RepoStructure; // 신규 — GitHub 구조
  diagram: ModelDiagram; // 신규 — 모델/손실 도식
}
```

- [ ] **Step 2: `analysis.test.ts` repro 픽스처에 repo·diagram 추가**

`lib/__tests__/analysis.test.ts`의 `const repro: ReproPayload = { ... }`(61–68행) 닫는 중괄호 직전에 두 필드를 추가한다:

```ts
  gpu: { hardware: "A100", count: 8, vramGb: 80, vramUsedGb: 60, trainDays: 2, note: "추정" },
  repo: { found: false, url: null, summary: "", tree: [], source: "paper" },
  diagram: { nodes: [], edges: [] },
};
```

- [ ] **Step 3: `analyzer.test.tsx` repro 픽스처에 repo·diagram 추가**

`components/analyzer/__tests__/analyzer.test.tsx`의 `const repro: ReproPayload = { ... }`(64–71행) 닫는 중괄호 직전에 **렌더 검증용 실제 값**으로 추가한다(Task 5에서 이 값을 화면에서 확인):

```ts
  gpu: { hardware: "A100", count: 16, vramGb: 80, vramUsedGb: 58, trainDays: 3, note: "추정" },
  repo: {
    found: true,
    url: "https://github.com/acme/model",
    summary: "공식 구현 저장소",
    tree: [{ name: "src/model.py", desc: "모델 정의" }],
    source: "repo",
  },
  diagram: {
    nodes: [
      { id: "in", label: "입력 데이터", detail: "토큰 시퀀스", group: "data" },
      { id: "enc", label: "Encoder", detail: "12-layer Transformer", group: "model" },
    ],
    edges: [{ from: "in", to: "enc", label: "임베딩" }],
  },
};
```

- [ ] **Step 4: 타입체크 + 기존 테스트가 여전히 통과하는지 확인**

Run: `npx tsc --noEmit && npx vitest run analysis.test.ts analyzer.test.tsx`
Expected: tsc 에러 0. 두 스펙 모두 PASS(컴포넌트·파이프라인은 아직 미변경이라 기존 동작 유지).

- [ ] **Step 5: Commit**

```bash
git add types/analysis.ts lib/__tests__/analysis.test.ts components/analyzer/__tests__/analyzer.test.tsx
git commit -m "feat(analysis): ReproPayload에 repo·diagram 타입 추가"
```

---

### Task 2: `extractRepoAndDiagram` 추출 함수

googleSearch 그라운딩으로 레포를 검색하고 모델/손실 다이어그램을 뽑는 Gemini 호출을 추가한다. 그라운딩은 strict JSON 스키마와 함께 못 쓰므로 펜스드 JSON을 방어 파싱하고, 실패는 기본값으로 격리한다.

**Files:**
- Modify: `lib/analysis.ts` (import 추가, 새 함수·헬퍼·기본값)
- Test: `lib/__tests__/analysis.test.ts`

**Interfaces:**
- Consumes: `getAi`, `modelId`, `pdfPart`, `responseText`(기존, `lib/analysis.ts` 내부).
- Produces: `export async function extractRepoAndDiagram(pdf: Buffer): Promise<{ repo: RepoStructure; diagram: ModelDiagram }>` — **절대 throw 하지 않는다**.

- [ ] **Step 1: 실패 테스트 작성**

`lib/__tests__/analysis.test.ts`의 import 구조분해에 `extractRepoAndDiagram`을 추가한다:

```ts
const { analyzePaper, extractAnalysis, extractFigures, extractRepoAndDiagram, durationMsFrom } =
  await import("@/lib/analysis");
```

그리고 `describe("Gemini figure 추출 ...")` 블록 **뒤**에 새 describe를 추가한다:

```ts
describe("Gemini repo/diagram 추출 (extractRepoAndDiagram)", () => {
  it("레포를 찾으면 repo를 파싱하고 source=repo·diagram을 채운다(스키마 대신 검색 도구)", async () => {
    generateContentMock.mockResolvedValue({
      text: JSON.stringify({
        repo: {
          found: true,
          url: "https://github.com/x/y",
          summary: "요약",
          tree: [{ name: "src/model.py", desc: "모델" }],
          source: "repo",
        },
        diagram: {
          nodes: [{ id: "enc", label: "Encoder", detail: "12L", group: "model" }],
          edges: [{ from: "in", to: "enc", label: "" }],
        },
      }),
    });

    const out = await extractRepoAndDiagram(Buffer.from("x"));
    expect(out.repo).toEqual({
      found: true,
      url: "https://github.com/x/y",
      summary: "요약",
      tree: [{ name: "src/model.py", desc: "모델" }],
      source: "repo",
    });
    expect(out.diagram.nodes[0]).toEqual({
      id: "enc",
      label: "Encoder",
      detail: "12L",
      group: "model",
    });

    const arg = generateContentMock.mock.calls[0][0];
    // 검색 그라운딩 도구가 켜져 있고, strict 스키마는 쓰지 않는다.
    expect(arg.config.tools).toEqual([{ googleSearch: {} }]);
    expect(arg.config.responseSchema).toBeUndefined();
    // PDF는 base64 inlineData로 함께 보낸다.
    expect(arg.contents[0].parts[0].inlineData.mimeType).toBe("application/pdf");
  });

  it("레포를 못 찾으면 found=false·source=paper(에러 아님)", async () => {
    generateContentMock.mockResolvedValue({
      text: JSON.stringify({
        repo: { found: false, url: null, summary: "", tree: [], source: "paper" },
        diagram: { nodes: [{ id: "m", label: "M", detail: "", group: "model" }], edges: [] },
      }),
    });
    const out = await extractRepoAndDiagram(Buffer.from("x"));
    expect(out.repo.found).toBe(false);
    expect(out.repo.source).toBe("paper");
    expect(out.diagram.nodes).toHaveLength(1);
  });

  it("```json 코드펜스로 감싼 응답도 파싱한다", async () => {
    generateContentMock.mockResolvedValue({
      text:
        "```json\n" +
        JSON.stringify({
          repo: { found: true, url: "u", summary: "s", tree: [], source: "repo" },
          diagram: { nodes: [], edges: [] },
        }) +
        "\n```",
    });
    const out = await extractRepoAndDiagram(Buffer.from("x"));
    expect(out.repo.found).toBe(true);
    expect(out.repo.url).toBe("u");
  });

  it("알 수 없는 group은 model로 정규화한다(방어적)", async () => {
    generateContentMock.mockResolvedValue({
      text: JSON.stringify({
        repo: { found: false, url: null, summary: "", tree: [], source: "paper" },
        diagram: { nodes: [{ id: "z", label: "Z", detail: "", group: "weird" }], edges: [] },
      }),
    });
    const out = await extractRepoAndDiagram(Buffer.from("x"));
    expect(out.diagram.nodes[0].group).toBe("model");
  });

  it("깨진 JSON/빈 응답이면 throw 없이 기본값을 돌려준다(격리, R28)", async () => {
    generateContentMock.mockResolvedValue({ text: "이건 JSON이 아니에요" });
    const out = await extractRepoAndDiagram(Buffer.from("x"));
    expect(out).toEqual({
      repo: { found: false, url: null, summary: "", tree: [], source: "paper" },
      diagram: { nodes: [], edges: [] },
    });
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run analysis.test.ts -t "extractRepoAndDiagram"`
Expected: FAIL — `extractRepoAndDiagram is not a function`(아직 미구현).

- [ ] **Step 3: 최소 구현 (`lib/analysis.ts`)**

import에 새 타입을 추가한다(11행 교체):

```ts
import type {
  Lens,
  ModelDiagram,
  RepoStructure,
  ReproPayload,
  ResearchPayload,
} from "@/types";
```

`extractFigures` 함수 정의 **뒤**(오케스트레이션 주석 `// --- 오케스트레이션 ...` 앞)에 다음을 추가한다:

```ts
// --- GitHub 구조 + 모델/손실 다이어그램 추출 (재구현 관점 보강) ---

const REPO_DIAGRAM_PROMPT =
  "이 논문의 공개 코드 저장소(GitHub 등)를 웹에서 검색해 찾아라. 그리고 모델·손실 구조를 도식화하라. " +
  "아래 JSON 한 개만 출력한다(코드펜스 허용, 그 외 설명 금지). 한국어로 쓴다.\n" +
  '{ "repo": { "found": boolean, "url": string|null, "summary": string, ' +
  '"tree": [{"name":"경로","desc":"역할"}], "source": "repo"|"paper" }, ' +
  '"diagram": { "nodes": [{"id":string,"label":string,"detail":string,' +
  '"group":"data"|"model"|"loss"}], "edges": [{"from":id,"to":id,"label":string}] } }\n' +
  '저장소를 찾으면 found=true·source="repo"로 실제 구조를 채우고, 못 찾으면 found=false·source="paper"로 ' +
  "논문 본문만으로 추론한다. diagram은 데이터→모델→손실 흐름을 nodes/edges로 표현한다.";

const DEFAULT_REPO: RepoStructure = {
  found: false,
  url: null,
  summary: "",
  tree: [],
  source: "paper",
};
const DEFAULT_DIAGRAM: ModelDiagram = { nodes: [], edges: [] };
const DIAGRAM_GROUPS = ["data", "model", "loss"] as const;

/** ```json 펜스를 벗겨 순수 JSON 문자열을 얻는다(그라운딩 호출은 스키마를 못 써 펜스가 섞일 수 있다). */
function stripCodeFence(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : text).trim();
}

function parseRepoStructure(raw: unknown): RepoStructure {
  if (!raw || typeof raw !== "object") return DEFAULT_REPO;
  const o = raw as Record<string, unknown>;
  const treeRaw = Array.isArray(o.tree) ? o.tree : [];
  const tree = treeRaw.map((t) => {
    const ti = (t ?? {}) as Record<string, unknown>;
    return { name: String(ti.name ?? ""), desc: String(ti.desc ?? "") };
  });
  return {
    found: Boolean(o.found),
    url: typeof o.url === "string" ? o.url : null,
    summary: String(o.summary ?? ""),
    tree,
    source: o.source === "repo" ? "repo" : "paper",
  };
}

function parseDiagram(raw: unknown): ModelDiagram {
  if (!raw || typeof raw !== "object") return DEFAULT_DIAGRAM;
  const o = raw as Record<string, unknown>;
  const nodesRaw = Array.isArray(o.nodes) ? o.nodes : [];
  const edgesRaw = Array.isArray(o.edges) ? o.edges : [];
  const nodes = nodesRaw.map((n) => {
    const ni = (n ?? {}) as Record<string, unknown>;
    const group = DIAGRAM_GROUPS.includes(ni.group as (typeof DIAGRAM_GROUPS)[number])
      ? (ni.group as ModelDiagram["nodes"][number]["group"])
      : "model";
    return {
      id: String(ni.id ?? ""),
      label: String(ni.label ?? ""),
      detail: String(ni.detail ?? ""),
      group,
    };
  });
  const edges = edgesRaw.map((e) => {
    const ei = (e ?? {}) as Record<string, unknown>;
    return {
      from: String(ei.from ?? ""),
      to: String(ei.to ?? ""),
      label: String(ei.label ?? ""),
    };
  });
  return { nodes, edges };
}

/**
 * 공개 코드 저장소 구조 + 모델/손실 다이어그램을 추출한다.
 * googleSearch 그라운딩으로 레포를 검색한다 — 그라운딩은 strict JSON 스키마와 동시 사용이 불가하므로
 * 펜스드 JSON을 방어적으로 파싱한다. 검색·파싱·안전차단 실패는 throw 없이 기본값으로 격리한다(R28).
 */
export async function extractRepoAndDiagram(
  pdf: Buffer,
): Promise<{ repo: RepoStructure; diagram: ModelDiagram }> {
  try {
    const ai = getAi();
    const res = await ai.models.generateContent({
      model: modelId(),
      contents: [
        { role: "user", parts: [pdfPart(pdf), { text: REPO_DIAGRAM_PROMPT }] },
      ],
      config: { tools: [{ googleSearch: {} }] },
    });
    const parsed = JSON.parse(stripCodeFence(responseText(res))) as {
      repo?: unknown;
      diagram?: unknown;
    };
    return {
      repo: parseRepoStructure(parsed.repo),
      diagram: parseDiagram(parsed.diagram),
    };
  } catch {
    return { repo: DEFAULT_REPO, diagram: DEFAULT_DIAGRAM };
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run analysis.test.ts -t "extractRepoAndDiagram"`
Expected: 5개 PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/analysis.ts lib/__tests__/analysis.test.ts
git commit -m "feat(analysis): extractRepoAndDiagram 추가(검색 그라운딩+방어 파싱)"
```

---

### Task 3: 오케스트레이션 머지 (`analyzePaper`)

`extractRepoAndDiagram`을 주입 의존성으로 추가하고 4번째 병렬 추출로 실행해, 결과를 repro payload에 머지해 저장한다.

**Files:**
- Modify: `lib/analysis.ts` (`AnalyzePaperDeps`, `realDeps`, `analyzePaper`)
- Test: `lib/__tests__/analysis.test.ts` (오케스트레이션 describe)

**Interfaces:**
- Consumes: `extractRepoAndDiagram`(Task 2), `persistAnalysis`(기존, 시그니처 불변).
- Produces: `AnalyzePaperDeps.extractRepoAndDiagram(pdf: Buffer): Promise<{ repo: RepoStructure; diagram: ModelDiagram }>`.

- [ ] **Step 1: 오케스트레이션 테스트 갱신(실패 유도)**

`lib/__tests__/analysis.test.ts`의 `describe("분석 오케스트레이션 (analyzePaper)")`에서:

(a) `repoDiagram` 픽스처를 describe 상단(`const deps = {...}` 위)에 추가:

```ts
  const repoDiagram = {
    repo: {
      found: true,
      url: "https://github.com/x/y",
      summary: "요약",
      tree: [{ name: "model.py", desc: "모델" }],
      source: "repo" as const,
    },
    diagram: {
      nodes: [{ id: "m", label: "Model", detail: "T", group: "model" as const }],
      edges: [],
    },
  };
```

(b) `deps` 객체에 `extractRepoAndDiagram: vi.fn()` 추가:

```ts
  const deps = {
    loadPdf: vi.fn(),
    extractAnalysis: vi.fn(),
    extractFigures: vi.fn(),
    renderFigures: vi.fn(),
    extractRepoAndDiagram: vi.fn(),
  };
```

(c) `beforeEach`에 기본 mock 추가:

```ts
    deps.extractRepoAndDiagram.mockResolvedValue(repoDiagram);
```

(d) 기존 `it("페이로드를 Analysis(두 관점)/Figure로 매핑...")`의 **repro upsert 단언**을 머지 형태로 교체한다(research 단언은 그대로):

```ts
    expect(prismaMock.analysis.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { paperId_lens: { paperId: "p1", lens: "repro" } },
        create: expect.objectContaining({ payload: { ...repro, ...repoDiagram } }),
      }),
    );
```

(e) 같은 describe에 머지 전용 단언 `it`을 추가:

```ts
  it("extractRepoAndDiagram 결과를 repro payload에 머지해 저장한다", async () => {
    await analyzePaper("p1", deps);
    const reproCall = prismaMock.analysis.upsert.mock.calls.find(
      (c) => c[0].where.paperId_lens.lens === "repro",
    );
    expect(reproCall?.[0].create.payload.repo).toEqual(repoDiagram.repo);
    expect(reproCall?.[0].create.payload.diagram).toEqual(repoDiagram.diagram);
    expect(deps.extractRepoAndDiagram).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run analysis.test.ts -t "오케스트레이션"`
Expected: FAIL — 현재 `analyzePaper`는 repoDiagram을 받지도 머지하지도 않아 `payload.repo`가 픽스처의 기본값(found:false)이라 단언 불일치.

- [ ] **Step 3: 구현 (`lib/analysis.ts`)**

(a) `AnalyzePaperDeps`에 한 줄 추가(`renderFigures` 선언 뒤):

```ts
  extractRepoAndDiagram(
    pdf: Buffer,
  ): Promise<{ repo: RepoStructure; diagram: ModelDiagram }>;
```

(b) `realDeps`에 추가:

```ts
export const realDeps: AnalyzePaperDeps = {
  loadPdf: loadPaperPdf,
  extractAnalysis,
  extractFigures,
  renderFigures,
  extractRepoAndDiagram,
};
```

(c) `analyzePaper`의 `Promise.all`을 4개로 늘리고 머지한다. 기존:

```ts
    const [research, repro, extracted] = await Promise.all([
      deps.extractAnalysis(pdf, "research"),
      deps.extractAnalysis(pdf, "repro"),
      deps.extractFigures(pdf),
    ]);
```

교체:

```ts
    const [research, repro, extracted, repoDiagram] = await Promise.all([
      deps.extractAnalysis(pdf, "research"),
      deps.extractAnalysis(pdf, "repro"),
      deps.extractFigures(pdf),
      deps.extractRepoAndDiagram(pdf),
    ]);
```

그리고 `persistAnalysis(...)` 호출 직전에 머지 payload를 만들어 넘긴다. 기존:

```ts
    await persistAnalysis(
      paperId,
      research as ResearchPayload,
      repro as ReproPayload,
      figures,
    );
```

교체:

```ts
    const fullRepro: ReproPayload = {
      ...(repro as ReproPayload),
      repo: repoDiagram.repo,
      diagram: repoDiagram.diagram,
    };
    await persistAnalysis(
      paperId,
      research as ResearchPayload,
      fullRepro,
      figures,
    );
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run analysis.test.ts`
Expected: 전체 PASS(오케스트레이션 + 머지 단언 포함).

- [ ] **Step 5: Commit**

```bash
git add lib/analysis.ts lib/__tests__/analysis.test.ts
git commit -m "feat(analysis): analyzePaper가 repo·diagram을 repro payload에 머지"
```

---

### Task 4: 매핑 기본값 (`lib/papers.ts`)

옛 논문(payload에 `repo`·`diagram` 키 없음)도 UI가 항상 well-formed payload를 받도록 매핑 단계에서 기본값을 채운다.

**Files:**
- Modify: `lib/papers.ts` (import, `getPaperDetail`의 repro 매핑, 헬퍼 추가)
- Test: `lib/__tests__/papers.test.ts`

**Interfaces:**
- Consumes: `RepoStructure`, `ModelDiagram`(`@/types`).
- Produces: 내부 헬퍼 `reproWithDefaults`(비공개). 외부 시그니처 변화 없음.

- [ ] **Step 1: 실패 테스트 작성**

`lib/__tests__/papers.test.ts`의 `describe("getPaperDetail ...")` **뒤**에 추가:

```ts
describe("getPaperDetail — 재구현 payload 기본값(옛 논문 호환)", () => {
  const reproBase = {
    data: { caption: "", columns: [], rows: [] },
    model: { params: "", items: [] },
    loss: [],
    metrics: [],
    training: { caption: "", rows: [] },
    gpu: { hardware: "", count: 0, vramGb: 0, vramUsedGb: 0, trainDays: 0, note: "" },
  };

  it("repo·diagram이 없으면 기본값으로 채워 내려준다", async () => {
    const p = paper("a1", "tA");
    p.analyses = [{ lens: "repro", payload: { ...reproBase } }];
    db.papers = [p];

    const detail = await getPaperDetail("a1", "tA");
    expect(detail?.repro?.repo).toEqual({
      found: false,
      url: null,
      summary: "",
      tree: [],
      source: "paper",
    });
    expect(detail?.repro?.diagram).toEqual({ nodes: [], edges: [] });
  });

  it("repo·diagram이 있으면 그대로 통과시킨다", async () => {
    const repoVal = { found: true, url: "u", summary: "s", tree: [], source: "repo" };
    const diagramVal = {
      nodes: [{ id: "m", label: "M", detail: "d", group: "model" }],
      edges: [],
    };
    const p = paper("a1", "tA");
    p.analyses = [
      { lens: "repro", payload: { ...reproBase, repo: repoVal, diagram: diagramVal } },
    ];
    db.papers = [p];

    const detail = await getPaperDetail("a1", "tA");
    expect(detail?.repro?.repo).toEqual(repoVal);
    expect(detail?.repro?.diagram).toEqual(diagramVal);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run papers.test.ts -t "재구현 payload 기본값"`
Expected: FAIL — 현재 매핑은 `repro as unknown as ReproPayload`로 캐스팅만 해 `repo`/`diagram`이 `undefined`.

- [ ] **Step 3: 구현 (`lib/papers.ts`)**

(a) 타입 import에 `RepoStructure`, `ModelDiagram` 추가(기존 `ReproPayload` import 블록에):

```ts
  ModelDiagram,
  RepoStructure,
  ReproPayload,
```

(b) 파일 하단(또는 `getPaperDetail` 위)에 헬퍼 추가:

```ts
// 옛 논문(repo·diagram 키 부재)을 기본값으로 채워 UI가 항상 well-formed repro payload를 받게 한다.
function reproWithDefaults(payload: unknown): ReproPayload {
  const o = (payload ?? {}) as Record<string, unknown>;
  const repo =
    (o.repo as RepoStructure | undefined) ?? {
      found: false,
      url: null,
      summary: "",
      tree: [],
      source: "paper",
    };
  const diagram =
    (o.diagram as ModelDiagram | undefined) ?? { nodes: [], edges: [] };
  return { ...(o as unknown as ReproPayload), repo, diagram };
}
```

(c) repro 매핑 한 줄 교체(141행):

```ts
    repro: repro ? reproWithDefaults(repro) : null,
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run papers.test.ts`
Expected: 전체 PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/papers.ts lib/__tests__/papers.test.ts
git commit -m "feat(papers): 옛 논문 repro payload에 repo·diagram 기본값 채움"
```

---

### Task 5: 재구현 섹션 렌더러 (`sections.tsx`)

`reproSections`에 "GitHub 구조"·"모델 구조" 섹션을 추가하고, `RepoBlock`·`DiagramBlock` 렌더러를 새 의존성 없이 Tailwind 토큰으로 구현한다.

**Files:**
- Modify: `components/analyzer/sections.tsx` (import, 렌더러, `reproSections`)
- Test: `components/analyzer/__tests__/analyzer.test.tsx`

**Interfaces:**
- Consumes: `ReproPayload.repo`/`.diagram`(Task 1), 기존 `DescList`.
- Produces: `reproSections`가 `{id:"repo"}`·`{id:"diagram"}` 섹션을 추가로 반환.

- [ ] **Step 1: 실패 테스트 작성**

`components/analyzer/__tests__/analyzer.test.tsx`의 `describe("AnalysisView 관점 토글")` **뒤**에 추가:

```ts
describe("AnalysisView 재구현 — GitHub 구조·모델 구조", () => {
  it("재구현 관점에 GitHub 구조와 모델 구조 섹션이 보인다", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /재구현 분석/ }));

    expect(screen.getByRole("heading", { name: "GitHub 구조" })).toBeInTheDocument();
    expect(screen.getByText("https://github.com/acme/model")).toBeInTheDocument();
    expect(screen.getByText("src/model.py")).toBeInTheDocument();

    expect(screen.getByRole("heading", { name: "모델 구조" })).toBeInTheDocument();
    expect(screen.getByText("Encoder")).toBeInTheDocument();
    expect(screen.getByText("12-layer Transformer")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run analyzer.test.tsx -t "GitHub 구조"`
Expected: FAIL — 해당 섹션 heading이 없음.

- [ ] **Step 3: 구현 (`components/analyzer/sections.tsx`)**

(a) 타입 import에 추가(`ReproPayload` 등이 있는 import 블록에):

```ts
  ModelDiagram,
  NamedItem,
  RepoStructure,
  ReproPayload,
```

(b) `reproSections` 함수 **위**에 두 렌더러를 추가한다:

```tsx
/** GitHub 저장소 구조 — 못 찾으면 안내, 찾으면 URL·요약·트리. source=paper면 "추정" 배지. */
function RepoBlock({ repo }: { repo: RepoStructure }) {
  if (!repo.found) {
    return (
      <p className="text-[13px] text-fg-subtle">공개 코드 저장소를 못 찾았어요.</p>
    );
  }
  return (
    <div className="flex flex-col gap-3 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        {repo.url && (
          <a
            href={repo.url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-[12px] text-accent underline underline-offset-2"
          >
            {repo.url}
          </a>
        )}
        {repo.source === "paper" && (
          <span className="rounded-sm bg-bg-subtle px-1.5 py-0.5 text-[11px] text-fg-subtle">
            추정
          </span>
        )}
      </div>
      {repo.summary && <p className="text-fg-muted">{repo.summary}</p>}
      {repo.tree.length > 0 && <DescList items={repo.tree} />}
    </div>
  );
}

const DIAGRAM_GROUP_LABEL: Record<ModelDiagram["nodes"][number]["group"], string> = {
  data: "데이터",
  model: "모델",
  loss: "손실",
};

/** 모델/손실 도식 — group(데이터→모델→손실) 레인별 박스를 ↓로 쌓고, 비순차 연결은 "연결" 목록으로. */
function DiagramBlock({ diagram }: { diagram: ModelDiagram }) {
  if (diagram.nodes.length === 0) {
    return <p className="text-[13px] text-fg-subtle">다이어그램이 아직 없어요.</p>;
  }
  const labelById = new Map(diagram.nodes.map((n) => [n.id, n.label]));
  const groups = (["data", "model", "loss"] as const).filter((g) =>
    diagram.nodes.some((n) => n.group === g),
  );
  return (
    <div className="flex flex-col gap-3 text-[13px]">
      {groups.map((g) => {
        const nodes = diagram.nodes.filter((n) => n.group === g);
        return (
          <div key={g} className="flex flex-col gap-1.5">
            <p className="text-[12px] font-medium text-fg-subtle">
              {DIAGRAM_GROUP_LABEL[g]}
            </p>
            <div className="flex flex-col gap-1">
              {nodes.map((n, i) => (
                <React.Fragment key={n.id || i}>
                  <div className="rounded-md border border-border-token bg-bg-subtle px-3 py-2">
                    <p className="font-medium text-fg">{n.label}</p>
                    {n.detail && (
                      <p className="text-[12px] text-fg-muted">{n.detail}</p>
                    )}
                  </div>
                  {i < nodes.length - 1 && (
                    <span aria-hidden="true" className="text-center text-fg-faint">
                      ↓
                    </span>
                  )}
                </React.Fragment>
              ))}
            </div>
          </div>
        );
      })}
      {diagram.edges.length > 0 && (
        <div className="flex flex-col gap-1 border-t border-border-token pt-2">
          <p className="text-[12px] font-medium text-fg-subtle">연결</p>
          <ul className="flex flex-col gap-0.5 text-[12px] text-fg-muted">
            {diagram.edges.map((e, i) => (
              <li key={i}>
                {labelById.get(e.from) ?? e.from} → {labelById.get(e.to) ?? e.to}
                {e.label ? ` · ${e.label}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

(c) `reproSections`의 반환 배열 **끝**(`{ id: "gpu", ... }` 뒤)에 두 섹션을 추가:

```tsx
    { id: "gpu", title: "리소스", content: <GpuBlock gpu={p.gpu} /> },
    { id: "repo", title: "GitHub 구조", content: <RepoBlock repo={p.repo} /> },
    { id: "diagram", title: "모델 구조", content: <DiagramBlock diagram={p.diagram} /> },
  ];
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run analyzer.test.tsx`
Expected: 전체 PASS(기존 figure 공통 테스트는 Task 6에서 갱신하므로 아직 통과 상태 유지).

- [ ] **Step 5: Commit**

```bash
git add components/analyzer/sections.tsx components/analyzer/__tests__/analyzer.test.tsx
git commit -m "feat(analyzer): 재구현 관점에 GitHub 구조·모델 구조 섹션 추가"
```

---

### Task 6: Figure를 연구 관점 전용으로 제한 (`analysis-view.tsx`)

Figure `<section>`을 `lens === "research"`일 때만 렌더한다. 재구현 관점에선 사라지고 그 자리를 Task 5의 두 섹션이 채운다.

**Files:**
- Modify: `components/analyzer/analysis-view.tsx:360-400` (Figure `<section>` 래핑)
- Test: `components/analyzer/__tests__/analyzer.test.tsx` (기존 figure describe 교체)

**Interfaces:**
- Consumes: `lens` 상태(기존 컴포넌트 내부).

- [ ] **Step 1: figure 동작 테스트 교체(실패 유도)**

`components/analyzer/__tests__/analyzer.test.tsx`의 `describe("AnalysisView Figure 분석")` 블록 전체를 다음으로 교체한다:

```ts
describe("AnalysisView Figure 분석", () => {
  it("연구 관점에서만 figure가 보이고 재구현 관점에선 사라진다", () => {
    renderView();
    // 연구 관점에서 figure 노출.
    expect(screen.getByText("Figure 1 — 개요")).toBeInTheDocument();
    expect(screen.getByText("원문 PDF p.3에서 추출")).toBeInTheDocument();

    // 재구현으로 토글하면 figure 섹션이 사라진다.
    fireEvent.click(screen.getByRole("button", { name: /재구현 분석/ }));
    expect(screen.queryByText("Figure 1 — 개요")).toBeNull();
    expect(screen.queryByText("원문 PDF p.3에서 추출")).toBeNull();
    // 대신 GitHub 구조·모델 구조가 보인다.
    expect(screen.getByRole("heading", { name: "GitHub 구조" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "모델 구조" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run analyzer.test.tsx -t "Figure 분석"`
Expected: FAIL — 현재는 재구현 관점에서도 figure가 보여 `queryByText(...).toBeNull()`이 실패.

- [ ] **Step 3: 구현 (`components/analyzer/analysis-view.tsx`)**

Figure 주석 블록과 `<section aria-labelledby="section-figures" ...>` … `</section>` 전체(360–400행)를 `{lens === "research" && ( ... )}`로 감싼다. 즉:

기존:

```tsx
      {/* Figure 분석 — 두 관점 공통, 항상 하단 고정(ADR-004/R10). 노트는 lens:any(R11). */}
      <section aria-labelledby="section-figures" className="flex flex-col gap-3">
        ...
      </section>
    </div>
  );
}
```

교체(주석 문구도 새 동작에 맞춰 수정):

```tsx
      {/* Figure 분석 — 연구 관점 전용(재구현은 중복이라 제외). 노트는 lens:any(R11). */}
      {lens === "research" && (
        <section aria-labelledby="section-figures" className="flex flex-col gap-3">
          {/* (기존 section 내부 내용 그대로 유지) */}
        </section>
      )}
    </div>
  );
}
```

주의: `<section>` **내부 JSX는 한 글자도 바꾸지 않는다** — 여는 `{lens === "research" && (`와 닫는 `)}`만 추가하고 들여쓰기를 맞춘다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run analyzer.test.tsx`
Expected: 전체 PASS(figure 동작 + GitHub/모델 섹션 + 노트 테스트 모두).

- [ ] **Step 5: Commit**

```bash
git add components/analyzer/analysis-view.tsx components/analyzer/__tests__/analyzer.test.tsx
git commit -m "feat(analyzer): Figure 분석을 연구 관점 전용으로 제한"
```

---

### Task 7: 전체 검증

전 범위 회귀를 확인한다.

**Files:** 없음(검증만).

- [ ] **Step 1: 전체 테스트**

Run: `npx vitest run`
Expected: 전체 PASS, 실패 0.

- [ ] **Step 2: 타입체크 + 린트**

Run: `npx tsc --noEmit && npm run lint`
Expected: 타입 에러 0, 린트 통과(경고 외 에러 0).

- [ ] **Step 3: (선택) 빌드 스모크**

Run: `npm run build`
Expected: 빌드 성공. 실패 시 원인 수정(런타임 외부 패키지 등).

---

## 런타임 리스크 (단위 테스트 밖, 구현 후 수동 확인 권장)

- **googleSearch 그라운딩 + PDF inlineData 동시 사용 가부**: 단위 테스트는 Gemini를 모킹하므로 실제 API 동작을 검증하지 못한다. 첫 실데이터 분석에서 `extractRepoAndDiagram`이 의미 있는 결과를 내는지 1회 눈으로 확인한다. 실패해도 기본값으로 격리되어 다른 분석은 보존된다(R28).
- **그라운딩이 도구를 무시/스키마 충돌 시**: `config.tools`만 쓰고 `responseSchema`는 넣지 않으므로 충돌은 없다. 만약 SDK가 도구+PDF 조합을 거부하면 catch로 기본값 반환 → "저장소 못 찾음"으로 표시될 뿐 기능은 유지.
- **옛 논문 재분석 없이도 화면은 안전**: `reproWithDefaults`가 기본값을 채우므로 "GitHub 구조: 못 찾음", "모델 구조: 없음"으로 표시. 채우려면 `/reanalyze`.

## Self-Review 결과

- **스펙 커버리지**: Figure 연구 전용(Task 6) · GitHub 구조 추출(Task 2) · 모델/loss 다이어그램(Task 2 추출 + Task 5 렌더) · repro 머지(Task 3) · 옛 논문 호환(Task 4) · 테스트(각 태스크). 누락 없음.
- **Placeholder 스캔**: 모든 코드 스텝에 실제 코드 포함, TBD/TODO 없음.
- **타입 일관성**: `RepoStructure`/`ModelDiagram`/`DiagramNode`/`DiagramEdge`는 Task 1에서 정의해 Task 2(파싱)·3(머지)·4(기본값)·5(렌더)에서 동일 이름으로 사용. `extractRepoAndDiagram` 시그니처는 Task 2 정의 = Task 3 `AnalyzePaperDeps`와 일치.
