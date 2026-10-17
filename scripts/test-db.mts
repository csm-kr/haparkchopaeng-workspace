import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, writeFile, unlink } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { assertTestDatabase } from "./test-database.ts";

// .env의 URL을 사용하지 않는다. 매 실행에 전용 PostgreSQL 프로세스·새 DB를 만든다.
const mode = process.argv[2] ?? "db";
if (!["db", "e2e"].includes(mode)) throw new Error("사용법: npm run test:db 또는 npm run test:e2e -- [Playwright 인수]");
const platform = process.platform === "win32" ? "windows" : process.platform;
const native = await import(`@embedded-postgres/${platform}-${process.arch}`);
// Windows PostgreSQL의 bootstrap SQL은 설치 경로의 한글을 UTF-8로 처리하지 못한다.
const cache = path.join(tmpdir(), "hapark-test-db");
await mkdir(cache, { recursive: true });
const directory = await mkdtemp(path.join(cache, "run-"));
const binaries = { initdb: native.initdb, postgres: native.postgres, pg_ctl: native.pg_ctl };
if (process.platform === "win32" && /[^\x00-\x7F]/.test(native.postgres)) {
  const source = path.dirname(path.dirname(native.postgres));
  const target = path.join(directory, "native");
  await cp(source, target, { recursive: true });
  for (const key of ["initdb", "postgres", "pg_ctl"] as const) binaries[key] = path.join(target, "bin", path.basename(native[key]));
}
const data = path.join(directory, "data");
const password = randomBytes(20).toString("hex");
const passwordFile = path.join(directory, "password");
await writeFile(passwordFile, password, { mode: 0o600 });
const children = new Set<ChildProcess>();
let database: ChildProcess | undefined;

function start(executable: string, args: string[], env = process.env, pipe = false) {
  const child = spawn(executable, args, { env, windowsHide: true, stdio: pipe ? ["ignore", "pipe", "pipe"] : "inherit" });
  children.add(child);
  child.once("close", () => children.delete(child));
  return child;
}

async function run(script: string, args: string[], env: NodeJS.ProcessEnv) {
  const child = start(process.execPath, [script, ...args], env);
  const [code] = await once(child, "exit");
  if (code !== 0) throw new Error(`${path.basename(script)} 실패 (exit ${code})`);
}

async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    await once(killer, "exit");
  } else {
    child.kill("SIGTERM");
    await once(child, "exit");
  }
}

let stopping = false;
async function cleanup() {
  if (stopping) return;
  stopping = true;
  for (const child of [...children]) if (child !== database) await stop(child);
  if (database && database.exitCode === null && database.signalCode === null) {
    // 정상 정리 우선. pg_ctl도 창을 숨기고 stdout/stderr를 보존한다.
    const ctl = start(binaries.pg_ctl, ["-D", data, "-m", "fast", "-w", "-t", "10", "stop"]);
    const [code] = await once(ctl, "exit");
    if (code !== 0) await stop(database);
  }
}
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => { void cleanup().finally(() => process.exit(130)); });
}

try {
  const init = start(binaries.initdb, ["-D", data, "--username=hapark_test", `--pwfile=${passwordFile}`, "--auth=scram-sha-256", "--encoding=UTF8", "--locale=C"]);
  const [initCode] = await once(init, "exit");
  if (initCode !== 0) throw new Error(`테스트 PostgreSQL 초기화 실패 (${initCode})`);
  await unlink(passwordFile);
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const address = listener.address();
  if (!address || typeof address === "string") throw new Error("테스트 포트 할당 실패");
  await new Promise<void>((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  database = start(binaries.postgres, ["-D", data, "-h", "127.0.0.1", "-p", String(address.port), "-c", "lc_messages=C"], process.env, true);
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("테스트 PostgreSQL 시작 시간 초과")), 30_000);
    const onData = (chunk: Buffer) => {
      process.stdout.write(chunk);
      if (chunk.toString().includes("ready to accept connections")) { clearTimeout(timeout); resolve(); }
    };
    database!.stdout!.on("data", onData);
    database!.stderr!.on("data", onData);
    database!.once("error", (error) => { clearTimeout(timeout); reject(error); });
    database!.once("exit", (code) => { clearTimeout(timeout); reject(new Error(`테스트 DB 종료 (${code})`)); });
  });
  const name = `hapark_test_${randomBytes(8).toString("hex")}`;
  const base = `postgresql://hapark_test:${password}@127.0.0.1:${address.port}`;
  const admin = new PrismaClient({ datasourceUrl: `${base}/postgres` });
  try { await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`); } finally { await admin.$disconnect(); }
  const url = `${base}/${name}`;
  const env = {
    ...process.env,
    HAPARK_TEST_DB: "1", TEST_DATABASE_URL: url, DATABASE_URL: url, DIRECT_URL: url,
    AUTH_SECRET: "hapark-isolated-test-only", NEXT_TELEMETRY_DISABLED: "1",
    NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "", SUPABASE_SERVICE_ROLE_KEY: "",
    LIVEKIT_URL: "", LIVEKIT_API_KEY: "", LIVEKIT_API_SECRET: "",
    GEMINI_API_KEY: "", INNGEST_EVENT_KEY: "", INNGEST_SIGNING_KEY: "", INNGEST_DEV: "0",
    BROWSER: "none",
  };
  assertTestDatabase(env);
  console.log("[test-db] 격리된 로컬 PostgreSQL을 사용합니다.");
  await run("node_modules/prisma/build/index.js", ["db", "push", "--skip-generate"], env);
  await run("node_modules/tsx/dist/cli.mjs", ["prisma/seed.ts"], env);
  if (mode === "db") {
    await run("node_modules/vitest/vitest.mjs", ["run", "--config", "vitest.integration.config.ts", ...process.argv.slice(3)], env);
  } else {
    await run("node_modules/@playwright/test/cli.js", ["test", ...process.argv.slice(3)], env);
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await cleanup();
}
