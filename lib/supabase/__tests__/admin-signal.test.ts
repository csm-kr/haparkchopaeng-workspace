// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ create: vi.fn(), fetch: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: m.create }));
import { createSupabaseAdmin } from "../admin";

type ClientOptions = { auth: { persistSession: boolean; autoRefreshToken: boolean }; global?: { fetch: typeof fetch } };
const clientOptions = () => m.create.mock.lastCall![2] as ClientOptions;
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic.invalid");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-key-never-a-real-secret");
  m.fetch.mockImplementation(async (_input, init) => {
    const signal: AbortSignal = init.signal;
    signal.throwIfAborted();
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
  });
  vi.stubGlobal("fetch", m.fetch);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("per-instance storage signing cancellation", () => {
  it.each(["page", "sdk", "request"] as const)("honors the %s abort signal without dropping the other SDK request signals", async source => {
    const page = new AbortController(), sdk = new AbortController(), request = new AbortController();
    createSupabaseAdmin({ signal: page.signal });
    const transport = clientOptions().global?.fetch;
    expect(transport).toBeTypeOf("function");
    const input = new Request("https://synthetic.invalid/sign", { signal: request.signal });
    const result = transport!(input, { signal: sdk.signal, headers: { "X-Synthetic": "preserved" } });
    const rejection = expect(result).rejects.toMatchObject({ name: "AbortError" });
    ({ page, sdk, request })[source].abort();
    await rejection;
    expect(m.fetch.mock.calls[0][1].headers).toEqual({ "X-Synthetic": "preserved" });
    expect(m.fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(globalThis.fetch).toBe(m.fetch);
  });
  it("keeps the original default client and lazy environment reads", () => {
    createSupabaseAdmin();
    expect(clientOptions()).toEqual({ auth: { persistSession: false, autoRefreshToken: false } });
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect(() => createSupabaseAdmin()).toThrow("SUPABASE_SERVICE_ROLE_KEY is not set");
    expect(globalThis.fetch).toBe(m.fetch);
  });
  it("does not let one page's abort affect a different client", async () => {
    const first = new AbortController(), second = new AbortController();
    createSupabaseAdmin({ signal: first.signal });
    const firstTransport = clientOptions().global!.fetch;
    createSupabaseAdmin({ signal: second.signal });
    const secondTransport = clientOptions().global!.fetch;
    const one = firstTransport("https://synthetic.invalid/sign-a"), two = secondTransport("https://synthetic.invalid/sign-b");
    const oneRejected = expect(one).rejects.toMatchObject({ name: "AbortError" });
    first.abort(); await oneRejected;
    expect(m.fetch.mock.calls[1][1].signal.aborted).toBe(false);
    const twoRejected = expect(two).rejects.toMatchObject({ name: "AbortError" });
    second.abort(); await twoRejected;
  });
});
