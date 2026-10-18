import { readFile } from "node:fs/promises";
import { join } from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont } from "pdf-lib";
import { SeminarDraftSchema, type SeminarDraft, type SeminarSlide } from "./contract";

export interface DeckAsset { bytes: Uint8Array; mime: "image/png" | "image/jpeg"; width: number; height: number }
type Color = "paper" | "ink" | "muted" | "subtle" | "border" | "accent" | "soft" | "white";
interface Box { x: number; y: number; width: number; height: number }
interface TextItem extends Box { kind: "text"; lines: string[]; size: number; lineHeight: number; weight: "regular" | "semibold"; color: Color }
interface RectItem extends Box { kind: "rect"; fill: Color; stroke?: Color; radius: number }
interface PathItem extends Box { kind: "path"; points: { x: number; y: number }[]; color: Color; arrow: boolean }
interface ImageItem extends Box { kind: "image"; key: string }
export type SceneItem = TextItem | RectItem | PathItem | ImageItem;
export interface SlideScene { title: string; notes: string; width: 1280; height: 720; items: SceneItem[] }
const WIDTH = 1280, HEIGHT = 720;
// Print palette follows the app's warm paper/ink/accent tokens; shared by HTML and PDF.
const palette: Record<Color, string> = { paper: "#fbfaf7", ink: "#1a1814", muted: "#57534b", subtle: "#8a857a", border: "#d4cfc0", accent: "#6c5cff", soft: "#f3f1ec", white: "#ffffff" };
let fontFiles: Promise<{ regular: Buffer; semibold: Buffer; license: string }> | null = null;
const glyphSets = new WeakMap<PDFFont,Set<number>>();
async function fonts() {
  return fontFiles ??= Promise.all([readFile(join(process.cwd(), "public/fonts/Pretendard-Regular.ttf")), readFile(join(process.cwd(), "public/fonts/Pretendard-SemiBold.ttf")), readFile(join(process.cwd(), "public/fonts/Pretendard-LICENSE.txt"), "utf8")]).then(([regular, semibold, license]) => ({ regular, semibold, license }));
}
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
function color(key: Color) { const hex = palette[key].slice(1); return rgb(parseInt(hex.slice(0,2),16)/255, parseInt(hex.slice(2,4),16)/255, parseInt(hex.slice(4,6),16)/255); }
function wrap(text: string, width: number, font: PDFFont, size: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r/g, "").split("\n")) {
    if (!paragraph.trim()) { if (lines.length && lines.at(-1) !== "") lines.push(""); continue; }
    let line = "";
    for (const word of paragraph.trim().split(/\s+/u)) {
      const proposed = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(proposed, size) <= width) { line = proposed; continue; }
      if (line) lines.push(line);
      line = "";
      for (const char of Array.from(word)) {
        if (font.widthOfTextAtSize(line + char, size) > width && line) { lines.push(line); line = char; } else line += char;
      }
    }
    if (line) lines.push(line);
  }
  while (lines.at(-1) === "") lines.pop();
  return lines;
}
function sceneFor(slide: SeminarSlide, index: number, count: number, fontMap: Record<"regular" | "semibold", PDFFont>, assets: Map<string, DeckAsset>): SlideScene {
  const scene: SlideScene = { title: slide.title, notes: slide.speakerNotes ?? "", width: WIDTH, height: HEIGHT, items: [] };
  const rectangle = (box: Box, fill: Color, stroke?: Color, radius = 10) => scene.items.push({ ...box, kind: "rect", fill, stroke, radius });
  function text(value: string, box: Box, size = 28, weight: "regular" | "semibold" = "regular", ink: Color = "ink", lineHeight = size * 1.54) {
    let supported = glyphSets.get(fontMap[weight]);
    if (!supported) { supported = new Set(fontMap[weight].getCharacterSet()); glyphSets.set(fontMap[weight],supported); }
    const missing = Array.from(value).find(char => !/\s/u.test(char) && !supported.has(char.codePointAt(0)!));
    if (missing) throw new Error(`${index+1}번 슬라이드의 ‘${missing}’ 문자를 출력할 수 없어요. 한글이나 기본 수식 기호로 바꿔주세요.`);
    const lines = wrap(value, box.width, fontMap[weight], size);
    if (lines.length * lineHeight > box.height + .1) throw new Error(`${index+1}번 슬라이드의 ‘${value.slice(0,24)}’ 글이 길어요. 문장을 줄이거나 발표자 메모로 옮겨주세요.`);
    scene.items.push({ ...box, kind: "text", lines, size, lineHeight, weight, color: ink });
  }
  function path(points: { x: number; y: number }[], arrow = true) {
    const xs = points.map(point => point.x), ys = points.map(point => point.y);
    const x = Math.min(...xs)-8, y = Math.min(...ys)-8;
    scene.items.push({ kind: "path", points, x, y, width: Math.max(...xs)-x+8, height: Math.max(...ys)-y+8, color: "accent", arrow });
  }
  rectangle({ x: 0, y: 0, width: WIDTH, height: HEIGHT }, "paper", undefined, 0);
  text(index === 0 ? "논문으로 함께 생각하기" : index === count-1 ? "토론과 다음 질문" : "연구 세미나", { x: 52, y: 30, width: 1000, height: 28 }, 18, "semibold", "accent", 26);
  text(slide.title, { x: 52, y: 80, width: 1176, height: 112 }, 42, "semibold", "ink", 53);
  const box = { x: 570, y: 218, width: 658, height: 392 };
  const body = slide.subtitle ? `${slide.subtitle}\n\n${slide.body}` : slide.body;
  text(body, { x: 52, y: 220, width: slide.visual ? 458 : 1176, height: 402 }, 28, "regular", "muted", 43);
  if (slide.visual) {
    const visual = slide.visual;
    rectangle(box, "white", "border");
    if (visual.kind === "figure" || visual.kind === "page") {
      const key = visual.kind === "figure" ? `figure:${visual.figureId}` : `page:${visual.page}`;
      const asset = assets.get(key); if (!asset || asset.width <= 0 || asset.height <= 0) throw new Error(`${index+1}번 슬라이드의 원문 그림 자산이 준비되지 않았어요.`);
      const scale = Math.min((box.width-24)/asset.width,(box.height-24)/asset.height);
      const width = asset.width*scale, height = asset.height*scale;
      scene.items.push({ kind: "image", key, x: box.x+(box.width-width)/2, y: box.y+(box.height-height)/2, width, height });
    } else if (visual.kind === "diagram") {
      const columns = visual.nodes.length <= 4 ? 2 : 3, rows = Math.ceil(visual.nodes.length/columns);
      const gap = columns === 2 ? 58 : 32, nodeW = (box.width-48-gap*(columns-1))/columns, nodeH = rows === 1 ? 134 : 112;
      const rowGap = rows === 1 ? 0 : 92;
      const originY = box.y+(box.height-(rows*nodeH+(rows-1)*rowGap))/2;
      const nodes = new Map(visual.nodes.map((node, position) => [node.id, { x: box.x+24+(position%columns)*(nodeW+gap), y: originY+Math.floor(position/columns)*(nodeH+rowGap), width: nodeW, height: nodeH, node }]));
      if (nodes.size !== visual.nodes.length || visual.edges.some(edge => !nodes.has(edge.from) || !nodes.has(edge.to) || edge.from === edge.to)) throw new Error(`${index+1}번 슬라이드 도식의 연결을 확인해주세요.`);
      const labels: { value: string; points: { x: number; y: number }[] }[] = [];
      for (const edge of visual.edges) {
        const from = nodes.get(edge.from)!, to = nodes.get(edge.to)!;
        const horizontal = from.y === to.y, forward = from.x < to.x;
        const start = { x: horizontal ? from.x+(forward ? nodeW : 0) : from.x+nodeW/2, y: horizontal ? from.y+nodeH/2 : from.y+(from.y < to.y ? nodeH : 0) };
        const end = { x: horizontal ? to.x+(forward ? 0 : nodeW) : to.x+nodeW/2, y: horizontal ? to.y+nodeH/2 : to.y+(from.y < to.y ? 0 : nodeH) };
        const adjacent = horizontal && Math.abs(from.x-to.x) <= nodeW+gap+1;
        const middleY = horizontal ? from.y-18 : (start.y+end.y)/2;
        const points = adjacent ? [start,end] : [start,{ x: start.x, y: middleY },{ x: end.x, y: middleY },end];
        path(points);
        if (edge.label) labels.push({ value: edge.label, points });
      }
      const labelBoxes: Box[] = [];
      const overlaps = (a: Box,b: Box) => a.x < b.x+b.width+5 && a.x+a.width+5 > b.x && a.y < b.y+b.height+5 && a.y+a.height+5 > b.y;
      for (const label of labels) {
        const width = Math.min(220,fontMap.regular.widthOfTextAtSize(label.value,17)+14), height = wrap(label.value,width-12,fontMap.regular,17).length*22+6;
        const segments = label.points.slice(1).map((end,n) => ({ start: label.points[n],end })).sort((a,b) => Math.hypot(b.end.x-b.start.x,b.end.y-b.start.y)-Math.hypot(a.end.x-a.start.x,a.end.y-a.start.y));
        const candidates = segments.flatMap(({ start,end }) => [.5,.25,.75].flatMap(fraction => {
          const x = start.x+(end.x-start.x)*fraction, y = start.y+(end.y-start.y)*fraction;
          return start.y === end.y ? [6,nodeH/2+8,nodeH/2+14].flatMap(offset => [{ x: x-width/2,y: y-height-offset,width,height },{ x: x-width/2,y: y+offset,width,height }]) : [{ x: x+8,y: y-height/2,width,height },{ x: x-width-8,y: y-height/2,width,height }];
        }));
        const frame = candidates.find(candidate => candidate.x >= box.x+2 && candidate.y >= box.y+2 && candidate.x+candidate.width <= box.x+box.width-2 && candidate.y+candidate.height <= box.y+box.height-2 && ![...nodes.values(),...labelBoxes].some(other => overlaps(candidate,other)));
        if (!frame) throw new Error(`${index+1}번 슬라이드의 ‘${label.value}’ 도식 설명이 겹쳐요. 연결을 줄이거나 설명을 짧게 다듬어주세요.`);
        labelBoxes.push(frame); rectangle(frame,"white",undefined,3);
        text(label.value,{ x: frame.x+6,y: frame.y+2,width: frame.width-12,height: frame.height-4 },17,"regular","muted",22);
      }
      for (const node of nodes.values()) {
        rectangle(node, "soft", "border");
        const labelSize = columns === 3 ? 22 : 24, lines = wrap(node.node.label,nodeW-28,fontMap.semibold,labelSize);
        const labelH = lines.length*31;
        text(node.node.label, { x: node.x+14, y: node.y+(nodeH-labelH)/2, width: nodeW-28, height: nodeH-16 }, labelSize, "semibold", "ink", 31);
      }
    } else {
      if (visual.rows.some(row => row.length !== visual.columns.length)) throw new Error(`${index+1}번 슬라이드 표의 열 수가 맞지 않아요.`);
      const rowHeight = (box.height-24)/(visual.rows.length+1), cellW = (box.width-24)/visual.columns.length;
      for (const [rowIndex, row] of [visual.columns,...visual.rows].entries()) {
        for (const [column, value] of row.entries()) {
          const frame = { x: box.x+12+column*cellW, y: box.y+12+rowIndex*rowHeight, width: cellW, height: rowHeight };
          rectangle(frame, rowIndex === 0 ? "soft" : "white", "border", 0);
          text(value, { x: frame.x+10, y: frame.y+10, width: frame.width-20, height: frame.height-18 }, rowIndex === 0 ? 20 : 24, rowIndex === 0 ? "semibold" : "regular", "ink", 30);
        }
      }
    }
    text(visual.caption, { x: box.x, y: 621, width: box.width, height: 38 }, 17, "regular", "subtle", 22);
  }
  const pages = [...new Set((slide.citations ?? []).map(citation => citation.page))];
  text(pages.length ? `원문 p.${pages.join(", ")} · 근거와 해석을 구분해 검토해주세요` : "연구 세미나", { x: 52, y: 673, width: 1050, height: 25 }, 15, "regular", "subtle", 22);
  text(`${String(index+1).padStart(2,"0")} / ${String(count).padStart(2,"0")}`, { x: 1140, y: 673, width: 88, height: 25 }, 16, "regular", "subtle", 22);
  for (const item of scene.items) if (![item.x,item.y,item.width,item.height].every(Number.isFinite) || item.x < 0 || item.y < 0 || item.x+item.width > WIDTH+.1 || item.y+item.height > HEIGHT+.1) throw new Error(`${index+1}번 슬라이드의 요소가 화면을 벗어났어요.`);
  return scene;
}
function svgItem(item: SceneItem, assets: Map<string,DeckAsset>, markerId: string): string {
  if (item.kind === "rect") return `<rect x="${item.x}" y="${item.y}" width="${item.width}" height="${item.height}" rx="${item.radius}" fill="${palette[item.fill]}"${item.stroke ? ` stroke="${palette[item.stroke]}"` : ""}/>`;
  if (item.kind === "text") return `<g fill="${palette[item.color]}" font-size="${item.size}" font-weight="${item.weight === "semibold" ? 600 : 400}">${item.lines.map((line,index) => `<text x="${item.x}" y="${item.y+item.size+index*item.lineHeight}" xml:space="preserve">${escape(line)}</text>`).join("")}</g>`;
  if (item.kind === "image") { const asset = assets.get(item.key)!; return `<image x="${item.x}" y="${item.y}" width="${item.width}" height="${item.height}" href="data:${asset.mime};base64,${Buffer.from(asset.bytes).toString("base64")}" preserveAspectRatio="xMidYMid meet"/>`; }
  return `<path d="${item.points.map((point,index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ")}" fill="none" stroke="${palette[item.color]}" stroke-width="2"${item.arrow ? ` marker-end="url(#${markerId})"` : ""}/>`;
}
export async function renderSeminarDeck(candidate: SeminarDraft, assets: Map<string,DeckAsset>) {
  const deck = SeminarDraftSchema.parse(candidate), files = await fonts();
  const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit);
  const regular = await pdf.embedFont(files.regular,{ subset: false }), semibold = await pdf.embedFont(files.semibold,{ subset: false });
  const fontMap = { regular, semibold };
  const scenes = deck.slides.map((slide,index) => sceneFor(slide,index,deck.slides.length,fontMap,assets));
  pdf.setTitle(deck.title); pdf.setAuthor("하박조팽"); pdf.setSubject(deck.summary.slice(0,300));
  const embedded = new Map<string,Awaited<ReturnType<typeof pdf.embedPng>>>();
  for (const scene of scenes) {
    const page = pdf.addPage([WIDTH,HEIGHT]);
    for (const item of scene.items) {
      if (item.kind === "rect") page.drawRectangle({ x: item.x, y: HEIGHT-item.y-item.height, width: item.width, height: item.height, color: color(item.fill), ...(item.stroke ? { borderColor: color(item.stroke), borderWidth: 1 } : {}) });
      else if (item.kind === "text") item.lines.forEach((line,index) => { if (line) page.drawText(line,{ x: item.x, y: HEIGHT-item.y-item.size-index*item.lineHeight, size: item.size, font: fontMap[item.weight], color: color(item.color) }); });
      else if (item.kind === "image") {
        let image = embedded.get(item.key); const asset = assets.get(item.key)!;
        if (!image) { image = await (asset.mime === "image/png" ? pdf.embedPng(asset.bytes) : pdf.embedJpg(asset.bytes)); embedded.set(item.key,image); }
        page.drawImage(image,{ x: item.x, y: HEIGHT-item.y-item.height, width: item.width, height: item.height });
      } else {
        for (let index = 1; index < item.points.length; index++) { const from = item.points[index-1], to = item.points[index]; page.drawLine({ start: { x: from.x, y: HEIGHT-from.y }, end: { x: to.x, y: HEIGHT-to.y }, thickness: 2, color: color(item.color) }); }
        if (item.arrow) { const end = item.points.at(-1)!, from = item.points.at(-2)!, angle = Math.atan2(end.y-from.y,end.x-from.x); for (const offset of [-.5,.5]) page.drawLine({ start: { x: end.x, y: HEIGHT-end.y }, end: { x: end.x-9*Math.cos(angle+offset), y: HEIGHT-end.y+9*Math.sin(angle+offset) }, color: color(item.color), thickness: 2 }); }
      }
    }
  }
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escape(deck.title)}</title><style>@font-face{font-family:Deck;src:url(data:font/ttf;base64,${files.regular.toString("base64")}) format('truetype');font-weight:400}@font-face{font-family:Deck;src:url(data:font/ttf;base64,${files.semibold.toString("base64")}) format('truetype');font-weight:600}*{box-sizing:border-box}body{margin:0;background:${palette.paper};color:${palette.ink};font-family:Deck,sans-serif}.deck{width:min(1280px,100vw);margin:auto}section[hidden]{display:none}svg.scene{display:block;width:100%;height:auto;font-family:Deck,sans-serif}nav{display:flex;gap:12px;justify-content:center;align-items:center;padding:16px}button{font:inherit;background:white;border:1px solid ${palette.border};border-radius:6px;padding:8px 15px;cursor:pointer}button:disabled{opacity:.35}details{max-width:1100px;margin:16px auto;padding:12px;font-size:14px;white-space:pre-wrap;line-height:1.6}.license{font-size:11px;color:${palette.muted}}@page{size:1280px 720px;margin:0}@media print{nav,details{display:none!important}.deck{width:1280px}section[hidden]{display:block!important}section{break-after:page;height:720px;overflow:hidden}}</style></head><body><main class="deck">${scenes.map((scene,index) => `<section data-slide="${index}"${index ? " hidden" : ""}><svg class="scene" viewBox="0 0 1280 720" role="img" aria-label="${escape(scene.title)}"><defs><marker id="arrow-${index}" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6" fill="none" stroke="${palette.accent}" stroke-width="1.5"/></marker></defs>${scene.items.map(item => svgItem(item,assets,`arrow-${index}`)).join("")}</svg><details><summary>발표자 메모</summary>${escape(scene.notes)}</details></section>`).join("")}</main><nav aria-label="슬라이드 이동"><button id="prev">이전</button><span id="position"></span><button id="next">다음</button><button id="fullscreen">전체 화면</button></nav><details class="license"><summary>출처와 폰트 라이선스</summary>${escape(deck.citations.map(citation => `원문 p.${citation.page} · ${citation.quote}`).join("\n\n"))}\n\n${escape(files.license)}</details><script>(()=>{const slides=[...document.querySelectorAll('[data-slide]')];let index=0;const prev=document.getElementById('prev'),next=document.getElementById('next');function show(value){index=Math.max(0,Math.min(slides.length-1,value));slides.forEach((slide,n)=>slide.hidden=n!==index);document.getElementById('position').textContent=(index+1)+' / '+slides.length;prev.disabled=index===0;next.disabled=index===slides.length-1;history.replaceState(null,'','#'+(index+1))}prev.addEventListener('click',()=>show(index-1));next.addEventListener('click',()=>show(index+1));document.getElementById('fullscreen').addEventListener('click',()=>document.documentElement.requestFullscreen?.());document.addEventListener('keydown',event=>{if(['ArrowRight','ArrowLeft',' '].includes(event.key)){event.preventDefault();show(index+(event.key==='ArrowLeft'?-1:1))}});show(Math.max(0,(parseInt(location.hash.slice(1),10)||1)-1))})();</script></body></html>`;
  return { pdf: await pdf.save(), html, scenes, qa: { slideCount: scenes.length, aspectRatio: "16:9", embeddedFonts: ["Pretendard-Regular", "Pretendard-SemiBold"], issues: [] as string[] } };
}
