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
} finally { await client.$disconnect(); }
