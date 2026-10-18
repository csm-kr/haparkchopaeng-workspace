"use client";
import * as React from "react";
import Image from "next/image";
import type { SeminarSlide } from "@/lib/seminar/contract";

export function SlideVisual({ visual, paperId }: { visual: NonNullable<SeminarSlide["visual"]>; paperId?: string }) {
  const id = React.useId().replace(/:/g, "");
  const [failed, setFailed] = React.useState(false);
  if (visual.kind === "figure" || visual.kind === "page") {
    const src = visual.kind === "figure" ? `/api/figures/${encodeURIComponent(visual.figureId)}/image` : paperId ? `/api/papers/${encodeURIComponent(paperId)}/pages/${visual.page}` : null;
    return <figure className="flex min-w-0 flex-col gap-2"><div className="relative min-h-56 overflow-hidden rounded-md border border-border-token bg-bg-elevated">{src && !failed ? <Image key={src} src={src} alt={visual.caption} fill unoptimized sizes="(max-width: 768px) 90vw, 50vw" className="object-contain p-2" onError={() => setFailed(true)} /> : <p role="status" className="p-5 text-[13px] text-fg-muted">원문 그림을 불러오지 못했어요. 연결된 논문에서 확인해주세요.</p>}</div><figcaption className="text-[12px] leading-relaxed text-fg-subtle">{visual.caption}</figcaption></figure>;
  }
  if (visual.kind === "table") return <figure className="flex min-w-0 flex-col gap-2"><div className="overflow-x-auto rounded-md border border-border-token"><table className="w-full border-collapse text-left text-[12px]"><thead className="bg-accent-faint text-fg">{<tr>{visual.columns.map((column, index) => <th key={index} className="border-b border-border-token p-2 font-semibold">{column}</th>)}</tr>}</thead><tbody>{visual.rows.map((row, index) => <tr key={index} className="even:bg-bg-subtle">{row.map((cell, n) => <td key={n} className="break-words border-b border-border-token p-2 align-top text-fg-muted">{cell}</td>)}</tr>)}</tbody></table></div><figcaption className="text-[12px] leading-relaxed text-fg-subtle">{visual.caption}</figcaption></figure>;
  const columns = visual.nodes.length <= 4 ? 2 : 3;
  const width = columns === 2 ? 280 : 214, height = 126;
  const positions = new Map(visual.nodes.map((node, index) => [node.id, { x: columns === 2 ? 56 + index % columns * 368 : 14 + index % columns * 258, y: 32 + Math.floor(index / columns) * 226 }]));
  return <figure className="flex min-w-0 flex-col gap-2"><div className="overflow-x-auto rounded-md border border-border-token"><svg viewBox="0 0 760 420" role="img" aria-label={visual.caption} className="min-w-[520px] w-full bg-bg-subtle">
    <defs><marker id={`${id}-arrow`} markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6" fill="none" stroke="var(--accent)" strokeWidth="1.4" /></marker></defs>
    {visual.edges.map((edge, index) => {
      const from = positions.get(edge.from), to = positions.get(edge.to); if (!from || !to) return null;
      const sameRow = from.y === to.y, right = from.x < to.x;
      const startX = sameRow ? from.x + (right ? width : 0) : from.x + width / 2;
      const endX = sameRow ? to.x + (right ? 0 : width) : to.x + width / 2;
      const startY = sameRow ? from.y + height / 2 : from.y + (from.y < to.y ? height : 0);
      const endY = sameRow ? to.y + height / 2 : to.y + (from.y < to.y ? 0 : height);
      const middleY = sameRow ? from.y - 16 : (startY + endY) / 2;
      const adjacent = sameRow && Math.abs(from.x - to.x) < width + 100;
      const d = adjacent ? `M${startX},${startY} L${endX},${endY}` : `M${startX},${startY} L${startX},${middleY} L${endX},${middleY} L${endX},${endY}`;
      return <path key={index} d={d} fill="none" stroke="var(--accent)" strokeWidth="2" markerEnd={`url(#${id}-arrow)`} />;
    })}
    {visual.nodes.map(node => { const position = positions.get(node.id)!; const lines = node.label.match(/.{1,11}/gu) ?? [node.label]; return <g key={node.id}><rect x={position.x} y={position.y} width={width} height={height} rx="10" fill="var(--bg-elevated)" stroke="var(--border-strong)" /><text x={position.x + width / 2} y={position.y + height / 2 - (lines.length - 1) * 14} textAnchor="middle" fontSize="23" fontWeight="500" fill="var(--fg)">{lines.map((line, index) => <tspan key={index} x={position.x + width / 2} dy={index === 0 ? 0 : 28}>{line}</tspan>)}</text></g>; })}
  </svg></div>{visual.edges.some(edge => edge.label) && <ul className="space-y-1 text-[12px] leading-relaxed text-fg-muted">{visual.edges.filter(edge => edge.label).map((edge,index) => <li key={index}>{visual.nodes.find(node => node.id === edge.from)?.label} → {visual.nodes.find(node => node.id === edge.to)?.label} · {edge.label}</li>)}</ul>}<figcaption className="text-[12px] leading-relaxed text-fg-subtle">{visual.caption}</figcaption></figure>;
}
