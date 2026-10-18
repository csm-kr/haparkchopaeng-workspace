// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ factory: vi.fn(), from: vi.fn(), sign: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdmin: m.factory }));
import { signedDownloadUrl } from "../storage";
beforeEach(() => {
  vi.resetAllMocks();
  m.factory.mockReturnValue({ storage: { from: m.from } });
  m.from.mockReturnValue({ createSignedUrl: m.sign });
  m.sign.mockResolvedValue({ data: { signedUrl: "https://synthetic.invalid/signed" }, error: null });
});
describe("optional signing signal", () => {
  it("passes the same page signal to only this signing client", async () => {
    const signal = new AbortController().signal;
    await expect(signedDownloadUrl("papers/synthetic.pdf", 120, { signal })).resolves.toBe("https://synthetic.invalid/signed");
    expect(m.factory).toHaveBeenCalledWith({ signal });
    expect(m.sign).toHaveBeenCalledWith("papers/synthetic.pdf", 120);
  });
  it("preserves existing default TTL and no-argument admin construction", async () => {
    await signedDownloadUrl("papers/synthetic.pdf");
    expect(m.factory).toHaveBeenCalledWith();
    expect(m.sign).toHaveBeenCalledWith("papers/synthetic.pdf", 60);
  });
});
