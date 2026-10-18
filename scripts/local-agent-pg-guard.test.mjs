import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assertIsolatedPostgres, assertPostgres16Identity, postgresSchema, postgresEnvironment, verifyPostgres } from './local-agent-pg-verify.mjs';
import * as verifier from './local-agent-pg-verify.mjs';

const url = 'postgresql://postgres:example-test-password@127.0.0.1:5432/hapark_local_agent_test';
const valid = () => ({ CI: 'true', HAPARK_PG_ISOLATED_TESTS: '1', LOCAL_AGENT_PG_TEST_URL: url });

test('requires all explicit PostgreSQL CI gates, without falling back to inherited application URLs', async () => {
  assert.equal(assertIsolatedPostgres(valid()), url);
  for (const env of [
    { ...valid(), CI: undefined }, { ...valid(), CI: 'false' }, { ...valid(), CI: '1' },
    { ...valid(), HAPARK_PG_ISOLATED_TESTS: undefined }, { ...valid(), HAPARK_PG_ISOLATED_TESTS: 'true' },
    { CI: 'true', HAPARK_PG_ISOLATED_TESTS: '1', DATABASE_URL: url, DIRECT_URL: url },
  ]) {
    assert.throws(() => assertIsolatedPostgres(env));
    await assert.rejects(verifyPostgres(env));
  }
});

test('allows only the exact loopback hosts and dedicated database, with no host/schema override parameters', () => {
  assert.equal(assertIsolatedPostgres({ ...valid(), LOCAL_AGENT_PG_TEST_URL: url.replace('127.0.0.1', 'localhost') }), url.replace('127.0.0.1', 'localhost'));
  for (const unsafe of [
    url.replace('127.0.0.1', 'db.production.example'), url.replace('127.0.0.1', 'localhost.evil.example'),
    url.replace('127.0.0.1', '[::1]'), url.replace('127.0.0.1', '127.1'),
    url.replace('hapark_local_agent_test', 'postgres'), url.replace('hapark_local_agent_test', 'production'),
    url.replace('hapark_local_agent_test', '%68apark_local_agent_test'), `${url}/extra`,
    `${url}?host=production.example`, `${url}?schema=other`, `${url}#fragment`,
    url.replace('postgresql:', 'https:'), url.replace('postgres:example-test-password@', ''), 'not a URL',
  ]) assert.throws(() => assertIsolatedPostgres({ ...valid(), LOCAL_AGENT_PG_TEST_URL: unsafe }), error => !error.message.includes('example-test-password'));
});

test('isolates subprocess environment and binds both Prisma URLs only to the dedicated CI variable', () => {
  const inherited = { ...valid(), DATABASE_URL: 'production-secret', DIRECT_URL: 'production-secret', AUTH_SECRET: 'production-secret', SUPABASE_SERVICE_ROLE_KEY: 'production-secret', PGHOST: 'production.example', PGPASSWORD: 'production-secret', PATH: 'retained' };
  const env = postgresEnvironment(inherited, 'C:/isolated/client/index.js');
  assert.equal(env.LOCAL_AGENT_PG_TEST_URL, url);
  assert.equal(env.PATH, 'retained');
  assert.equal(env.DATABASE_URL, undefined);
  assert.equal(env.DIRECT_URL, undefined);
  assert.equal(env.PGHOST, undefined);
  assert.equal(env.PGPASSWORD, undefined);
  assert.equal(env.SUPABASE_SERVICE_ROLE_KEY, undefined);
  assert.notEqual(env.AUTH_SECRET, inherited.AUTH_SECRET);
  assert.equal(env.LOCAL_AGENT_PG_TEST_CLIENT_MODULE, 'C:/isolated/client/index.js');
  const schema = postgresSchema('datasource db {\n provider = "postgresql"\n url = env("DATABASE_URL")\n directUrl = env("DIRECT_URL")\n}\ngenerator client {\n provider = "prisma-client-js"\n}\nmodel Example {\n id String @id\n}', 'C:/isolated/client');
  assert.equal((schema.match(/env\("LOCAL_AGENT_PG_TEST_URL"\)/g) ?? []).length, 2);
  assert.equal(schema.includes('env("DATABASE_URL")'), false);
  assert.equal(schema.includes('env("DIRECT_URL")'), false);
  assert.ok(schema.includes('output = "C:/isolated/client"'));
  assert.throws(() => postgresSchema('datasource db { provider = "sqlite" }', '/tmp/client'));
});

test('requires the connected server itself to confirm the dedicated database and PostgreSQL 16 before schema creation', () => {
  assert.doesNotThrow(() => assertPostgres16Identity([{ name: 'hapark_local_agent_test', version: '160011' }]));
  for (const rows of [[], [{ name: 'production', version: '160011' }], [{ name: 'hapark_local_agent_test', version: '150015' }], [{ name: 'hapark_local_agent_test', version: '170000' }], [{ name: 'hapark_local_agent_test', version: 'not-a-version' }]]) {
    assert.throws(() => assertPostgres16Identity(rows));
  }
});

test('builds the application base before the five LocalAgent models and the exact local analysis additions', async () => {
  const source = await readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
  const base = verifier.postgresBaseSchema(source);
  const analysis = source.match(/^model Analysis \{[\s\S]*?^\}/m)?.[0];
  assert.ok(analysis && base.includes(analysis), 'unrelated application model is preserved verbatim');
  const paper = base.match(/^model Paper \{[\s\S]*?^\}/m)?.[0];
  assert.ok(paper?.includes('pdfUrl') && paper.includes('analysisDurationMs'), 'existing Paper data remains in the base');
  assert.doesNotMatch(paper, /^\s*(sourceText|sourceDigest|analysisRequestId|analysisError)\s/m);
  assert.doesNotMatch(base, /^model ResearchConversation\b/m);
  assert.doesNotMatch(base, /^\s*researchConversations\s+ResearchConversation/m);
  assert.equal(/^model LocalAgent/m.test(base), false);
  assert.doesNotMatch(base, /^model Agent(?:Task|Operation)\b/m);
  assert.doesNotMatch(base, /^\s*(agentTasks|seminarPresentations|sourcePaperId|sourcePaper)\s/m);
  assert.equal(/^\s*localAgent\w+\s+LocalAgent/m.test(base), false);
  for (const broken of [
    source.replace(/^model LocalAgentJob \{[\s\S]*?^\}/m, ''),
    `${source}\nmodel LocalAgentSurprise {\n id String @id\n}\n`,
    source.replace(/^\s*localAgentJobs LocalAgentJob\[\]\s*$/m, ''),
    `${source}\nmodel UnexpectedReference {\n id String @id\n device LocalAgentDevice\n}\n`,
    source.replace(/^model ResearchConversation \{[\s\S]*?^\}/m, ''),
    source.replace(/^\s*researchConversations\s+ResearchConversation\[\].*$/m, ''),
    source.replace(/^\s*sourceDigest\s+String\?.*$/m, ''),
    source.replace('sourceText        String?', 'sourceText        Int?'),
    `${source}\nmodel UnexpectedConversation {\n id String @id\n conversation ResearchConversation\n}\n`,
  ]) assert.throws(() => verifier.postgresBaseSchema(broken));
});

test('accepts only the reviewed additive LocalAgent SQL and refuses changes to existing application tables', async () => {
  const sql = await readFile(new URL('../docs/dev/sql/20261017-local-agent-connection.sql', import.meta.url), 'utf8');
  assert.doesNotThrow(() => verifier.assertLocalAgentSql(sql));
  for (const broken of [
    `${sql}\nDROP TABLE "Paper";`, `${sql}\nDELETE FROM "Paper";`,
    `${sql}\nCREATE TABLE "Other" ("id" TEXT);`,
    `${sql}\nALTER TABLE "Team" ADD COLUMN "unsafe" TEXT;`,
    sql.replace('CREATE TABLE "LocalAgentJob"', 'CREATE TABLE "Unexpected"'),
    `${sql}\nCREATE TABLE "LocalAgentJob" ("id" TEXT);`,
  ]) assert.throws(() => verifier.assertLocalAgentSql(broken));
});

test('accepts exactly the reviewed local analysis columns, conversation table, two indexes and two foreign keys', async () => {
  const sql = await readFile(new URL('../docs/dev/sql/20261017-local-ai-research-chat.sql', import.meta.url), 'utf8');
  assert.doesNotThrow(() => verifier.assertLocalAiSql(sql));
  assert.doesNotThrow(() => verifier.assertLocalAiSql(sql.replace(/ADD COLUMN\s+/g, 'ADD /* reviewed spacing */ COLUMN ')));
  assert.throws(() => verifier.assertLocalAgentSql(sql), 'the five-table phase12 whitelist remains unchanged');
  for (const broken of [
    `${sql}\nDROP TABLE "Paper";`, `${sql}\nDELETE FROM "Paper";`,
    `${sql}\nUPDATE "Paper" SET "title" = 'changed';`, `${sql}\nTRUNCATE "Team";`,
    `${sql}\nALTER TABLE "Team" ADD COLUMN "unsafe" TEXT;`,
    `${sql}\nALTER TABLE "Paper" ADD COLUMN "unsafe" TEXT;`,
    `${sql}\nCREATE TABLE "Other" ("id" TEXT);`, `${sql}\nSET search_path = other;`,
    `${sql}\nCREATE INDEX "Unexpected" ON "ResearchConversation"("title");`,
    `${sql}\nCREATE INDEX "ResearchConversation_memberId_teamId_updatedAt_idx" ON "ResearchConversation"("memberId", "teamId", "updatedAt");`,
    sql.replace('"analysisError" TEXT', '"analysisError" INTEGER'),
    sql.replace('ADD COLUMN     "sourceDigest" TEXT,', ''),
    sql.replace("DEFAULT 'question'", "DEFAULT 'chat'"),
    sql.replace('"paperIds" JSONB NOT NULL', '"paperIds" TEXT NOT NULL'),
    sql.replace('CREATE TABLE "ResearchConversation"', 'CREATE TABLE "DifferentConversation"'),
    sql.replace('CREATE UNIQUE INDEX "LocalAgentJob_conversationId_conversationTurn_key"', 'CREATE INDEX "LocalAgentJob_conversationId_conversationTurn_key"'),
    sql.replace('ON DELETE SET NULL', 'ON DELETE CASCADE'),
    sql.replace('REFERENCES "Team"', 'REFERENCES "Member"'),
    sql.replace("DEFAULT 'question'", "DEFAULT 'quest''ion'"),
    `${sql}\n/* unterminated`,
  ]) assert.throws(() => verifier.assertLocalAiSql(broken));
});

test('requires a new empty disposable database rather than mutating an earlier or application schema', () => {
  assert.doesNotThrow(() => verifier.assertEmptyPostgresDatabase([{ tables: 0 }]));
  for (const rows of [[], [{ tables: 1 }], [{ tables: '0' }], [{ tables: -1 }]]) {
    assert.throws(() => verifier.assertEmptyPostgresDatabase(rows));
  }
});

test('creates only the base schema, applies phase12 then phase13 SQL, checks drift, then runs the PostgreSQL scenarios', async () => {
  const calls = [];
  await verifier.runPostgresVerification(valid(), {
    command: async (args, env) => { calls.push({ args, env }); },
    assertDisposableServer: async () => { calls.push({ identity: true }); },
  });
  assert.equal(calls.length, 8);
  assert.equal(calls[0].args[1], 'generate');
  assert.equal(calls[1].identity, true);
  assert.deepEqual(calls[2].args.slice(1, 4), ['db', 'push', '--skip-generate']);
  const basePath = calls[2].args.at(-1);
  const base = await readFile(basePath, 'utf8');
  assert.equal(/^model LocalAgent/m.test(base), false);
  assert.equal(base.includes('env("DATABASE_URL")'), false);
  assert.deepEqual(calls[3].args.slice(1, 4), ['db', 'execute', '--file']);
  assert.ok(calls[3].args[4].endsWith('20261017-local-agent-connection.sql'));
  assert.deepEqual(calls[4].args.slice(1, 4), ['db', 'execute', '--file']);
  assert.ok(calls[4].args[4].endsWith('20261017-local-ai-research-chat.sql'));
  assert.ok(calls[5].args[4].endsWith('20261018-agent-centric-foundation.sql'));
  assert.deepEqual(calls[6].args.slice(1, 3), ['migrate', 'diff']);
  assert.ok(calls[6].args.includes('--exit-code'));
  assert.ok(calls[7].args.some(value => value.endsWith('postgres.integration.test.ts')));
  assert.doesNotMatch(base, /^model ResearchConversation\b/m);
  assert.doesNotMatch(base.match(/^model Paper \{[\s\S]*?^\}/m)?.[0] ?? '', /^\s*(sourceText|sourceDigest|analysisRequestId|analysisError)\s/m);
  for (const call of calls.filter(call => call.args)) {
    assert.equal(call.env.LOCAL_AGENT_PG_TEST_URL, url);
    assert.equal(call.env.DATABASE_URL, undefined);
    assert.equal(call.args.includes('--accept-data-loss'), false);
    assert.equal(call.args.includes('reset'), false);
  }
});

test('does not create any schema or apply SQL when disposable server identity/emptiness verification fails', async () => {
  const calls = [];
  await assert.rejects(verifier.runPostgresVerification(valid(), {
    command: async args => { calls.push(args); },
    assertDisposableServer: async () => { throw new Error('non-empty disposable database'); },
  }));
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], 'generate');
});
