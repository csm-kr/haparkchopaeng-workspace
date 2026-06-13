import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 브라우저 Supabase 클라이언트 단위 테스트 — createClient를 모킹한다(AC).
// 검증: anon 키만 사용(service role 미참조) + 키 부재 시 null(throw 금지).

const { createClientMock } = vi.hoisted(() => ({ createClientMock: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: createClientMock }));

const ORIGINAL = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("createBrowserSupabase", () => {
  it("anon 키만으로 클라이언트를 만든다(service role 미참조, R2)", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "ANON_PUBLIC";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "SERVICE_SECRET";
    createClientMock.mockReturnValue({ id: "client" });

    const { createBrowserSupabase } = await import("@/lib/supabase/browser");
    const client = createBrowserSupabase();

    expect(client).toEqual({ id: "client" });
    expect(createClientMock).toHaveBeenCalledWith(
      "https://x.supabase.co",
      "ANON_PUBLIC",
    );
    // service role 키는 절대 인자로 넘어가지 않는다.
    const args = createClientMock.mock.calls[0];
    expect(args).not.toContain("SERVICE_SECRET");
  });

  it("키 부재 시 null(throw 금지)", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    const { createBrowserSupabase } = await import("@/lib/supabase/browser");
    expect(createBrowserSupabase()).toBeNull();
    expect(createClientMock).not.toHaveBeenCalled();
  });
});
