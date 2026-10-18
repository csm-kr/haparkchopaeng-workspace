/** Disposable SQLite verification. No command may target an inherited database. */
import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile, open, unlink, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";

const root = fileURLToPath(new URL("../", import.meta.url));
const prismaCli = join(root, "node_modules/prisma/build/index.js");
const vitestCli = join(root, "node_modules/vitest/vitest.mjs");

export function sqliteSchema(source, clientOutput) {
  if (!/datasource db\s*\{[\s\S]*?provider\s*=\s*"postgresql"/.test(source)) throw new Error("Expected canonical PostgreSQL schema");
  return source.replace(/datasource db\s*\{[\s\S]*?\}/, (block) => block
    .replace(/provider\s*=\s*"postgresql"/, 'provider = "sqlite"')
    .replace(/^\s*directUrl\s*=.*$/m, ""))
    .replace(/generator client\s*\{[\s\S]*?\}/, (block) => `${block.slice(0, -1)}  output = ${JSON.stringify(clientOutput.replaceAll("\\", "/"))}\n}`);
}

export function assertIsolatedDatabase(directory, url) {
  const rel = relative(resolve(tmpdir()), resolve(directory));
  if (rel.startsWith(`..${sep}`) || rel === ".." || !rel.startsWith("hapark-local-agent-") ||
      url !== `file:${join(resolve(directory), "agent.db").replaceAll("\\", "/")}`) {
    throw new Error("Verification requires its own temporary SQLite database");
  }
}

export function isolatedEnvironment(directory, inherited = process.env) {
  const env = Object.fromEntries(Object.entries(inherited).map(([key, value]) =>
    [key, /(?:API_KEY|TOKEN|SECRET|SUPABASE|LIVEKIT|INNGEST|DATABASE_URL|DIRECT_URL)/i.test(key) ? "" : value]));
  const url = `file:${join(resolve(directory), "agent.db").replaceAll("\\", "/")}`;
  assertIsolatedDatabase(directory, url);
  return { ...env,
    // Empty values prevent Next/dotenv from reloading real credentials from local .env files.
    GEMINI_API_KEY: "", GOOGLE_API_KEY: "", OPENAI_API_KEY: "", ANTHROPIC_API_KEY: "",
    SUPABASE_URL: "", SUPABASE_ANON_KEY: "", SUPABASE_SERVICE_ROLE_KEY: "",
    NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
    LIVEKIT_URL: "", LIVEKIT_API_KEY: "", LIVEKIT_API_SECRET: "", NEXT_PUBLIC_LIVEKIT_URL: "",
    INNGEST_EVENT_KEY: "", INNGEST_SIGNING_KEY: "", INNGEST_BASE_URL: "",
    DATABASE_URL: url, DIRECT_URL: url, LOCAL_AGENT_TEST_DATABASE_URL: url,
    AUTH_SECRET: "isolated-local-agent-tests-only-not-a-deployment-secret",
    PRISMA_GENERATE_SKIP_AUTOINSTALL: "1", CI: "1", NO_COLOR: "1",
    LOCAL_AGENT_RELEASES: "", PAPER_WEEKLY_LIMIT: "20", AGENT_TASKS_ENABLED: "1", HAPARK_ISOLATED_TESTS: "1" };
}

function launch(argv, env, capture = false) {
  const child = spawn(process.execPath, argv, { cwd: root, env, windowsHide: true,
    detached: capture && process.platform !== "win32",
    stdio: capture ? ["ignore", "pipe", "pipe"] : ["ignore", "inherit", "inherit"] });
  child.haparkProcessGroup = capture && process.platform !== "win32";
  return child;
}

async function command(argv, env) {
  const child = launch(argv, env);
  await new Promise((accept, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 ? accept() : reject(new Error(`Verification command exited ${code ?? signal}: ${argv[0]}`)));
  });
}

export async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((accept) => { child.once("exit", accept); });
  if (process.platform === "win32") {
    const result = spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore", timeout: 5000 });
    if (result.error) throw new Error("Could not stop the owned test server process");
  } else if (child.haparkProcessGroup) process.kill(-child.pid, "SIGTERM");
  else child.kill("SIGTERM");
  let timer;
  const stopped = await Promise.race([exited.then(() => true), new Promise((accept) => { timer = setTimeout(() => accept(false), 5000); })]);
  clearTimeout(timer);
  if (!stopped) {
    if (process.platform !== "win32") {
      if (child.haparkProcessGroup) process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL");
      await exited;
    } else throw new Error("Owned test server is still running; restore the Prisma client after stopping it");
  }
}

export async function withVerificationLock(lockPath, action) {
  const lock = await open(lockPath, "wx").catch((error) => {
    if (error.code === "EEXIST") throw new Error("Another isolated verification is running; do not generate a Prisma client concurrently");
    throw error;
  });
  try { await lock.writeFile(String(process.pid)); return await action(); }
  finally { await lock.close(); await unlink(lockPath); }
}

export async function isolateNextCache(projectDirectory, cacheDirectory) {
  const project = resolve(projectDirectory), cache = resolve(cacheDirectory);
  if (!cache.startsWith(`${join(project, "node_modules/.cache")}${sep}`)) throw new Error("Next test cache cannot be outside the package cache");
  const next = join(project, ".next"), saved = join(cache, "next-before"), output = join(cache, "next-test-output");
  let hadCache = true, restored = false;
  try { await rename(next, saved); } catch (error) { if (error.code !== "ENOENT") throw error; hadCache = false; }
  return async () => {
    if (restored) return;
    try { await rename(next, output); } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (hadCache) await rename(saved, next);
    restored = true;
  };
}

async function unusedPort(port) {
  const server = createServer();
  await new Promise((accept, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => server.close(accept));
  });
}

async function waitForApp(child, url) {
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline && child.exitCode === null) {
    try { if ((await fetch(url, { signal: AbortSignal.timeout(2000) })).status === 200) return; } catch { /* startup */ }
    await new Promise((accept) => setTimeout(accept, 500));
  }
  throw new Error("Isolated app did not start");
}

export async function verify(mode) {
  if (!["unit", "real", "all", "e2e", "wire", "serve"].includes(mode)) throw new Error("Use unit, real, all, e2e, wire or serve");
  const sharedClient = !["unit","real"].includes(mode);
  const lockPath = join(root, "node_modules/.hapark-isolated-tests.lock");
  return withVerificationLock(lockPath, async () => {
  let server, log, env, restoreNextCache, clientReplaced = false;
  let interrupted = false;
  const onSignal = () => { interrupted = true; void stopChild(server).catch(() => {}); };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  try {
  const directory = await mkdtemp(join(tmpdir(), "hapark-local-agent-"));
  // Keep the schema/client inside this package's ignored cache so Prisma resolves
  // the existing runtime. An OS temp schema triggers Prisma's ancestor auto-install.
  const cacheParent = join(root, "node_modules/.cache");
  await mkdir(cacheParent, { recursive: true });
  const clientDirectory = await mkdtemp(join(cacheParent, "hapark-local-agent-"));
  env = isolatedEnvironment(directory);
  env.HAPARK_TEST_DIRECTORY = directory;
  const clientPath = sharedClient ? join(root, "node_modules/.prisma/client") : join(clientDirectory, "client");
  const schemaPath = join(clientDirectory, "schema.prisma");
    await writeFile(schemaPath, sqliteSchema(await readFile(join(root, "prisma/schema.prisma"), "utf8"), clientPath));
    assertIsolatedDatabase(directory, env.DATABASE_URL);
    await command([prismaCli, "generate", "--schema", schemaPath], env);
    clientReplaced = sharedClient;
    // The schema and both datasource URLs are isolated before this write command.
    await command([prismaCli, "db", "push", "--skip-generate", "--schema", schemaPath], env);
    env.LOCAL_AGENT_TEST_CLIENT_MODULE = join(clientPath, "index.js");
    env.HAPARK_REAL_MODEL_SMOKE = mode === "real" ? "1" : "0";
    if (mode === "real") {
      await command([vitestCli,"run","--no-file-parallelism","lib/seminar/__tests__/real-model.smoke.test.ts"],env);
    } else if (mode === "unit") {
      await command([vitestCli, "run", "--no-file-parallelism", "lib/local-agent", "lib/local-ai", "lib/research-chat", "lib/agent", "lib/seminar", "lib/__tests__/local-agent-releases.test.ts", "components/local-agent", "components/research-chat", "components/agent", "components/seminar", "app/api/local-agent", "app/api/research-chat", "app/api/agent"], env);
    } else {
      // Canonical seed only runs after the fresh SQLite-only guard above.
      assertIsolatedDatabase(directory, env.DATABASE_URL);
      await command([join(root, "node_modules/tsx/dist/cli.mjs"), "prisma/seed.ts"], env);
      if (mode === "all") await command([vitestCli, "run", "--no-file-parallelism"], env);
      else {
        await command([join(root, "scripts/local-agent-fixture.mjs")], env);
        const port = mode === "wire" ? 3210 : mode === "e2e" ? 3211 : 3000;
        await unusedPort(port);
        const url = `http://localhost:${port}`;
        env.LOCAL_AGENT_E2E_URL = url;
        restoreNextCache = await isolateNextCache(root, clientDirectory);
        server = launch([join(root, "node_modules/next/dist/bin/next"), "dev", "--port", String(port)], env, true);
        log = await open(join(directory, "next.log"), "w");
        server.stdout.on("data", (chunk) => { void log.write(chunk); });
        server.stderr.on("data", (chunk) => { void log.write(chunk); });
        console.log(`Isolated app: ${url}; log: ${join(directory, "next.log")}`);
        await waitForApp(server, url);
        if (mode === "e2e") await command([join(root, "node_modules/@playwright/test/cli.js"), "test", "--config", "playwright.local-agent.config.ts"], env);
        else if (mode === "wire") await command(["--test", "scripts/local-agent-wire.test.mjs"], env);
        else await new Promise((accept) => { server.once("exit", accept); if (interrupted) accept(); });
        await stopChild(server);
      }
    }
  } finally {
    try {
      await stopChild(server);
      await restoreNextCache?.();
      if (clientReplaced) await command([prismaCli, "generate", "--schema", join(root, "prisma/schema.prisma")], env);
    } finally {
      process.off("SIGINT", onSignal); process.off("SIGTERM", onSignal);
      await log?.close();
    }
  }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verify(process.argv[2] ?? "unit").catch((error) => { console.error(error.message); process.exitCode = 1; });
}
