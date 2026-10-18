// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), destroy: vi.fn(), revoke: vi.fn(), supabase: vi.fn(), signOut: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getConnectionSession: mocks.session, destroySession: mocks.destroy }));
vi.mock("@/lib/local-agent/service", () => ({ revokeSession: mocks.revoke }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.supabase }));
const { POST } = await import("../route");
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ sessionKey: "session-fingerprint" });
  mocks.revoke.mockResolvedValue(undefined);
  mocks.destroy.mockResolvedValue(undefined);
  mocks.supabase.mockRejectedValue(new Error("not configured"));
  mocks.signOut.mockResolvedValue(undefined);
});
describe("logout revokes local execution", () => {
  it("revokes device grants before deleting the app cookie even when IdP signout is unavailable", async () => {
    expect((await POST()).status).toBe(200);
    expect(mocks.revoke).toHaveBeenCalledWith("session-fingerprint");
    expect(mocks.revoke.mock.invocationCallOrder[0]).toBeLessThan(mocks.destroy.mock.invocationCallOrder[0]);
  });
  it("still destroys the cookie when revocation storage fails", async () => {
    mocks.revoke.mockRejectedValue(new Error("storage unavailable"));
    const logger = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await POST()).status).toBe(500);
    expect(mocks.destroy).toHaveBeenCalled();
    logger.mockRestore();
  });
  it.each(["successful", "failing"])("attempts %s IdP signout and deletes the cookie after revocation fails", async (outcome) => {
    const revocationError = new Error("storage unavailable");
    mocks.revoke.mockRejectedValue(revocationError);
    mocks.supabase.mockResolvedValue({ auth: { signOut: mocks.signOut } });
    if (outcome === "failing") mocks.signOut.mockRejectedValue(new Error("IdP unavailable"));
    const logger = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const result = await POST();
      expect(mocks.signOut).toHaveBeenCalledTimes(1);
      expect(mocks.destroy).toHaveBeenCalledTimes(1);
      expect(mocks.revoke.mock.invocationCallOrder[0]).toBeLessThan(mocks.signOut.mock.invocationCallOrder[0]);
      expect(mocks.signOut.mock.invocationCallOrder[0]).toBeLessThan(mocks.destroy.mock.invocationCallOrder[0]);
      expect(result.status).toBe(500);
      expect(await result.json()).toMatchObject({ error: { code: "INTERNAL" } });
      expect(logger).toHaveBeenCalledWith(revocationError);
    } finally { logger.mockRestore(); }
  });
});
