import * as React from "react";

/** A small text-only Markdown renderer: no HTML, images, executable links or remote embeds. */
function inline(text: string): React.ReactNode {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, index) => part.startsWith("**") && part.endsWith("**")
    ? <strong key={index} className="font-semibold">{part.slice(2, -2)}</strong>
    : part.startsWith("`") && part.endsWith("`") ? <code key={index} className="rounded-xs bg-bg-subtle px-1 font-mono text-[12px]">{part.slice(1, -1)}</code> : part);
}
const cells = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
const tableDivider = (line = "") => line.includes("|") && cells(line).every((cell) => /^:?-{3,}:?$/.test(cell));
const listLine = (line: string) => /^\s*(?:[-*+] |\d+\. )/.test(line);

export function ResponseContent({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: React.ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }
    const key = index;
    if (/^\s*```/.test(line)) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```/.test(lines[index])) code.push(lines[index++]);
      index += 1;
      blocks.push(<pre key={key} className="max-w-full overflow-x-auto rounded-md border border-border-token bg-bg-subtle p-3 text-[12px] leading-6"><code className="font-mono">{code.join("\n")}</code></pre>);
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const Tag = `h${Math.min(heading[1].length + 2, 6)}` as "h3" | "h4" | "h5" | "h6";
      blocks.push(<Tag key={key} className="text-[15px] font-semibold text-fg">{inline(heading[2])}</Tag>); index += 1; continue;
    }
    if (line.includes("|") && tableDivider(lines[index + 1])) {
      const headers = cells(line), rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) rows.push(cells(lines[index++]));
      blocks.push(<div key={key} className="max-w-full overflow-x-auto rounded-md border border-border-token"><table className="w-full border-collapse text-left text-[12px]"><thead className="bg-bg-subtle"><tr>{headers.map((header, cell) => <th key={cell} scope="col" className="min-w-28 border-b border-border-token px-3 py-2 font-medium">{inline(header)}</th>)}</tr></thead><tbody>{rows.map((row, item) => <tr key={item}>{headers.map((_, cell) => <td key={cell} className="border-b border-border-token px-3 py-2 align-top last:border-b-0">{inline(row[cell] ?? "")}</td>)}</tr>)}</tbody></table></div>);
      continue;
    }
    if (listLine(line)) {
      const ordered = /^\s*\d+\./.test(line), items: string[] = [];
      while (index < lines.length && listLine(lines[index]) && /^\s*\d+\./.test(lines[index]) === ordered) items.push(lines[index++].replace(/^\s*(?:[-*+] |\d+\. )/, ""));
      const Tag = ordered ? "ol" : "ul";
      blocks.push(<Tag key={key} className={`flex flex-col gap-1 pl-5 ${ordered ? "list-decimal" : "list-disc"}`}>{items.map((item, itemIndex) => <li key={itemIndex}>{inline(item)}</li>)}</Tag>);
      continue;
    }
    const paragraph = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !/^\s*```|^#{1,6}\s/.test(lines[index]) && !listLine(lines[index]) && !tableDivider(lines[index + 1])) paragraph.push(lines[index++]);
    blocks.push(<p key={key} className="whitespace-pre-wrap">{inline(paragraph.join("\n"))}</p>);
  }
  return <div className="flex min-w-0 flex-col gap-3 break-words text-[14px] leading-7 text-fg">{blocks}</div>;
}
