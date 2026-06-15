// 라이브 룸 데이터 채널 프로토콜 — 순수 함수, 외부 의존성 없음(ADR-019).
// 채팅·반응·손들기는 별도 서버 없이 LiveKit 데이터 채널로 룸 내부에서 주고받는다(휘발·미저장).
// CRITICAL: 작성자(누가 보냈는지)는 페이로드에 넣지 않는다 — 수신 측이 LiveKit 참가자 identity로
//   판별한다(R3 정신: 페이로드의 author 미신뢰).

export type LiveMessage =
  | { kind: "chat"; text: string; at: number }
  | { kind: "reaction"; emoji: string; at: number }
  | { kind: "hand"; up: boolean; at: number };

const MAX_CHAT_LEN = 500;

/** LiveMessage → LiveKit publishData용 바이트(JSON + TextEncoder). chat은 길이 clamp. */
export function encodeLiveMessage(m: LiveMessage): Uint8Array {
  const out: LiveMessage =
    m.kind === "chat" ? { ...m, text: m.text.slice(0, MAX_CHAT_LEN) } : m;
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
    default:
      return null;
  }
}
