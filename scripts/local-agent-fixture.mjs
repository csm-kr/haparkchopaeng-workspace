// Runs in a short-lived child so Windows releases the Prisma engine before restoration.
import { createRequire } from "node:module";
import { assertIsolatedDatabase } from "./local-agent-verify.mjs";

assertIsolatedDatabase(process.env.HAPARK_TEST_DIRECTORY, process.env.DATABASE_URL);
if (process.env.HAPARK_ISOLATED_TESTS !== "1" || !process.env.LOCAL_AGENT_TEST_CLIENT_MODULE) throw new Error("Isolated verifier required");
const { PrismaClient } = createRequire(import.meta.url)(process.env.LOCAL_AGENT_TEST_CLIENT_MODULE);
const client = new PrismaClient();
try {
  const team = await client.team.findUniqueOrThrow({ where: { slug: "habakjopaeng" } });
  await client.paper.create({ data: { id: "local-agent-paper", teamId: team.id,
    title: "격리 검증용 논문", authors: "Local fixture", abstract: "A local integration fixture; no external paper data.",
    pdfUrl: "fixture.pdf", uploadedBy: "jo", tags: [], analysisStatus: "ready" } });
  await client.agentTask.create({ data: { id: "seminar-ui-task", teamId: team.id, memberId: "jo", conversationId: "isolated-pt-fixture", requestId: crypto.randomUUID(), sessionKey: "isolated-ui-fixture", sessionExpiresAt: new Date(Date.now()+3_600_000), deviceId: "fixture-pc", provider: "codex", model: "fixture-model", paperId: "local-agent-paper", kind: "seminar", goal: "논문 기반 PT 제작 UI 검증", completion: "saved_presentation", draft: { version: 1, type: "paper_pt", stage: "directions", pending: "directions", directions: [], selectedDirectionId: null, question: null, outline: [], deck: null, turnCount: 0, messages: [{ id: "initial", role: "user", text: "논문を読んで発表方向を探して".replace("論文を読んで発表方向を探して", "논문을 읽고 발표 방향을 찾아줘"), at: new Date().toISOString() }], brief: { purpose: "연구 논문 설명", audience: "연구팀 동료", message: "", discussionGoal: "방법과 한계 토론", durationMinutes: 30, depth: "핵심 방법과 실험", style: "figures", assumptions: [] } } } });
} finally { await client.$disconnect(); }
