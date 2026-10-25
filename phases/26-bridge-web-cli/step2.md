# Step 2: server-active-jobs

## 읽어야 할 파일

**정본은 루트 `README.md` · `CLAUDE.md` · `PRD.md`이며, 충돌 시 이를 따른다.**

- `docs/dev/ARCHITECTURE.md`, `docs/agent/ADR.md`(ADR-034), `docs/dev/CODING_CONVENTION.md`
- `lib/local-agent/PROTOCOL.md`
- `lib/local-agent/service.ts` — `scopeWhere`, `activeJobStatuses`, `expireDeviceJobs`, `getJob`
- `app/api/local-agent/jobs/route.ts`
- `prisma/schema.prisma` — `LocalAgentJob`(purpose: question | paper_analysis | chat | agent_step), `AgentOperation.jobId`, `AgentTask.conversationId`
- step 1에서 바뀐 `types/local-agent.ts`

## 작업

TDD로 진행한다.

1. 타입: `LocalAgentActiveJobView { id; kind: "chat" | "paper_analysis" | "agent_task" | "question"; provider; model; status: "preparing" | "queued" | "running"; createdAt; href: string | null; canCancel: boolean }`
2. 서비스: `export async function listActiveJobs(scope): Promise<LocalAgentActiveJobView[]>`
   - `scopeWhere(scope)`(멤버·팀·세션) + 활성 상태 + 만료 전 작업만, 최신순 최대 10개. 조회 전에 해당 기기들의 만료 작업을 정리한다(`expireDeviceJobs`).
   - `href`: chat → `/ai-chat/{conversationId}`, paper_analysis → `/papers/{paperId}#local-paper-analysis`, agent_step → AgentOperation.jobId로 찾은 task의 conversationId가 있으면 `/ai-chat/{id}` 없으면 `/ai-chat`, question → `null`.
   - `canCancel`: chat만 true. 이유: 논문 분석·노트/세미나 작업은 자체 상태 기계가 있어 작업만 취소하면 화면 상태가 어긋난다.
   - prompt·response·context는 응답에 넣지 않는다.
3. Route: `GET /api/local-agent/jobs?active=1` — 기존 `POST`는 유지. `active=1`이 아니면 400.

## Acceptance Criteria

```bash
NODE_OPTIONS=--no-experimental-webstorage npm run test:local-agent
npx tsc --noEmit
npm run lint
```

테스트가 확인할 것: 다른 세션·멤버·팀의 작업 미노출, 완료·취소·만료 작업 미노출, kind별 href·canCancel, 응답에 prompt/response/context 없음.

## 검증 절차

AC 실행 → 아키텍처 체크리스트 → index.json step 2 갱신.

## 금지사항

- 작업 본문(prompt·response·context)을 목록에 넣지 마라. 이유: 목록은 상태 표시용이며 불필요한 데이터 노출이다.
- 논문 분석·노트 작업을 이 목록에서 직접 취소하지 마라. 이유: 각 기능의 중단 절차를 우회한다.
