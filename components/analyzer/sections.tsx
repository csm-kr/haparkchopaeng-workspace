import * as React from "react";
import { cn } from "@/lib/utils";
import type {
  GpuSpec,
  IOSpec,
  LossItem,
  NamedItem,
  ReproPayload,
  ResearchPayload,
  TableBlock,
  TrainingSpec,
} from "@/types";

// 두 관점(연구/재구현) 섹션의 본문 렌더러. 순수 함수 — 상태 없음.
// AnalysisView(클라이언트 섬)가 섹션 카드/노트와 함께 조립한다.
// 표는 표로, 목록은 목록으로 평이하게 렌더한다(SCREENS §paper). 토큰만 사용(R20).

export interface SectionDef {
  /** 노트 스코프 키 — SectionNote.sectionId와 1:1 */
  id: string;
  title: string;
  content: React.ReactNode;
}

/** 빈 표(컬럼·행 모두 없음)면 정직하게 안내한다. */
function isEmptyTable(block: TableBlock): boolean {
  return block.columns.length === 0 && block.rows.length === 0;
}

function DataTable({ block }: { block: TableBlock }) {
  if (isEmptyTable(block)) {
    return <p className="text-[13px] text-fg-subtle">기록된 내용이 없어요.</p>;
  }
  return (
    <figure className="flex flex-col gap-2">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-border-token text-left text-fg-muted">
              {block.columns.map((c, i) => (
                <th key={i} className="px-3 py-2 font-medium">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((r, ri) => (
              <tr
                key={ri}
                // 강조는 색 + 글자 굵기를 병행한다(색에만 의존 금지, R29).
                className={cn(
                  "border-b border-border-token last:border-0",
                  r.highlight && "bg-accent-faint font-medium text-fg",
                )}
              >
                {r.cells.map((cell, ci) => (
                  <td key={ci} className="px-3 py-2">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {block.caption && (
        <figcaption className="text-[12px] text-fg-subtle">
          {block.caption}
        </figcaption>
      )}
    </figure>
  );
}

/** name/desc 쌍 목록 (model.items, metrics). */
function DescList({ items }: { items: NamedItem[] }) {
  return (
    <dl className="flex flex-col gap-2 text-[13px]">
      {items.map((it, i) => (
        <div key={i} className="flex flex-col gap-0.5">
          <dt className="font-medium text-fg">{it.name}</dt>
          <dd className="text-fg-muted">{it.desc}</dd>
        </div>
      ))}
    </dl>
  );
}

function IOBlock({ io }: { io: IOSpec }) {
  const col = (label: string, items: IOSpec["inputs"]) => (
    <div className="flex flex-col gap-2">
      <p className="text-[12px] font-medium text-fg-subtle">{label}</p>
      <ul className="flex flex-col gap-1.5 text-[13px]">
        {items.map((it, i) => (
          <li key={i} className="flex flex-col gap-0.5">
            <span className="flex items-center gap-2">
              <span className="font-medium text-fg">{it.name}</span>
              <span className="font-mono text-[11px] text-fg-subtle">
                {it.type}
              </span>
            </span>
            <span className="text-fg-muted">{it.desc}</span>
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {col("입력", io.inputs)}
      {col("출력", io.outputs)}
    </div>
  );
}

function TrainingBlock({
  loss,
  metrics,
  training,
}: {
  loss: LossItem[];
  metrics: NamedItem[];
  training: TrainingSpec;
}) {
  return (
    <div className="flex flex-col gap-4 text-[13px]">
      <div className="flex flex-col gap-2">
        <p className="text-[12px] font-medium text-fg-subtle">손실</p>
        <ul className="flex flex-col gap-1.5">
          {loss.map((l, i) => (
            <li key={i} className="flex flex-col gap-0.5">
              <span className="flex items-center gap-2">
                <span className="font-medium text-fg">{l.name}</span>
                <span className="font-mono text-[11px] text-fg-subtle">
                  {l.expr}
                </span>
              </span>
              <span className="text-fg-muted">{l.desc}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-[12px] font-medium text-fg-subtle">지표</p>
        <DescList items={metrics} />
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-[12px] font-medium text-fg-subtle">하이퍼파라미터</p>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <tbody>
              {training.rows.map((row, ri) => (
                <tr
                  key={ri}
                  className="border-b border-border-token last:border-0"
                >
                  <th
                    scope="row"
                    className="px-3 py-1.5 text-left font-medium text-fg-muted"
                  >
                    {row[0]}
                  </th>
                  <td className="px-3 py-1.5 font-mono text-[12px] text-fg">
                    {row[1]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {training.caption && (
          <p className="text-[12px] text-fg-subtle">{training.caption}</p>
        )}
      </div>
    </div>
  );
}

function GpuBlock({ gpu }: { gpu: GpuSpec }) {
  const rows: Array<[string, string]> = [
    ["하드웨어", `${gpu.hardware} × ${gpu.count}`],
    ["VRAM", `${gpu.vramUsedGb} / ${gpu.vramGb} GB 사용`],
    ["학습 기간", `${gpu.trainDays}일`],
  ];
  return (
    <div className="flex flex-col gap-3 text-[13px]">
      <dl className="grid gap-2 sm:grid-cols-3">
        {rows.map(([k, v]) => (
          <div key={k} className="flex flex-col gap-0.5">
            <dt className="text-[12px] text-fg-subtle">{k}</dt>
            <dd className="font-medium text-fg">{v}</dd>
          </div>
        ))}
      </dl>
      {gpu.note && <p className="text-[12px] text-fg-muted">{gpu.note}</p>}
    </div>
  );
}

/** 연구 관점 섹션 — Problem · Contribution · I/O · Comparison · Ablation (ADR-004). */
export function researchSections(p: ResearchPayload): SectionDef[] {
  return [
    {
      id: "problem",
      title: "Problem Setting",
      content: (
        <div className="flex flex-col gap-2 text-[13px]">
          <p className="font-medium text-fg">{p.problem.oneLine}</p>
          <p className="text-fg-muted">{p.problem.setting}</p>
          {p.problem.assumptions.length > 0 && (
            <ul className="ml-4 flex list-disc flex-col gap-1 text-fg-muted">
              {p.problem.assumptions.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          )}
        </div>
      ),
    },
    {
      id: "contributions",
      title: "Contribution",
      content: (
        <ul className="ml-4 flex list-disc flex-col gap-1 text-[13px] text-fg">
          {p.contributions.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      ),
    },
    { id: "io", title: "Input / Output", content: <IOBlock io={p.io} /> },
    {
      id: "comparison",
      title: "Comparison",
      content: <DataTable block={p.comparison} />,
    },
    {
      id: "ablation",
      title: "Ablation",
      content: <DataTable block={p.ablation} />,
    },
  ];
}

/** 재구현 관점 섹션 — 데이터 · 모델 · 학습 · 리소스 (ADR-004). */
export function reproSections(p: ReproPayload): SectionDef[] {
  return [
    { id: "data", title: "데이터", content: <DataTable block={p.data} /> },
    {
      id: "model",
      title: "모델",
      content: (
        <div className="flex flex-col gap-2 text-[13px]">
          <p className="text-fg-muted">
            <span className="font-medium text-fg">파라미터</span> ·{" "}
            {p.model.params}
          </p>
          <DescList items={p.model.items} />
        </div>
      ),
    },
    {
      id: "training",
      title: "학습",
      content: (
        <TrainingBlock
          loss={p.loss}
          metrics={p.metrics}
          training={p.training}
        />
      ),
    },
    { id: "gpu", title: "리소스", content: <GpuBlock gpu={p.gpu} /> },
  ];
}
