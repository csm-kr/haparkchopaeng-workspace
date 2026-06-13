import { afterEach, describe, expect, it, vi } from "vitest";
import { signPayload, verifyPayload } from "@/lib/sign";

const SECRET = "test-secret";

describe("signPayload / verifyPayload", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("round-trips a payload (sign → verify)", () => {
    const token = signPayload({ memberId: "ha", role: "관리자" }, SECRET);
    expect(verifyPayload<{ memberId: string; role: string }>(token, SECRET)).toMatchObject({
      memberId: "ha",
      role: "관리자",
    });
  });

  it("rejects a token signed with a different secret (forged)", () => {
    const token = signPayload({ memberId: "ha" }, SECRET);
    expect(verifyPayload(token, "other-secret")).toBeNull();
  });

  it("rejects a tampered payload", () => {
    const token = signPayload({ memberId: "ha" }, SECRET);
    const [, sig] = token.split(".");
    const forged = `${Buffer.from(JSON.stringify({ memberId: "evil" })).toString("base64url")}.${sig}`;
    expect(verifyPayload(forged, SECRET)).toBeNull();
  });

  it("rejects a malformed token", () => {
    expect(verifyPayload("not-a-token", SECRET)).toBeNull();
    expect(verifyPayload("a.b.c", SECRET)).toBeNull();
  });

  it("rejects an expired token", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-13T00:00:00Z"));
    const token = signPayload({ memberId: "ha" }, SECRET, { expiresInSec: 60 });
    vi.setSystemTime(new Date("2026-06-13T00:02:00Z")); // +2분 > 60초
    expect(verifyPayload(token, SECRET)).toBeNull();
  });

  it("accepts a not-yet-expired token", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-13T00:00:00Z"));
    const token = signPayload({ memberId: "ha" }, SECRET, { expiresInSec: 3600 });
    vi.setSystemTime(new Date("2026-06-13T00:30:00Z")); // +30분 < 1시간
    expect(verifyPayload<{ memberId: string }>(token, SECRET)).toMatchObject({ memberId: "ha" });
  });
});
