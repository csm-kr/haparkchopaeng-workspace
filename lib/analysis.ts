import {
  GoogleGenAI,
  type GenerateContentResponse,
  type Schema,
  Type,
} from "@google/genai";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { signedDownloadUrl } from "@/lib/storage";
import { renderFigures } from "@/lib/figure-render";
import type { Lens, ReproPayload, ResearchPayload } from "@/types";

// 논문 분석 파이프라인 (서버 전용). PDF → 두 관점(연구/재구현) 구조화 분석 + figure 해석.
// LLM 제공자는 Google Gemini(`@google/genai`)다(ADR-011). Anthropic SDK는 쓰지 않는다.
// CRITICAL: GEMINI_API_KEY는 서버에서만(R2). 키는 모듈 로드가 아니라 호출 시점에 읽는다.
// CRITICAL: 이 모듈의 추출 함수는 Inngest 잡에서만 호출한다 — route handler 인라인 금지(R31/ADR-013→016).
// CRITICAL: 분석 실패가 Paper·원문 PDF를 막지 않는다 — analysisStatus=failed로 두고 재시도(R28).

function getAi(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  return new GoogleGenAI({ apiKey });
}

function modelId(): string {
  return process.env.GEMINI_MODEL ?? "gemini-2.5-pro";
}

/** PDF 바이트를 Gemini inlineData 파트로 — base64 + application/pdf(ENV.md §구현 지침). */
function pdfPart(pdf: Buffer) {
  return {
    inlineData: {
      mimeType: "application/pdf",
      data: pdf.toString("base64"),
    },
  };
}

// --- responseSchema (두 관점 구조화 출력 강제, 파싱 안정성) ---

const STR: Schema = { type: Type.STRING };
const STR_ARRAY: Schema = { type: Type.ARRAY, items: STR };

const TABLE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    caption: STR,
    columns: STR_ARRAY,
    rows: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          cells: STR_ARRAY,
          highlight: { type: Type.BOOLEAN },
        },
        required: ["cells", "highlight"],
      },
    },
  },
  required: ["caption", "columns", "rows"],
};

const IO_ITEM: Schema = {
  type: Type.OBJECT,
  properties: { name: STR, type: STR, desc: STR },
  required: ["name", "type", "desc"],
};

const NAMED_ITEM: Schema = {
  type: Type.OBJECT,
  properties: { name: STR, desc: STR },
  required: ["name", "desc"],
};

export const RESEARCH_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    problem: {
      type: Type.OBJECT,
      properties: { oneLine: STR, setting: STR, assumptions: STR_ARRAY },
      required: ["oneLine", "setting", "assumptions"],
    },
    contributions: STR_ARRAY,
    io: {
      type: Type.OBJECT,
      properties: {
        inputs: { type: Type.ARRAY, items: IO_ITEM },
        outputs: { type: Type.ARRAY, items: IO_ITEM },
      },
      required: ["inputs", "outputs"],
    },
    comparison: TABLE_SCHEMA,
    ablation: TABLE_SCHEMA,
  },
  required: ["problem", "contributions", "io", "comparison", "ablation"],
};

export const REPRO_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    data: TABLE_SCHEMA,
    model: {
      type: Type.OBJECT,
      properties: {
        params: STR,
        items: { type: Type.ARRAY, items: NAMED_ITEM },
      },
      required: ["params", "items"],
    },
    loss: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { name: STR, expr: STR, desc: STR },
        required: ["name", "expr", "desc"],
      },
    },
    metrics: { type: Type.ARRAY, items: NAMED_ITEM },
    training: {
      type: Type.OBJECT,
      properties: {
        caption: STR,
        rows: { type: Type.ARRAY, items: STR_ARRAY },
      },
      required: ["caption", "rows"],
    },
    gpu: {
      type: Type.OBJECT,
      properties: {
        hardware: STR,
        count: { type: Type.INTEGER },
        vramGb: { type: Type.NUMBER },
        vramUsedGb: { type: Type.NUMBER },
        trainDays: { type: Type.NUMBER },
        note: STR,
      },
      required: ["hardware", "count", "vramGb", "vramUsedGb", "trainDays", "note"],
    },
  },
  required: ["data", "model", "loss", "metrics", "training", "gpu"],
};

/** figure를 감싸는 bounding box(0–1000 정규화 좌표, Gemini 객체 검출 규약). 렌더 단계 입력. */
const BOX_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    ymin: { type: Type.INTEGER },
    xmin: { type: Type.INTEGER },
    ymax: { type: Type.INTEGER },
    xmax: { type: Type.INTEGER },
  },
  required: ["ymin", "xmin", "ymax", "xmax"],
};

export const FIGURES_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    figures: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title: STR,
          caption: STR,
          interpretation: STR,
          sourcePage: { type: Type.INTEGER },
          // box는 선택(required 미포함) — Gemini가 못 잡으면 생략, 그땐 렌더가 페이지 fallback.
          box: BOX_SCHEMA,
        },
        required: ["title", "caption", "interpretation", "sourcePage"],
      },
    },
  },
  required: ["figures"],
};

const SCHEMA_BY_LENS: Record<Lens, Schema> = {
  research: RESEARCH_SCHEMA,
  repro: REPRO_SCHEMA,
};

const PROMPT_BY_LENS: Record<Lens, string> = {
  research:
    "이 논문을 '연구' 관점으로 분석해 주어진 JSON 스키마로만 답하라. " +
    "문제 설정·기여·입출력·비교표·ablation을 구조화해 채운다. 한국어로 쓴다.",
  repro:
    "이 논문을 '재구현' 관점으로 분석해 주어진 JSON 스키마로만 답하라. " +
    "데이터·모델·손실·지표·학습 하이퍼파라미터·GPU 리소스를 구조화해 채운다. 한국어로 쓴다.",
};

const FIGURES_PROMPT =
  "이 논문의 주요 figure들을 찾아 주어진 JSON 스키마로만 답하라. " +
  "각 figure의 제목·캡션·평이한 해석(interpretation)·원문 페이지(sourcePage)를 채운다. " +
  "각 figure를 감싸는 bounding box를 0–1000 정규화 좌표 [ymin,xmin,ymax,xmax]로 box에 채운다(못 찾으면 생략). " +
  "한국어로 쓴다.";

/** 안전 차단·빈 응답을 잡아 던진다(실패는 잡에서 failed로 격리). */
function responseText(res: GenerateContentResponse): string {
  const blockReason = res.promptFeedback?.blockReason;
  if (blockReason) {
    throw new Error(`Gemini가 분석을 거부했어요 (${blockReason}).`);
  }
  const text = res.text;
  if (typeof text !== "string" || text.trim() === "") {
    throw new Error("Gemini 응답이 비어 있어요.");
  }
  return text;
}

/** PDF에서 한 관점의 구조화 분석을 추출한다(Gemini, responseSchema 강제). */
export async function extractAnalysis(
  pdf: Buffer,
  lens: Lens,
): Promise<ResearchPayload | ReproPayload> {
  const ai = getAi();
  const res = await ai.models.generateContent({
    model: modelId(),
    contents: [{ role: "user", parts: [pdfPart(pdf), { text: PROMPT_BY_LENS[lens] }] }],
    config: {
      responseMimeType: "application/json",
      responseSchema: SCHEMA_BY_LENS[lens],
    },
  });
  return JSON.parse(responseText(res)) as ResearchPayload | ReproPayload;
}

/** figure를 감싸는 bounding box(0–1000 정규화). 렌더 단계가 페이지 픽셀로 변환해 크롭한다. */
export interface FigureBox {
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
}

/** figure 추출 결과. box는 렌더 입력, imageUrl은 렌더 단계가 채운다(추출 단계에선 null). */
export interface FigureExtract {
  title: string;
  caption: string;
  interpretation: string;
  sourcePage: number;
  box: FigureBox | null;
  imageUrl: string | null;
}

interface RawFigure {
  title?: unknown;
  caption?: unknown;
  interpretation?: unknown;
  sourcePage?: unknown;
  box?: unknown;
}

/** RawFigure.box를 FigureBox로 좁힌다 — 네 좌표가 모두 유한 숫자일 때만. 아니면 null(→ 페이지 fallback). */
function parseBox(raw: unknown): FigureBox | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const ymin = Number(o.ymin);
  const xmin = Number(o.xmin);
  const ymax = Number(o.ymax);
  const xmax = Number(o.xmax);
  if ([ymin, xmin, ymax, xmax].every((n) => Number.isFinite(n))) {
    return { ymin, xmin, ymax, xmax };
  }
  return null;
}

/** PDF에서 figure 메타/해석을 추출한다. 이미지가 없으면 imageUrl=null로 둔다(ADR-011/I-1). */
export async function extractFigures(pdf: Buffer): Promise<FigureExtract[]> {
  const ai = getAi();
  const res = await ai.models.generateContent({
    model: modelId(),
    contents: [{ role: "user", parts: [pdfPart(pdf), { text: FIGURES_PROMPT }] }],
    config: {
      responseMimeType: "application/json",
      responseSchema: FIGURES_SCHEMA,
    },
  });
  const parsed = JSON.parse(responseText(res)) as { figures?: RawFigure[] };
  const list = Array.isArray(parsed.figures) ? parsed.figures : [];
  return list.map((f) => ({
    title: String(f.title ?? ""),
    caption: String(f.caption ?? ""),
    interpretation: String(f.interpretation ?? ""),
    sourcePage: Number(f.sourcePage ?? 0),
    box: parseBox(f.box),
    imageUrl: null,
  }));
}

// --- 오케스트레이션 (Inngest 잡이 호출) ---

/** 잡이 주입하는 의존성. 기본은 실제 Gemini + Storage. 테스트는 가짜를 주입한다. */
export interface AnalyzePaperDeps {
  loadPdf(paperId: string): Promise<Buffer>;
  extractAnalysis(pdf: Buffer, lens: Lens): Promise<ResearchPayload | ReproPayload>;
  extractFigures(pdf: Buffer): Promise<FigureExtract[]>;
  renderFigures(
    pdf: Buffer,
    paperId: string,
    figures: FigureExtract[],
  ): Promise<FigureExtract[]>;
}

/** 스토리지에서 원문 PDF 바이트를 가져온다(비공개 버킷 → 단기 서명 URL, R36). */
async function loadPaperPdf(paperId: string): Promise<Buffer> {
  const paper = await prisma.paper.findUnique({
    where: { id: paperId },
    select: { pdfUrl: true },
  });
  if (!paper) throw new Error("논문을 찾을 수 없어요.");
  const url = await signedDownloadUrl(paper.pdfUrl, 120);
  const res = await fetch(url);
  if (!res.ok) throw new Error("PDF를 불러오지 못했어요.");
  return Buffer.from(await res.arrayBuffer());
}

export const realDeps: AnalyzePaperDeps = {
  loadPdf: loadPaperPdf,
  extractAnalysis,
  extractFigures,
  renderFigures,
};

/** 분석 결과를 한 트랜잭션으로 영속화하고 analysisStatus=ready로 전이한다(멱등 upsert). */
async function persistAnalysis(
  paperId: string,
  research: ResearchPayload,
  repro: ReproPayload,
  figures: FigureExtract[],
): Promise<void> {
  const researchJson = research as unknown as Prisma.InputJsonValue;
  const reproJson = repro as unknown as Prisma.InputJsonValue;
  await prisma.$transaction([
    prisma.analysis.upsert({
      where: { paperId_lens: { paperId, lens: "research" } },
      create: { paperId, lens: "research", payload: researchJson },
      update: { payload: researchJson },
    }),
    prisma.analysis.upsert({
      where: { paperId_lens: { paperId, lens: "repro" } },
      create: { paperId, lens: "repro", payload: reproJson },
      update: { payload: reproJson },
    }),
    prisma.figure.deleteMany({ where: { paperId } }),
    prisma.figure.createMany({
      data: figures.map((f) => ({
        paperId,
        title: f.title,
        caption: f.caption,
        interpretation: f.interpretation,
        sourcePage: f.sourcePage,
        imageUrl: f.imageUrl,
      })),
    }),
    prisma.paper.update({
      where: { id: paperId },
      data: { analysisStatus: "ready" },
    }),
  ]);
}

/**
 * 논문 분석을 실행한다(Inngest 잡 본체). PDF 로드 → Gemini research/repro/figure → DB 저장 →
 * analysisStatus pending→ready. `Job` 테이블은 상태 미러(멱등·재시도·실패 보존, ADR-013→016).
 * 실패 시 analysisStatus=failed + Job.lastError로 격리하고 다시 던진다 — Inngest 재시도에 맡긴다(R28).
 */
export async function analyzePaper(
  paperId: string,
  deps: AnalyzePaperDeps = realDeps,
): Promise<void> {
  const job = await prisma.job.create({
    data: {
      type: "analyze_paper",
      status: "running",
      payload: { paperId },
      claimedAt: new Date(),
    },
  });

  try {
    const pdf = await deps.loadPdf(paperId);
    const [research, repro, extracted] = await Promise.all([
      deps.extractAnalysis(pdf, "research"),
      deps.extractAnalysis(pdf, "repro"),
      deps.extractFigures(pdf),
    ]);
    // figure 이미지 렌더(크롭/페이지 fallback)로 imageUrl을 채운다.
    // renderFigures는 figure·PDF 단위로 격리(throw 안 함)하지만, 방어적으로 감싸 메타 분석을 지킨다(R28).
    let figures = extracted;
    try {
      figures = await deps.renderFigures(pdf, paperId, extracted);
    } catch {
      // 렌더 전체가 실패해도 분석을 막지 않는다 — extracted는 이미 imageUrl=null이라 그대로 저장.
      figures = extracted;
    }
    await persistAnalysis(
      paperId,
      research as ResearchPayload,
      repro as ReproPayload,
      figures,
    );
    await prisma.job.update({
      where: { id: job.id },
      data: { status: "done" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "분석에 실패했어요.";
    // 실패 격리: Paper·원문 PDF는 보존하고 분석만 실패로 표시한다(R28).
    await prisma.paper.update({
      where: { id: paperId },
      data: { analysisStatus: "failed" },
    });
    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: "failed",
        lastError: message,
        attempts: { increment: 1 },
      },
    });
    throw e; // Inngest 재시도(retries)에 맡긴다.
  }
}
