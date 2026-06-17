import { describe, expect, it } from "vitest";
import {
  decodeLiveMessage,
  encodeLiveMessage,
  type LiveMessage,
} from "@/lib/live-messages";

// lib/live-messages.ts 단위 테스트 — 데이터 채널 프로토콜(순수 함수).
// 작성자(누가)는 페이로드에 없다 — 수신 측이 LiveKit identity로 판별(R3 정신).

describe("encode/decode 왕복", () => {
  it("chat", () => {
    const m: LiveMessage = { kind: "chat", text: "안녕하세요", at: 1000 };
    expect(decodeLiveMessage(encodeLiveMessage(m))).toEqual(m);
  });

  it("reaction", () => {
    const m: LiveMessage = { kind: "reaction", emoji: "👏", at: 2000 };
    expect(decodeLiveMessage(encodeLiveMessage(m))).toEqual(m);
  });

  it("hand", () => {
    const m: LiveMessage = { kind: "hand", up: true, at: 3000 };
    expect(decodeLiveMessage(encodeLiveMessage(m))).toEqual(m);
  });

  it("annot (펜 스트로크)", () => {
    const m: LiveMessage = {
      kind: "annot",
      tool: "pen",
      color: "var(--busy)",
      points: [
        [0.1, 0.2],
        [0.3, 0.4],
      ],
      at: 4000,
    };
    expect(decodeLiveMessage(encodeLiveMessage(m))).toEqual(m);
  });

  it("annot (레이저 한 점)", () => {
    const m: LiveMessage = {
      kind: "annot",
      tool: "laser",
      color: "var(--online)",
      points: [[0.5, 0.5]],
      at: 5000,
    };
    expect(decodeLiveMessage(encodeLiveMessage(m))).toEqual(m);
  });

  it("present (발표자료 공유 중)", () => {
    const m: LiveMessage = {
      kind: "present",
      presentationId: "pres-1",
      page: 3,
      pageCount: 10,
      at: 6000,
    };
    expect(decodeLiveMessage(encodeLiveMessage(m))).toEqual(m);
  });

  it("present (공유 중지 — presentationId null)", () => {
    const m: LiveMessage = {
      kind: "present",
      presentationId: null,
      page: 1,
      pageCount: 1,
      at: 7000,
    };
    expect(decodeLiveMessage(encodeLiveMessage(m))).toEqual(m);
  });
});

describe("present 검증", () => {
  const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));

  it("page는 [1, pageCount]로 clamp된다", () => {
    expect(
      decodeLiveMessage(
        enc({ kind: "present", presentationId: "p", page: 0, pageCount: 5, at: 1 }),
      ),
    ).toMatchObject({ kind: "present", page: 1 });
    expect(
      decodeLiveMessage(
        enc({ kind: "present", presentationId: "p", page: 99, pageCount: 5, at: 1 }),
      ),
    ).toMatchObject({ kind: "present", page: 5 });
  });

  it("pageCount는 최소 1로 clamp되고 소수는 내림한다", () => {
    expect(
      decodeLiveMessage(
        enc({ kind: "present", presentationId: "p", page: 1, pageCount: 0, at: 1 }),
      ),
    ).toMatchObject({ kind: "present", pageCount: 1, page: 1 });
    expect(
      decodeLiveMessage(
        enc({ kind: "present", presentationId: "p", page: 2.7, pageCount: 9.9, at: 1 }),
      ),
    ).toMatchObject({ kind: "present", page: 2, pageCount: 9 });
  });

  it("page/pageCount가 숫자가 아니면 null", () => {
    expect(
      decodeLiveMessage(
        enc({ kind: "present", presentationId: "p", page: "3", pageCount: 5, at: 1 }),
      ),
    ).toBeNull();
    expect(
      decodeLiveMessage(
        enc({ kind: "present", presentationId: "p", page: 3, pageCount: null, at: 1 }),
      ),
    ).toBeNull();
  });

  it("presentationId가 문자열도 null도 아니면 null", () => {
    expect(
      decodeLiveMessage(
        enc({ kind: "present", presentationId: 42, page: 1, pageCount: 1, at: 1 }),
      ),
    ).toBeNull();
  });
});

describe("chat 길이 clamp", () => {
  it("500자를 넘으면 잘라낸다", () => {
    const long = "가".repeat(600);
    const decoded = decodeLiveMessage(
      encodeLiveMessage({ kind: "chat", text: long, at: 1 }),
    );
    expect(decoded?.kind).toBe("chat");
    if (decoded?.kind === "chat") {
      expect(decoded.text.length).toBe(500);
    }
  });

  it("빈 문자열 chat은 무시한다(null)", () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({ kind: "chat", text: "", at: 1 }),
    );
    expect(decodeLiveMessage(bytes)).toBeNull();
  });
});

describe("방어적 디코드", () => {
  it("알 수 없는 kind는 null", () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({ kind: "explode", at: 1 }),
    );
    expect(decodeLiveMessage(bytes)).toBeNull();
  });

  it("깨진 JSON 바이트는 null", () => {
    const bytes = new TextEncoder().encode("{not json");
    expect(decodeLiveMessage(bytes)).toBeNull();
  });

  it("비-객체(JSON 배열/원시값)는 null", () => {
    expect(decodeLiveMessage(new TextEncoder().encode("42"))).toBeNull();
    expect(decodeLiveMessage(new TextEncoder().encode("null"))).toBeNull();
    expect(decodeLiveMessage(new TextEncoder().encode("[1,2]"))).toBeNull();
  });

  it("필드 타입 위반은 null", () => {
    const badHand = new TextEncoder().encode(
      JSON.stringify({ kind: "hand", up: "yes", at: 1 }),
    );
    expect(decodeLiveMessage(badHand)).toBeNull();
    const badReaction = new TextEncoder().encode(
      JSON.stringify({ kind: "reaction", emoji: "", at: 1 }),
    );
    expect(decodeLiveMessage(badReaction)).toBeNull();
  });
});

describe("annot 검증", () => {
  const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));

  it("좌표는 0..1로 clamp된다", () => {
    const decoded = decodeLiveMessage(
      encodeLiveMessage({
        kind: "annot",
        tool: "pen",
        color: "var(--accent)",
        points: [[-0.5, 1.5]],
        at: 1,
      }),
    );
    expect(decoded).toMatchObject({ kind: "annot", points: [[0, 1]] });
  });

  it("잘못된 tool·빈 색·빈 점·비-숫자 좌표는 null", () => {
    expect(
      decodeLiveMessage(enc({ kind: "annot", tool: "spray", color: "x", points: [[0, 0]], at: 1 })),
    ).toBeNull();
    expect(
      decodeLiveMessage(enc({ kind: "annot", tool: "pen", color: "", points: [[0, 0]], at: 1 })),
    ).toBeNull();
    expect(
      decodeLiveMessage(enc({ kind: "annot", tool: "pen", color: "x", points: [], at: 1 })),
    ).toBeNull();
    expect(
      decodeLiveMessage(enc({ kind: "annot", tool: "pen", color: "x", points: [["a", 0]], at: 1 })),
    ).toBeNull();
  });

  it("점 수는 256으로 제한된다", () => {
    const many: [number, number][] = Array.from({ length: 400 }, () => [0.5, 0.5]);
    const decoded = decodeLiveMessage(
      encodeLiveMessage({ kind: "annot", tool: "pen", color: "var(--busy)", points: many, at: 1 }),
    );
    expect(decoded?.kind).toBe("annot");
    if (decoded?.kind === "annot") expect(decoded.points.length).toBe(256);
  });
});
