/** DB를 사용하는 검증은 전용 실행기가 만든 loopback DB에서만 실행한다. */
export function assertTestDatabase(env: Record<string, string | undefined> = process.env): string {
  const fail = () => new Error("격리된 테스트 DB가 필요해요. npm run test:db 또는 npm run test:e2e로 실행해주세요.");
  if (env.HAPARK_TEST_DB !== "1" || !env.TEST_DATABASE_URL) throw fail();
  let url: URL;
  try { url = new URL(env.TEST_DATABASE_URL); } catch { throw fail(); }
  if (!(["postgres:", "postgresql:"].includes(url.protocol)) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    !/^\/hapark_test_[a-z0-9_]+$/.test(url.pathname)) throw fail();
  return env.TEST_DATABASE_URL;
}
