// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), destroy: vi.fn(), revoke: vi.fn(), supabase: vi.fn() }));
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
});
