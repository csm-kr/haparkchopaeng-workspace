// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
const create = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/admin",() => ({ createSupabaseAdmin: create }));
import { assertGeneratedPresentationStorage } from "@/lib/storage";
afterEach(() => vi.unstubAllEnvs());
it("returns a human 503 before accepting output work without storage configuration",() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL",""); vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY","");
  expect(() => assertGeneratedPresentationStorage()).toThrowError(expect.objectContaining({ status: 503,code: "STORAGE_UNAVAILABLE",message: expect.stringMatching(/발표 파일|연결/) }));
  expect(create).not.toHaveBeenCalled();
});
it("checks configuration without network access or exposing credentials",() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL","https://storage.test"); vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY","isolated-storage-fixture");
  expect(() => assertGeneratedPresentationStorage()).not.toThrow(); expect(create).not.toHaveBeenCalled();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL","not a URL"); expect(() => assertGeneratedPresentationStorage()).toThrowError(expect.objectContaining({ status: 503 }));
});
