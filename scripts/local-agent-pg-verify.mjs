/** CI-only disposable PostgreSQL 16 verification. Never uses DATABASE_URL/DIRECT_URL. */
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const databaseName = 'hapark_local_agent_test';
const localAgentModels = ['LocalAgentDevice', 'LocalAgentAttempt', 'LocalAgentGrant', 'LocalAgentSnapshot', 'LocalAgentJob'];

export function assertIsolatedPostgres(environment = process.env) {
  if (environment.CI !== 'true' || environment.HAPARK_PG_ISOLATED_TESTS !== '1') throw new Error('PostgreSQL verification requires CI=true and HAPARK_PG_ISOLATED_TESTS=1.');
  const value = environment.LOCAL_AGENT_PG_TEST_URL;
  if (typeof value !== 'string' || !value || value !== value.trim()) throw new Error('An explicit LOCAL_AGENT_PG_TEST_URL is required; application datasource URLs are never used.');
  let url;
  try { url = new URL(value); } catch { throw new Error('The isolated PostgreSQL test URL is invalid.'); }
  if (!['postgresql:', 'postgres:'].includes(url.protocol) || !['localhost', '127.0.0.1'].includes(url.hostname) ||
      url.pathname !== `/${databaseName}` || !url.username || url.search || url.hash || value.includes('?') || value.includes('#')) {
    throw new Error('Only a loopback PostgreSQL URL for hapark_local_agent_test without override parameters is allowed.');
  }
  return value;
}

export function postgresSchema(source, output) {
  if (!/datasource db\s*\{[\s\S]*?provider\s*=\s*"postgresql"/.test(source)) throw new Error('Expected the canonical PostgreSQL schema.');
  const datasource = 'datasource db {\n  provider = "postgresql"\n  url = env("LOCAL_AGENT_PG_TEST_URL")\n  directUrl = env("LOCAL_AGENT_PG_TEST_URL")\n}';
  return source.replace(/datasource db\s*\{[\s\S]*?\}/, datasource)
    .replace(/generator client\s*\{[\s\S]*?\}/, block => `${block.slice(0, -1).replace(/^\s*output\s*=.*$/m, '')}  output = ${JSON.stringify(output.replaceAll('\\', '/'))}\n}`);
}

/** Keep every existing model intact; the reviewed SQL must be what creates the new tables. */
export function postgresBaseSchema(source) {
  const removed = [];
  let teamCount = 0;
  const base = source.replace(/^model\s+(\w+)\s*\{[\s\S]*?^\}/gm, (block, name) => {
    if (name.startsWith('LocalAgent')) {
      if (!localAgentModels.includes(name) || removed.includes(name)) throw new Error('Unexpected or repeated LocalAgent model in the canonical schema.');
      removed.push(name);
      return '';
    }
    if (name !== 'Team') return block;
    teamCount++;
    const relations = [];
    const team = block.replace(/^\s*\w+\s+(LocalAgent\w+)\[\][^\S\r\n]*(?:\/\/[^\r\n]*)?\r?$/gm, (_, target) => {
      if (!localAgentModels.includes(target) || relations.includes(target)) throw new Error('Unexpected Team LocalAgent reverse relation.');
      relations.push(target);
      return '';
    });
    if (relations.length !== localAgentModels.length) throw new Error('Expected exactly the five Team LocalAgent reverse relations.');
    return team;
  });
  if (removed.length !== localAgentModels.length || teamCount !== 1 || /\bLocalAgent\w+\b/.test(base.replace(/\/\/[^\r\n]*/g, ''))) {
    throw new Error('Could not safely isolate the application base schema.');
  }
  return base;
}

/** This verifier applies only the additive, reviewed feature SQL, never existing-table mutations. */
export function assertLocalAgentSql(source) {
  const statements = source.replace(/--[^\r\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').split(';').map(value => value.trim()).filter(Boolean);
  const tables = [];
  for (const statement of statements) {
    const table = statement.match(/^CREATE TABLE "(LocalAgent\w+)"\s*\([\s\S]+\)$/);
    if (table) {
      if (!localAgentModels.includes(table[1]) || tables.includes(table[1])) throw new Error('Unexpected or repeated table in the reviewed LocalAgent SQL.');
      tables.push(table[1]);
      continue;
    }
    const index = statement.match(/^CREATE (?:UNIQUE )?INDEX "LocalAgent\w+" ON "(LocalAgent\w+)"\((?:"\w+"(?:,\s*)?)+\)$/);
    if (index && localAgentModels.includes(index[1])) continue;
    const relation = statement.match(/^ALTER TABLE "(LocalAgent\w+)" ADD CONSTRAINT "LocalAgent\w+" FOREIGN KEY \("\w+"\) REFERENCES "(Team|LocalAgent\w+)"\("id"\) ON DELETE (?:CASCADE|SET NULL) ON UPDATE CASCADE$/);
    if (relation && localAgentModels.includes(relation[1]) && (relation[2] === 'Team' || localAgentModels.includes(relation[2]))) continue;
    throw new Error('Only additive LocalAgent tables, indexes and foreign keys are allowed in the reviewed SQL.');
  }
  if (tables.length !== localAgentModels.length) throw new Error('The reviewed SQL must create exactly the five LocalAgent tables.');
}

export function postgresEnvironment(inherited, clientModule) {
  const url = assertIsolatedPostgres(inherited);
  const env = Object.fromEntries(Object.entries(inherited).filter(([key]) =>
    !/(?:API_KEY|TOKEN|SECRET|SUPABASE|LIVEKIT|INNGEST|DATABASE_URL|DIRECT_URL|LOCAL_AGENT_TEST_CLIENT_MODULE|LOCAL_AGENT_PG_TEST_CLIENT_MODULE|LOCAL_AGENT_PG_TEST_URL|^PG|^POSTGRES)/i.test(key)));
  return { ...env, CI: 'true', HAPARK_PG_ISOLATED_TESTS: '1', LOCAL_AGENT_PG_TEST_URL: url,
    LOCAL_AGENT_PG_TEST_CLIENT_MODULE: clientModule, PRISMA_GENERATE_SKIP_AUTOINSTALL: '1',
    AUTH_SECRET: 'isolated-postgres-local-agent-tests-only-not-a-deployment-secret' };
}

function redact(output, url) {
  let value = output.replaceAll(url, '[isolated PostgreSQL URL]');
  const password = new URL(url).password;
  if (password) { value = value.replaceAll(password, '[redacted]'); try { value = value.replaceAll(decodeURIComponent(password), '[redacted]'); } catch { /* encoded password only */ } }
  return value;
}

async function command(argv, env) {
  // Validate immediately before every command, including the schema write command.
  const url = assertIsolatedPostgres(env);
  const child = spawn(process.execPath, argv, { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const chunks = [];
  let size = 0;
  const collect = chunk => { size += chunk.length; if (size > 2 * 1024 * 1024) { child.kill(); return; } chunks.push(chunk); };
  child.stdout.on('data', collect); child.stderr.on('data', collect);
  const code = await new Promise((accept, reject) => { child.once('error', () => reject(new Error('Could not start an isolated verification command.'))); child.once('exit', accept); });
  process.stdout.write(redact(Buffer.concat(chunks).toString('utf8'), url));
  if (code !== 0 || size > 2 * 1024 * 1024) throw new Error('An isolated PostgreSQL verification command failed.');
}

export function assertPostgres16Identity(rows) {
  const version = Number(rows?.[0]?.version);
  if (rows?.[0]?.name !== databaseName || !Number.isInteger(version) || version < 160000 || version >= 170000) {
    throw new Error('A disposable PostgreSQL 16 server with the dedicated test database is required before schema creation.');
  }
}

export function assertEmptyPostgresDatabase(rows) {
  if (rows?.[0]?.tables !== 0) throw new Error('A new empty disposable PostgreSQL database is required; existing schemas are never changed.');
}

async function assertDisposableServer(clientModule, url) {
  const { PrismaClient } = createRequire(import.meta.url)(clientModule);
  const client = new PrismaClient({ datasources: { db: { url } } });
  try {
    const rows = await client.$queryRawUnsafe("SELECT current_database() AS name, current_setting('server_version_num') AS version, (SELECT count(*)::int FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE') AS tables");
    assertPostgres16Identity(rows);
    assertEmptyPostgresDatabase(rows);
  } catch { throw new Error('A disposable PostgreSQL 16 server with the dedicated test database is required before schema creation.'); }
  finally { await client.$disconnect(); }
}

export async function runPostgresVerification(environment, operations) {
  const url = assertIsolatedPostgres(environment); // Before filesystem, process or network work.
  const source = await readFile(join(root, 'prisma/schema.prisma'), 'utf8');
  const baseSource = postgresBaseSchema(source);
  const sql = join(root, 'docs/dev/sql/20261017-local-agent-connection.sql');
  assertLocalAgentSql(await readFile(sql, 'utf8'));
  const parent = join(root, 'node_modules/.cache');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, 'hapark-local-agent-pg-'));
  const output = join(directory, 'client');
  const schema = join(directory, 'schema.prisma');
  const baseSchema = join(directory, 'base.prisma');
  const env = postgresEnvironment(environment, join(output, 'index.js'));
  await writeFile(schema, postgresSchema(source, output));
  await writeFile(baseSchema, postgresSchema(baseSource, output));
  const prisma = join(root, 'node_modules/prisma/build/index.js');
  await operations.command([prisma, 'generate', '--schema', schema], env);
  await operations.assertDisposableServer(env.LOCAL_AGENT_PG_TEST_CLIENT_MODULE, url);
  // Dedicated URL, actual PG16 identity and empty DB were checked. No reset/seed/accept-data-loss.
  await operations.command([prisma, 'db', 'push', '--skip-generate', '--schema', baseSchema], env);
  await operations.command([prisma, 'db', 'execute', '--file', sql, '--schema', schema], env);
  // Read-only drift check proves the reviewed SQL matches the full canonical Prisma schema.
  await operations.command([prisma, 'migrate', 'diff', '--from-schema-datasource', schema, '--to-schema-datamodel', schema, '--exit-code'], env);
  await operations.command([join(root, 'node_modules/vitest/vitest.mjs'), 'run', 'lib/local-agent/__tests__/postgres.integration.test.ts', '--reporter=basic'], env);
}

export async function verifyPostgres(environment = process.env) {
  return runPostgresVerification(environment, { command, assertDisposableServer });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyPostgres().catch(error => { console.error(error.message); process.exitCode = 1; });
}
