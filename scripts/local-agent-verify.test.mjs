import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, access, writeFile, unlink, mkdir, readFile } from "node:fs/promises";
import { isolatedEnvironment, sqliteSchema, assertIsolatedDatabase, stopChild, withVerificationLock, isolateNextCache } from "./local-agent-verify.mjs";

const source = `datasource db {
  provider = "postgresql"
  url = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}
generator client {
  provider = "prisma-client-js"
}
model Item { id String @id }
`;

test("builds a separate SQLite client without modifying canonical schema", () => {
  const output = sqliteSchema(source, "C:/temp/한글 client");
  assert.match(output, /provider = "sqlite"/);
  assert.doesNotMatch(output, /directUrl/);
  assert.match(output, /output = "C:\/temp\/한글 client"/);
  assert.match(source, /postgresql/);
  assert.throws(() => sqliteSchema("model Item {}", "x"));
});

test("cannot push or seed an inherited production database URL", () => {
  const directory = join(tmpdir(), "hapark-local-agent-unique");
  const env = isolatedEnvironment(directory, { DATABASE_URL: "postgres://secret", DIRECT_URL: "postgres://secret", GEMINI_API_KEY: "secret", PATH: "tools" });
  assert.equal(env.DATABASE_URL, `file:${join(directory, "agent.db").replaceAll("\\", "/")}`);
  assert.equal(env.DIRECT_URL, env.DATABASE_URL);
  assert.equal(env.LOCAL_AGENT_TEST_DATABASE_URL, env.DATABASE_URL);
  assert.equal(env.GEMINI_API_KEY, "");
  assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, "");
  assert.equal(env.SUPABASE_SERVICE_ROLE_KEY, "");
  assert.equal(env.INNGEST_EVENT_KEY, "");
  assert.equal(env.PATH, "tools");
  assert.equal(env.PRISMA_GENERATE_SKIP_AUTOINSTALL, "1");
  assert.ok(env.AUTH_SECRET.startsWith("isolated-"));
  assert.doesNotThrow(() => assertIsolatedDatabase(directory, env.DATABASE_URL));
  assert.throws(() => assertIsolatedDatabase(directory, "postgres://secret"));
  assert.throws(() => assertIsolatedDatabase(directory, "file:C:/other.db"));
  assert.throws(() => assertIsolatedDatabase(process.cwd(), "file:C:/other.db"));
});

test("waits for its own server process to exit before restoring a native client", async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(()=>{},5000)"], { windowsHide: true, stdio: "ignore" });
  await once(child, "spawn");
  let exited = false;
  child.once("exit", () => { exited = true; });
  try {
    await stopChild(child);
    assert.equal(exited, true);
  } finally { if (!exited) child.kill(); }
});

test("setup failures release the verification lock and an existing lock blocks work", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hapark-local-agent-lock-"));
  const lockPath = join(directory, "guard.lock");
  await assert.rejects(withVerificationLock(lockPath, async () => { throw new Error("setup failed"); }), /setup failed/);
  await assert.rejects(access(lockPath), { code: "ENOENT" });
  await writeFile(lockPath, "another verifier");
  let called = false;
  try {
    await assert.rejects(withVerificationLock(lockPath, async () => { called = true; }), /Another isolated verification/);
    assert.equal(called, false);
  } finally { await unlink(lockPath); }
});

test("app verification preserves the existing production cache and keeps its own dev cache separate", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hapark-local-agent-next-"));
  const cache = join(directory, "node_modules/.cache/isolated");
  await mkdir(cache, { recursive: true });
  await mkdir(join(directory, ".next"));
  await writeFile(join(directory, ".next/manifest.txt"), "production");
  const restore = await isolateNextCache(directory, cache);
  await assert.rejects(access(join(directory, ".next")), { code: "ENOENT" });
  await mkdir(join(directory, ".next"));
  await writeFile(join(directory, ".next/manifest.txt"), "test-dev");
  await restore(); await restore();
  assert.equal(await readFile(join(directory, ".next/manifest.txt"), "utf8"), "production");
  assert.equal(await readFile(join(cache, "next-test-output/manifest.txt"), "utf8"), "test-dev");
  await assert.rejects(isolateNextCache(directory, tmpdir()), /outside/);
});
