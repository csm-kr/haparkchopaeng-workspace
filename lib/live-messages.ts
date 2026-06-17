// 라이브 룸 데이터 채널 프로토콜 — 순수 함수, 외부 의존성 없음(ADR-019).
// 채팅·반응·손들기는 별도 서버 없이 LiveKit 데이터 채널로 룸 내부에서 주고받는다(휘발·미저장).
// CRITICAL: 작성자(누가 보냈는지)는 페이로드에 넣지 않는다 — 수신 측이 LiveKit 참가자 identity로
//   판별한다(R3 정신: 페이로드의 author 미신뢰).

export type LiveMessage =
  | { kind: "chat"; text: string; at: number }
  | { kind: "reaction"; emoji: string; at: number }
  | { kind: "hand"; up: boolean; at: number }
  | {
      kind: "annot";
      tool: "pen" | "laser";
      color: string;
      /** 영상 박스 기준 정규화 좌표(0..1). 펜=스트로크, 레이저=한 점. */
      points: [number, number][];
      at: number;
    }
  | {
      kind: "present";
      /** 공유 중인 발표자료 id. null이면 공유 중지. */
      presentationId: string | null;
      /** 현재 페이지(1-based). */
      page: number;
      /** 총 페이지 수(>=1). */
      pageCount: number;
      at: number;
    };

const MAX_CHAT_LEN = 500;
const MAX_ANNOT_POINTS = 256; // 메시지 크기 상한(스트로크 점 수)
const MAX_COLOR_LEN = 32;
const MAX_ID_LEN = 64; // presentationId 길이 상한(cuid ~25)
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** present 페이지 정규화: pageCount>=1, page는 [1, pageCount]로 clamp(소수 내림). */
function normalizePresentPages(
  page: number,
  pageCount: number,
): { page: number; pageCount: number } {
  const pc = Math.max(1, Math.floor(pageCount));
  const p = Math.min(Math.max(1, Math.floor(page)), pc);
  return { page: p, pageCount: pc };
}

/** LiveMessage → LiveKit publishData용 바이트(JSON + TextEncoder). chat은 길이 clamp. */
export function encodeLiveMessage(m: LiveMessage): Uint8Array {
  let out: LiveMessage = m;
  if (m.kind === "chat") {
    out = { ...m, text: m.text.slice(0, MAX_CHAT_LEN) };
  } else if (m.kind === "annot") {
    out = {
      ...m,
      color: m.color.slice(0, MAX_COLOR_LEN),
      points: m.points
        .slice(0, MAX_ANNOT_POINTS)
        .map(([x, y]) => [clamp01(x), clamp01(y)] as [number, number]),
    };
  } else if (m.kind === "present") {
    out = {
      ...m,
      presentationId:
        m.presentationId === null ? null : m.presentationId.slice(0, MAX_ID_LEN),
      ...normalizePresentPages(m.page, m.pageCount),
    };
  }
  return new TextEncoder().encode(JSON.stringify(out));
}

/** 바이트 → LiveMessage. 형식 위반/미지 kind/깨진 JSON은 null(방어적, throw 금지). */
export function decodeLiveMessage(bytes: Uint8Array): LiveMessage | null {
  let obj: unknown;
  try {
    obj = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return null;

  const rec = obj as Record<string, unknown>;
  if (typeof rec.at !== "number") return null;
  const at = rec.at;

  switch (rec.kind) {
    case "chat": {
      if (typeof rec.text !== "string") return null;
      const text = rec.text.slice(0, MAX_CHAT_LEN);
      if (text.length === 0) return null; // 빈 문자열은 무시
      return { kind: "chat", text, at };
    }
    case "reaction": {
      if (typeof rec.emoji !== "string" || rec.emoji.length === 0) return null;
      return { kind: "reaction", emoji: rec.emoji, at };
    }
    case "hand": {
      if (typeof rec.up !== "boolean") return null;
      return { kind: "hand", up: rec.up, at };
    }
    case "annot": {
      if (rec.tool !== "pen" && rec.tool !== "laser") return null;
      if (typeof rec.color !== "string" || rec.color.length === 0) return null;
      if (!Array.isArray(rec.points) || rec.points.length === 0) return null;
      const points: [number, number][] = [];
      for (const p of rec.points) {
        if (!Array.isArray(p) || p.length !== 2) return null;
        const [x, y] = p as unknown[];
        if (typeof x !== "number" || typeof y !== "number") return null;
        if (Number.isNaN(x) || Number.isNaN(y)) return null;
        points.push([clamp01(x), clamp01(y)]);
        if (points.length >= MAX_ANNOT_POINTS) break;
      }
      if (points.length === 0) return null;
      return { kind: "annot", tool: rec.tool, color: rec.color.slice(0, MAX_COLOR_LEN), points, at };
    }
    case "present": {
      // presentationId는 문자열(공유) 또는 null(중지)만. 그 외 타입은 거부(방어적).
      if (typeof rec.presentationId !== "string" && rec.presentationId !== null) {
        return null;
      }
      if (typeof rec.page !== "number" || Number.isNaN(rec.page)) return null;
      if (typeof rec.pageCount !== "number" || Number.isNaN(rec.pageCount)) return null;
      const presentationId =
        rec.presentationId === null ? null : rec.presentationId.slice(0, MAX_ID_LEN);
      const { page, pageCount } = normalizePresentPages(rec.page, rec.pageCount);
      return { kind: "present", presentationId, page, pageCount, at };
    }
    default:
      return null;
  }
}
