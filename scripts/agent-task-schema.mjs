import { createHash } from 'node:crypto';

/** The base must precede the reviewed goal-task DDL, without changing older models. */
export function withoutAgentTaskSchema(source) {
  const models = [];
  let result = source.replace(/^model\s+(AgentTask|AgentOperation)\s*\{[\s\S]*?^\}/gm, (_, name) => {
    if (models.includes(name)) throw new Error('Repeated goal-task model.');
    models.push(name);
    return '';
  });
  if (models.length !== 2) throw new Error('Expected both reviewed goal-task models.');
  for (const expression of [
    /^\s*agentTasks\s+AgentTask\[\][^\r\n]*$/gm,
    /^\s*seminarPresentations\s+Presentation\[\]\s+@relation\("SeminarSourcePaper"\)[^\r\n]*$/gm,
    /^\s*sourcePaperId\s+String\?[^\r\n]*$/gm,
    /^\s*sourcePaper\s+Paper\?\s+@relation\("SeminarSourcePaper"[^\r\n]*$/gm,
  ]) {
    if ([...result.matchAll(expression)].length !== 1) throw new Error('Unexpected goal-task source relation.');
    result = result.replace(expression, '');
  }
  if (/\b(?:AgentTask|AgentOperation|SeminarSourcePaper)\b/.test(result.replace(/\/\/[^\r\n]*/g, ''))) {
    throw new Error('Unreviewed goal-task reference remains in the base.');
  }
  return result;
}

/** Exact reviewed token digest: comments and whitespace are harmless; SQL changes are not. */
export function assertAgentTaskSql(source) {
  const tokens = source.match(/--[^\r\n]*|\/\*[\s\S]*?\*\/|"(?:[^"]|"")*"|'(?:[^']|'')*'|[A-Za-z_]\w*|\d+|[(),;]|\S/g) ?? [];
  const normalized = tokens.filter(token => !token.startsWith('--') && !token.startsWith('/*'))
    .map(token => /^["']/.test(token) ? token : token.toUpperCase()).join(' ');
  if (createHash('sha256').update(normalized).digest('hex') !== '427c592f7c902de372f6d09dc29c341ce223e2f46a1e595c2770d21c66103c24') {
    throw new Error('Only the reviewed two goal-task tables, source column, indexes and relations are allowed.');
  }
}
