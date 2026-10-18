import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assertAgentTaskSql, withoutAgentTaskSchema } from './agent-task-schema.mjs';

test('goal-task DDL accepts the exact reviewed addition and rejects deletions or changed relations', async () => {
  const sql = await readFile(new URL('../docs/dev/sql/20261018-agent-centric-foundation.sql', import.meta.url), 'utf8');
  assert.doesNotThrow(() => assertAgentTaskSql(sql));
  assert.doesNotThrow(() => assertAgentTaskSql(sql.replace('ADD COLUMN', 'ADD /* spacing */ COLUMN')));
  for (const altered of [
    `${sql}\nDROP TABLE "Paper";`, `${sql}\nDELETE FROM "AgentTask";`,
    `${sql}\nALTER TABLE "Member" ADD COLUMN "unsafe" TEXT;`,
    sql.replace('"sourcePaperId" TEXT', '"sourcePaperId" INTEGER'),
    sql.replace('ON DELETE SET NULL', 'ON DELETE CASCADE'),
    sql.replace('"memberId" TEXT NOT NULL', '"memberId" TEXT'),
    sql.replace("DEFAULT 'medium'", "DEFAULT 'high'"),
    `${sql}\n/* incomplete`,
  ]) assert.throws(() => assertAgentTaskSql(altered));
});

test('base stripping fails closed when goal models or source relations are incomplete', async () => {
  const source = await readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
  assert.doesNotThrow(() => withoutAgentTaskSchema(source));
  for (const altered of [
    source.replace(/^model AgentTask \{[\s\S]*?^\}/m, ''),
    source.replace(/^\s*sourcePaperId\s+String\?.*$/m, ''),
    source.replace(/^\s*agentTasks\s+AgentTask\[\].*$/m, ''),
    `${source}\nmodel Unsafe {\n id String @id\n goal AgentTask\n}\n`,
  ]) assert.throws(() => withoutAgentTaskSchema(altered));
});
