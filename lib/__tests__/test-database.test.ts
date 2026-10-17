import { describe, expect, it } from "vitest";
import { assertTestDatabase } from "@/scripts/test-database";

describe("테스트 DB 격리", () => {
  it("실행기가 만든 로컬 테스트 DB만 허용한다", () => {
    expect(() => assertTestDatabase({
      HAPARK_TEST_DB: "1", TEST_DATABASE_URL: "postgresql://test:pw@127.0.0.1:5439/hapark_test_abc",
    })).not.toThrow();
  });
  it.each([
    { HAPARK_TEST_DB: "1", TEST_DATABASE_URL: "postgresql://test:pw@remote.supabase.com:5432/hapark_test_abc" },
    { HAPARK_TEST_DB: "1", TEST_DATABASE_URL: "postgresql://test:pw@127.0.0.1:5432/postgres" },
    { TEST_DATABASE_URL: "postgresql://test:pw@127.0.0.1:5432/hapark_test_abc" },
    { HAPARK_TEST_DB: "1", DATABASE_URL: "postgresql://production" },
  ])("운영 연결 또는 격리 표시가 없으면 차단한다 (%j)", (env) => {
    expect(() => assertTestDatabase(env)).toThrow(/test:db|test:e2e/);
  });
});
