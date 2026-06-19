import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReproPayload, ResearchPayload } from "@/types";

// 분석 파이프라인 단위 테스트 — Gemini(`@google/genai`)와 Prisma를 모킹한다(AC).
// ① Gemini 추출: responseSchema 형태·inlineData PDF·JSON 파싱·안전차단/빈응답 격리·키 서버전용
// ② 오케스트레이션: 페이로드→Analysis/Figure 매핑·pending→ready/failed 전이·실패 격리(Paper 유지)

// vi.mock 팩토리는 호이스팅되므로 hoisted로 핸들을 만든다.
const { generateContentMock, GoogleGenAIMock } = vi.hoisted(() => {
  const generateContentMock = vi.fn();
  const GoogleGenAIMock = vi.fn(() => ({
    models: { generateContent: generateContentMock },
  }));
  return { generateContentMock, GoogleGenAIMock };
});

vi.mock("@google/genai", () => ({
  GoogleGenAI: GoogleGenAIMock,
  // Type enum 값과 동일한 문자열(스키마 빌드에 사용).
  Type: {
    TYPE_UNSPECIFIED: "TYPE_UNSPECIFIED",
    STRING: "STRING",
    NUMBER: "NUMBER",
    INTEGER: "INTEGER",
    BOOLEAN: "BOOLEAN",
    ARRAY: "ARRAY",
    OBJECT: "OBJECT",
  },
}));

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    paper: { findUnique: vi.fn(), update: vi.fn() },
    analysis: { upsert: vi.fn() },
    figure: { deleteMany: vi.fn(), createMany: vi.fn() },
    job: { create: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

// figure-render는 mupdf(wasm)·sharp를 끌어오므로 모킹한다(오케스트레이션은 deps로 가짜를 주입).
vi.mock("@/lib/figure-render", () => ({ renderFigures: vi.fn() }));

// 모킹 후에 import — 모듈이 모킹된 의존성을 받도록.
const {
  analyzePaper,
  extractAnalysis,
  extractFigures,
  extractRepoAndDiagram,
  durationMsFrom,
} = await import("@/lib/analysis");

const research: ResearchPayload = {
  problem: { oneLine: "한 줄", setting: "세팅", assumptions: ["a"] },
  contributions: ["기여1"],
  io: {
    inputs: [{ name: "x", type: "int", desc: "입력" }],
    outputs: [{ name: "y", type: "float", desc: "출력" }],
  },
  comparison: { caption: "비교", columns: ["m"], rows: [{ cells: ["A"], highlight: false }] },
  ablation: { caption: "애블", columns: ["s"], rows: [{ cells: ["B"], highlight: true }] },
};

const repro: ReproPayload = {
  data: { caption: "데이터", columns: ["셋"], rows: [{ cells: ["코퍼스"], highlight: false }] },
  model: { params: "220M", items: [{ name: "구조", desc: "디코더" }] },
  loss: [{ name: "CE", expr: "-log p", desc: "교차엔트로피" }],
  metrics: [{ name: "PPL", desc: "퍼플렉서티" }],
  training: { caption: "하이퍼", rows: [["opt", "AdamW"]] },
  gpu: { hardware: "A100", count: 8, vramGb: 80, vramUsedGb: 60, trainDays: 2, note: "추정" },
  repo: { found: false, url: null, summary: "", tree: [], source: "paper" },
  diagram: { nodes: [], edges: [] },
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GEMINI_API_KEY = "test-key";
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Gemini 추출 (extractAnalysis)", () => {
  it("inlineData PDF + responseSchema(연구)로 호출하고 JSON을 파싱한다", async () => {
    generateContentMock.mockResolvedValue({
      text: JSON.stringify(research),
      promptFeedback: undefined,
    });

    const out = await extractAnalysis(Buffer.from("PDFBYTES"), "research");
    expect(out).toEqual(research);

    const arg = generateContentMock.mock.calls[0][0];
    // 구조화 출력 강제.
    expect(arg.config.responseMimeType).toBe("application/json");
    // 연구 관점 스키마 형태.
    expect(arg.config.responseSchema.properties).toHaveProperty("problem");
    expect(arg.config.responseSchema.properties).toHaveProperty("contributions");
    expect(arg.config.responseSchema.properties).toHaveProperty("comparison");
    expect(arg.config.responseSchema.properties).toHaveProperty("ablation");
    // PDF는 base64 inlineData(application/pdf).
    const part = arg.contents[0].parts[0];
    expect(part.inlineData.mimeType).toBe("application/pdf");
    expect(part.inlineData.data).toBe(Buffer.from("PDFBYTES").toString("base64"));
  });

  it("재구현 관점은 repro 스키마 형태로 호출한다", async () => {
    generateContentMock.mockResolvedValue({ text: JSON.stringify(repro) });
    await extractAnalysis(Buffer.from("x"), "repro");
    const arg = generateContentMock.mock.calls[0][0];
    expect(arg.config.responseSchema.properties).toHaveProperty("data");
    expect(arg.config.responseSchema.properties).toHaveProperty("gpu");
    expect(arg.config.responseSchema.properties).toHaveProperty("training");
  });

  it("안전 차단(blockReason)이면 던진다(잡에서 failed로 격리)", async () => {
    generateContentMock.mockResolvedValue({
      promptFeedback: { blockReason: "SAFETY" },
    });
    await expect(extractAnalysis(Buffer.from("x"), "research")).rejects.toThrow(
      /거부/,
    );
  });

  it("빈 응답이면 던진다", async () => {
    generateContentMock.mockResolvedValue({ text: "" });
    await expect(extractAnalysis(Buffer.from("x"), "research")).rejects.toThrow(
      /비어/,
    );
  });

  it("GEMINI_API_KEY가 없으면 호출 시점에 던진다(키는 서버 전용, R2)", async () => {
    delete process.env.GEMINI_API_KEY;
    await expect(extractAnalysis(Buffer.from("x"), "research")).rejects.toThrow(
      /GEMINI_API_KEY/,
    );
    expect(generateContentMock).not.toHaveBeenCalled();
  });
});

describe("Gemini figure 추출 (extractFigures)", () => {
  it("box 없는 figure는 box=null·imageUrl=null로 둔다(렌더 단계가 채움)", async () => {
    generateContentMock.mockResolvedValue({
      text: JSON.stringify({
        figures: [
          { title: "Figure 1", caption: "캡션", interpretation: "해석", sourcePage: 3 },
        ],
      }),
    });
    const figs = await extractFigures(Buffer.from("x"));
    expect(figs).toEqual([
      {
        title: "Figure 1",
        caption: "캡션",
        interpretation: "해석",
        sourcePage: 3,
        box: null,
        imageUrl: null,
      },
    ]);
    const arg = generateContentMock.mock.calls[0][0];
    expect(arg.config.responseSchema.properties).toHaveProperty("figures");
    // box는 스키마에 있지만 required는 아니다(Gemini가 못 잡으면 생략 — fallback이 동작해야 함).
    const itemProps = arg.config.responseSchema.properties.figures.items.properties;
    expect(itemProps).toHaveProperty("box");
    expect(
      arg.config.responseSchema.properties.figures.items.required,
    ).not.toContain("box");
  });

  it("box(0–1000 정규화)가 오면 FigureExtract.box로 파싱한다", async () => {
    generateContentMock.mockResolvedValue({
      text: JSON.stringify({
        figures: [
          {
            title: "Figure 2",
            caption: "c",
            interpretation: "i",
            sourcePage: 5,
            box: { ymin: 100, xmin: 200, ymax: 600, xmax: 800 },
          },
        ],
      }),
    });
    const figs = await extractFigures(Buffer.from("x"));
    expect(figs[0].box).toEqual({ ymin: 100, xmin: 200, ymax: 600, xmax: 800 });
    expect(figs[0].imageUrl).toBeNull();
  });

  it("box 좌표가 하나라도 숫자가 아니면 box=null(방어적)", async () => {
    generateContentMock.mockResolvedValue({
      text: JSON.stringify({
        figures: [
          {
            title: "F",
            caption: "c",
            interpretation: "i",
            sourcePage: 1,
            box: { ymin: 1, xmin: 2, ymax: "x", xmax: 4 },
          },
        ],
      }),
    });
    const figs = await extractFigures(Buffer.from("x"));
    expect(figs[0].box).toBeNull();
  });
});

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

describe("분석 오케스트레이션 (analyzePaper)", () => {
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

  const deps = {
    loadPdf: vi.fn(),
    extractAnalysis: vi.fn(),
    extractFigures: vi.fn(),
    renderFigures: vi.fn(),
    extractRepoAndDiagram: vi.fn(),
  };

  beforeEach(() => {
    deps.loadPdf.mockResolvedValue(Buffer.from("pdf"));
    deps.extractAnalysis.mockImplementation(async (_pdf: Buffer, lens: string) =>
      lens === "research" ? research : repro,
    );
    deps.extractFigures.mockResolvedValue([
      { title: "F1", caption: "c", interpretation: "i", sourcePage: 2, box: null, imageUrl: null },
    ]);
    // 기본은 passthrough(imageUrl 그대로 null) — 렌더가 채우는 케이스는 개별 테스트에서 덮어쓴다.
    deps.renderFigures.mockImplementation(
      async (
        _pdf: Buffer,
        _paperId: string,
        figs: Array<{ imageUrl: string | null }>,
      ) => figs,
    );
    deps.extractRepoAndDiagram.mockResolvedValue(repoDiagram);
    prismaMock.job.create.mockResolvedValue({ id: "job1" });
    prismaMock.job.update.mockResolvedValue({});
    prismaMock.paper.update.mockResolvedValue({});
    prismaMock.paper.findUnique.mockResolvedValue({
      analysisStartedAt: new Date(Date.now() - 5000),
    });
    prismaMock.$transaction.mockResolvedValue([]);
  });

  it("페이로드를 Analysis(두 관점)/Figure로 매핑하고 pending→ready로 전이한다", async () => {
    await analyzePaper("p1", deps);

    // 두 관점 Analysis upsert.
    expect(prismaMock.analysis.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { paperId_lens: { paperId: "p1", lens: "research" } },
        create: expect.objectContaining({ payload: research }),
      }),
    );
    expect(prismaMock.analysis.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { paperId_lens: { paperId: "p1", lens: "repro" } },
        create: expect.objectContaining({ payload: { ...repro, ...repoDiagram } }),
      }),
    );
    // Figure 재생성(매핑, imageUrl=null).
    expect(prismaMock.figure.deleteMany).toHaveBeenCalledWith({ where: { paperId: "p1" } });
    expect(prismaMock.figure.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ paperId: "p1", title: "F1", sourcePage: 2, imageUrl: null }),
      ],
    });
    // analysisStatus=ready 전이 + 소요시간 기록(트랜잭션 내).
    expect(prismaMock.paper.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: expect.objectContaining({
        analysisStatus: "ready",
        analysisDurationMs: expect.any(Number),
      }),
    });
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    // Job 상태 미러: running→done.
    expect(prismaMock.job.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "analyze_paper",
          status: "running",
          payload: { paperId: "p1" },
        }),
      }),
    );
    expect(prismaMock.job.update).toHaveBeenCalledWith({
      where: { id: "job1" },
      data: { status: "done" },
    });
  });

  it("extractRepoAndDiagram 결과를 repro payload에 머지해 저장한다", async () => {
    await analyzePaper("p1", deps);
    const reproCall = prismaMock.analysis.upsert.mock.calls.find(
      (c) => c[0].where.paperId_lens.lens === "repro",
    );
    expect(reproCall?.[0].create.payload.repo).toEqual(repoDiagram.repo);
    expect(reproCall?.[0].create.payload.diagram).toEqual(repoDiagram.diagram);
    expect(deps.extractRepoAndDiagram).toHaveBeenCalledTimes(1);
  });

  it("renderFigures가 채운 imageUrl이 Figure 저장(createMany)에 반영된다", async () => {
    deps.renderFigures.mockImplementation(
      async (
        _pdf: Buffer,
        _paperId: string,
        figs: Array<{ imageUrl: string | null }>,
      ) => figs.map((f, i) => ({ ...f, imageUrl: `figures/p1/${i}.png` })),
    );

    await analyzePaper("p1", deps);

    expect(prismaMock.figure.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ title: "F1", imageUrl: "figures/p1/0.png" })],
    });
  });

  it("추출 실패는 격리한다 — Paper 보존, analysisStatus=failed, Job.lastError, 다시 던짐", async () => {
    deps.extractAnalysis.mockRejectedValue(new Error("Gemini가 분석을 거부했어요 (SAFETY)."));

    await expect(analyzePaper("p1", deps)).rejects.toThrow();

    // 분석은 영속화되지 않는다(트랜잭션 미실행) → 업로드/Paper 보존(R28).
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    // Paper는 삭제하지 않고 상태만 failed로.
    expect(prismaMock.paper.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { analysisStatus: "failed" },
    });
    // Job 미러에 실패 보존.
    expect(prismaMock.job.update).toHaveBeenCalledWith({
      where: { id: "job1" },
      data: expect.objectContaining({ status: "failed", lastError: expect.any(String) }),
    });
  });
});

describe("durationMsFrom (분석 소요시간)", () => {
  it("시작 시각부터 now까지 ms를 잰다", () => {
    expect(durationMsFrom(new Date(1000), 6000)).toBe(5000);
  });
  it("시작 시각이 없으면 null", () => {
    expect(durationMsFrom(null, 6000)).toBeNull();
  });
  it("음수는 0으로 클램프한다(시계 역행 방어)", () => {
    expect(durationMsFrom(new Date(10000), 5000)).toBe(0);
  });
});
