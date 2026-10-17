// @vitest-environment node
import { describe, expect, it } from "vitest";
import { JobCreateSchema } from "@/lib/local-agent/validation";
import { LOCAL_ANALYSIS_PROMPT, parseLocalAnalysis } from "../payload";

interface SchemaNode {
  type?: string;
  properties?: Record<string, SchemaNode>;
  items?: SchemaNode;
  required?: string[];
  additionalProperties?: boolean;
}
function promptSchema(): SchemaNode {
  const encoded = LOCAL_ANALYSIS_PROMPT.match(/<output_schema>\n([\s\S]+?)\n<\/output_schema>/)?.[1];
  if (!encoded) throw new Error("The analysis prompt must carry its generated JSON Schema.");
  return JSON.parse(encoded) as SchemaNode;
}
function property(node: SchemaNode, ...names: string[]): SchemaNode {
  for (const name of names) {
    const next = node.properties?.[name];
    if (!next) throw new Error(`Missing output property ${names.join(".")}`);
    node = next;
  }
  return node;
}
const original = "The input is a sequence of three numbers and the output is their arithmetic mean.";
const source = JSON.stringify([{ page: 1, text: original }]);
function complete() {
  const emptyTable = { caption: "미기재", columns: [], rows: [] };
  return {
    research: { problem: { oneLine: "평균 계산", setting: "합성 원문", assumptions: [] }, contributions: [], io: { inputs: [], outputs: [{ name: "평균", type: "number", desc: "세 수의 산술평균" }] }, comparison: emptyTable, ablation: emptyTable },
    repro: {
      data: { caption: "합성", columns: ["입력"], rows: [{ cells: ["세 수"], highlight: false }] },
      model: { params: "미기재", items: [] }, loss: [], metrics: [], training: { caption: "미기재", rows: [] },
      gpu: { hardware: "미기재", count: 0, vramGb: 0, vramUsedGb: 0, trainDays: 0, note: "미기재" },
      repo: { found: false, url: null, summary: "외부 저장소 미확인", tree: [], source: "paper" },
      diagram: { nodes: [{ id: "input", label: "입력", detail: "세 수", group: "data" }, { id: "output", label: "출력", detail: "평균", group: "data" }], edges: [{ from: "input", to: "output", label: "" }] },
    },
    figures: [], references: ["research", "repro"].map(lens => ({ lens, sourcePage: 1, quote: original })),
  };
}

describe("local analysis prompt and strict output contract", () => {
  it("specifies object elements and all required keys for outputs, table rows and diagram edges", () => {
    const schema = promptSchema();
    const output = property(schema, "research", "io", "outputs").items;
    expect(output).toMatchObject({ type: "object", additionalProperties: false });
    expect(output?.required).toEqual(expect.arrayContaining(["name", "type", "desc"]));
    for (const [lens, section] of [["research", "comparison"], ["research", "ablation"], ["repro", "data"]]) {
      const row = property(property(schema, lens, section), "rows").items;
      expect(row?.required).toEqual(expect.arrayContaining(["cells", "highlight"]));
      expect(row?.properties?.highlight).toMatchObject({ type: "boolean" });
    }
    const edge = property(schema, "repro", "diagram", "edges").items;
    expect(edge?.required).toEqual(expect.arrayContaining(["from", "to", "label"]));
    expect(edge?.properties?.label).toMatchObject({ type: "string" });
  });

  it("describes every array element and keeps every object strict throughout the prompt schema", () => {
    let arrays = 0;
    function visit(node: SchemaNode) {
      if (node.type === "array") {
        arrays++;
        expect(node.items?.type).toBeTruthy();
        if (node.items) visit(node.items);
      }
      if (node.type === "object") {
        expect(node.additionalProperties).toBe(false);
        expect(new Set(node.required)).toEqual(new Set(Object.keys(node.properties ?? {})));
        for (const child of Object.values(node.properties ?? {})) visit(child);
      }
    }
    visit(promptSchema());
    expect(arrays).toBeGreaterThan(15);
  });

  it("retains strict server rejection for the three observed omission shapes without filling them", () => {
    const value = complete();
    expect(parseLocalAnalysis(JSON.stringify(value), source).repro.diagram.edges[0].label).toBe("");
    const wrongOutput = { ...value, research: { ...value.research, io: { ...value.research.io, outputs: ["평균"] } } };
    const missingHighlight = { ...value, repro: { ...value.repro, data: { ...value.repro.data, rows: [{ cells: ["세 수"] }] } } };
    const missingLabel = { ...value, repro: { ...value.repro, diagram: { ...value.repro.diagram, edges: [{ from: "input", to: "output" }] } } };
    for (const invalid of [wrongOutput, missingHighlight, missingLabel]) {
      const serialized = JSON.stringify(invalid);
      expect(() => parseLocalAnalysis(serialized, source)).toThrow(/형식/);
      expect(JSON.stringify(invalid)).toBe(serialized);
    }
  });

  it("fits the actual desktop queue prompt limit with a complete generated contract", () => {
    expect(LOCAL_ANALYSIS_PROMPT.length).toBeLessThanOrEqual(12_000);
    expect(JobCreateSchema.safeParse({ deviceId: "fixture-pc", paperId: "fixture-paper", provider: "codex", model: "fixture-model", requestId: "188d0914-29da-4200-86aa-ab7551ff42dd", prompt: LOCAL_ANALYSIS_PROMPT }).success).toBe(true);
  });
});
