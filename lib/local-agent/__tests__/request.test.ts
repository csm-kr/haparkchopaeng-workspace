// @vitest-environment node
import { describe, expect, it } from "vitest";
import { assertWebOrigin, desktopIdentity, parseJson } from "../request";
import { EmptySchema } from "../validation";

describe("connector HTTP trust boundary", () => {
  it("blocks cross-origin and absent-origin mutation requests", () => {
    expect(() => assertWebOrigin(new Request("https://research.test/api/local-agent/attempts", { method: "POST", headers: { origin: "https://attacker.test" } }))).toThrow();
    expect(() => assertWebOrigin(new Request("https://research.test/api/local-agent/attempts", { method: "POST" }))).toThrow();
    expect(() => assertWebOrigin(new Request("https://research.test/api/local-agent/attempts", { method: "POST", headers: { origin: "https://research.test" } }))).not.toThrow();
  });
  it("requires both the device identity and a 256-bit bearer credential", () => {
    expect(() => desktopIdentity(new Request("http://localhost", { headers: { authorization: "Bearer 482107", "x-local-agent-device": "device" } }))).toThrow();
    expect(() => desktopIdentity(new Request("http://localhost", { headers: { authorization: `Bearer ${Buffer.alloc(32, 7).toString("base64url")}` } }))).toThrow();
  });
  it("requires JSON and bounds actual request bytes even with no content-length header", async () => {
    await expect(parseJson(new Request("http://localhost", { method: "POST", body: "{}" }), EmptySchema)).rejects.toMatchObject({ status: 415 });
    await expect(parseJson(new Request("http://localhost", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ value: "x".repeat(300_000) }) }), EmptySchema)).rejects.toMatchObject({ status: 413 });
  });
});
