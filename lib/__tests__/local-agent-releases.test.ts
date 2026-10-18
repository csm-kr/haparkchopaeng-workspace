// @vitest-environment node
import { describe, expect, it, vi, afterEach } from "vitest";
import { readLocalAgentReleases } from "../local-agent-releases";

vi.mock("@/lib/local-agent/request", () => ({
  webScope: vi.fn().mockResolvedValue({ memberId: "member", teamId: "team" }),
  response: async (action: () => Promise<unknown>) => {
    try { return Response.json({ data: await action() }, { headers: { "Cache-Control": "no-store" } }); }
    catch { return Response.json({ error: { message: "AI 브릿지 다운로드 설정을 확인해주세요." } }, { status: 503 }); }
  },
}));

describe("published connector releases", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("has no pretend installers when release configuration is absent", () => {
    expect(readLocalAgentReleases(undefined)).toEqual([]);
    expect(readLocalAgentReleases("")).toEqual([]);
  });
  it("exposes only explicitly configured supported releases", () => {
    expect(readLocalAgentReleases(JSON.stringify([
      { platform: "windows", url: "https://releases.example.com/Connector.exe", version: "0.1.0", architecture: "x64" },
      { platform: "macos", url: "/downloads/Connector.dmg", version: "0.1.0", architecture: "universal" },
    ]))).toHaveLength(2);
  });
  it("serializes an explicitly unsigned preview release in the download response", async () => {
    const { GET } = await import("@/app/api/local-agent/downloads/route");
    vi.stubEnv("LOCAL_AGENT_RELEASES", JSON.stringify([
      { platform: "windows", url: "/downloads/Connector-preview.exe", version: "0.1.0", architecture: "x64", unsigned: true },
    ]));
    const res = await GET(new Request("http://localhost/api/local-agent/downloads"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { releases: [
      { platform: "windows", url: "/downloads/Connector-preview.exe", version: "0.1.0", architecture: "x64", unsigned: true },
    ] } });
  });
  it("keeps an explicit false flag without adding a default for existing releases", () => {
    const releases = readLocalAgentReleases(JSON.stringify([
      { platform: "windows", url: "/downloads/Connector.exe", version: "0.1.0", unsigned: false },
      { platform: "macos", url: "/downloads/Connector.dmg", version: "0.1.0" },
    ]));
    expect(releases[0].unsigned).toBe(false);
    expect(releases[1]).not.toHaveProperty("unsigned");
  });
  it.each(["true", "false", 1, 0, null, {}, []])("rejects a non-boolean unsigned flag: %j", (unsigned) => {
    expect(() => readLocalAgentReleases(JSON.stringify([
      { platform: "windows", url: "/downloads/Connector.exe", version: "0.1.0", unsigned },
    ]))).toThrow();
  });
  it.each(["javascript:alert(1)", "http://untrusted.example/installer", "//untrusted.example/a.exe", "/\\untrusted.example/a", "/downloads/../private", "/downloads/%2e%2e/private", "https://user:pass@example.com/a"])("rejects unsafe installer URLs: %s", (url) => {
    expect(() => readLocalAgentReleases(JSON.stringify([{ platform: "windows", url, version: "0.1.0" }]))).toThrow();
  });
  it("rejects malformed manifests instead of silently showing broken links", () => {
    for (const value of ["{", "{}", '[{"platform":"android","url":"/a","version":"0.1.0"}]']) {
      expect(() => readLocalAgentReleases(value)).toThrow("AI 브릿지 다운로드를 준비하고 있어요. 잠시 후 다시 확인해주세요.");
    }
  });
  it("serves the download envelope after checking the signed-in web scope", async () => {
    const { GET } = await import("@/app/api/local-agent/downloads/route");
    const { webScope } = await import("@/lib/local-agent/request");
    vi.stubEnv("LOCAL_AGENT_RELEASES", "");
    const req = new Request("http://localhost/api/local-agent/downloads");
    const res = await GET(req);
    expect(webScope).toHaveBeenCalledWith(req);
    expect(await res.json()).toEqual({ data: { releases: [] } });
    expect(res.headers.get("Cache-Control")).toContain("no-store");
  });
});
