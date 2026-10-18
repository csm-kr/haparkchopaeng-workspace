// @vitest-environment node
import { expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { renderPdfPageToPng } from "@/lib/pdf-page-render";
import { ExportPayloadSchema } from "../export-contract";

vi.mock("@/lib/inngest", () => ({ inngest: { send: vi.fn().mockResolvedValue({ ids: ["manual-driver"] }) } }));
vi.mock("@/lib/prisma", () => {
  if (process.env.HAPARK_REAL_MODEL_SMOKE !== "1") return { prisma: {} };
  const require = createRequire(import.meta.url);
  require("../../../scripts/local-agent-verify.mjs").assertIsolatedDatabase(process.env.HAPARK_TEST_DIRECTORY,process.env.LOCAL_AGENT_TEST_DATABASE_URL);
  const { PrismaClient } = require(process.env.LOCAL_AGENT_TEST_CLIENT_MODULE!);
  return { prisma: new PrismaClient({ datasources: { db: { url: process.env.LOCAL_AGENT_TEST_DATABASE_URL } } }) };
});
const objects = vi.hoisted(() => new Map<string, Buffer>());
vi.mock("@/lib/storage", () => ({ assertGeneratedPresentationStorage: vi.fn(), downloadObject: vi.fn(async (path: string) => { const bytes = objects.get(path); if (!bytes) throw new Error("Missing fixture object"); return bytes; }), uploadGeneratedPresentation: vi.fn(async (path: string, bytes: Buffer) => { objects.set(path,bytes); }) }));
import { prisma } from "@/lib/prisma";
import { createAttempt, acknowledgeDesktop, pairDesktop, desktopHeartbeat, renewWebPermission, claimJob, submitResult, revokeSession, type LocalAgentScope } from "@/lib/local-agent/service";
import { createTask, advanceTask, getTask, continueSeminarTask, queueSeminarExport, saveTaskSeminar } from "@/lib/agent/service";
import { runSeminarExport, getSeminarExport } from "../exports";

it.skipIf(process.env.HAPARK_REAL_MODEL_SMOKE !== "1")("uses the actual installed CLI for paper-first directions, one question, outline, diagram slides, revision and native files",async () => {
  const { createProviderAdapter } = createRequire(import.meta.url)(join(process.cwd(),"connector/core/adapters.mjs"));
  const directory = join(process.env.HAPARK_TEST_DIRECTORY!,"real-model-artifacts"); await mkdir(directory,{ recursive: true });
  const adapter = createProviderAdapter("codex",{ workspaceRoot: join(directory,"cli-workspaces") });
  const snapshot = await adapter.detect(AbortSignal.timeout(30_000)); expect(snapshot.status).toBe("ready");
  const model = snapshot.models[0]; expect(model?.id).toBeTruthy();
  const scope: LocalAgentScope = { teamId: "pt-smoke-team", memberId: "pt-smoke-owner", sessionKey: "pt-smoke-session", sessionExpiresAt: new Date(Date.now()+3_600_000) };
  const paperId = "pt-smoke-paper";
  const pages = [
    "Controlled research fixture, not a published paper. Sparse routing reduces memory by activating two experts per token. This study asks whether a fixed memory budget can preserve accuracy. The source supports conditional claims only.",
    "The pipeline is input tokens, routing scores, top-two expert selection, weighted outputs. A balancing loss prevents one expert from receiving every token. The method keeps inactive expert parameters outside the activation path.",
    "In this controlled comparison, both runs use batch size 8 and sequence length 1024. The dense baseline uses 12 GB; sparse routing uses 8 GB. Accuracy is 82 percent for both runs. This single configuration does not prove general speed gains.",
    "Reproduction requires the same tokenization, batch size, expert count and hardware. Measure peak activation memory separately from stored parameters. Data loading time must be reported separately from model compute time.",
    "Limitations: one synthetic benchmark, one random seed and no distributed communication measurements. Routing imbalance can increase latency. The memory result cannot establish universal inference efficiency.",
    "Discussion: test multiple seeds and longer sequences before generalizing. Compare a matched parameter baseline and report routing utilization. The distinction between measured facts and an explanatory reconstruction must remain visible.",
  ].map((text,index) => ({ page: index+1, text }));
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  const transcript: unknown[] = [];
  try {
    await prisma.member.create({ data: { id: scope.memberId, name: "PT smoke fixture", handle: "@pt-smoke", email: "pt-smoke@test.invalid", role: "멤버", color: "var(--m-ha)", initial: "검" } });
    await prisma.team.create({ data: { id: scope.teamId, slug: "pt-smoke", name: "격리 PT 실모델 검증", createdBy: scope.memberId, memberships: { create: { memberId: scope.memberId, role: "owner" } } } });
    const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
    for (const source of pages) { const page = pdf.addPage(); page.drawText(`Source fixture page ${source.page}`,{ x: 45,y: 740,font,size: 18 }); page.drawText(source.text,{ x: 45,y: 680,font,size: 12,maxWidth: 480,lineHeight: 20 }); }
    const original = Buffer.from(await pdf.save()); objects.set("fixture.pdf",original);
    await prisma.paper.create({ data: { id: paperId, teamId: scope.teamId, title: "Controlled sparse-routing research fixture", authors: "Test fixture", pdfUrl: "fixture.pdf", uploadedBy: scope.memberId, tags: [], sourceText: JSON.stringify(pages), sourceDigest: createHash("sha256").update(original).digest("hex"), analysisStatus: "awaiting_ai" } });
    const token = Buffer.alloc(32,19).toString("base64url"), attempt = await createAttempt(scope);
    await acknowledgeDesktop({ attemptId: attempt.id, launchToken: attempt.launchToken, deviceToken: token, deviceName: "실제 CLI 검증", platform: "windows" });
    const paired = await pairDesktop({ attemptId: attempt.id, launchToken: attempt.launchToken, deviceToken: token, code: attempt.code! });
    const identity = { deviceId: paired.deviceId!, deviceToken: token };
    let metadata = snapshot, refreshing: Promise<void> | null = null;
    const refresh = () => refreshing ??= (async () => {
      if (Date.now()-Date.parse(metadata.observedAt) > 20_000) { metadata = await adapter.detect(AbortSignal.timeout(30_000)); expect(metadata.status).toBe("ready"); }
      await desktopHeartbeat(identity,[{ ...metadata, capabilities: ["agent_step_v1"] }]); await renewWebPermission(scope,identity.deviceId);
    })().finally(() => { refreshing = null; });
    await refresh(); heartbeat = setInterval(() => void refresh().catch(() => {}),10_000);
    const task = await createTask(scope,{ requestId: randomUUID(), deviceId: identity.deviceId, provider: "codex", model: model.id, effort: "low", paperId, kind: "seminar", workflow: "guided", completion: "saved_presentation", goal: "논문을 먼저 읽고 발표 방향 2~3개를 제안하자. 한 번에 질문 하나씩 대화하자. 검증용이므로 목차와 PT는 정확히 3장, 각 장의 본문은 90자 이내, 도식이나 실제 원문 표 중심으로 만들자. 원문 근거를 남기고 수치를 만들지 말자." });
    const drive = async () => {
      for (let tick=0; tick<10; tick++) {
        await refresh(); await advanceTask(task.id);
        const value = await getTask(scope,task.id);
        if (!["queued","running"].includes(value.status)) { expect(value.error).toBeNull(); return value; }
        const claim = await claimJob(identity); if (!claim) continue;
        let response = "";
        await adapter.run({ model: model.id, prompt: claim.job.prompt, context: claim.context, signal: AbortSignal.timeout(120_000), onText: (text: string) => { response += text; } });
        transcript.push({ revision: value.revision, response });
        await writeFile(join(directory,"transcript.json"),JSON.stringify(transcript,null,2));
        console.log(JSON.stringify({ stage: value.workspace?.pending, decision: transcript.length, actualModel: model.id }));
        await refresh(); await submitResult(identity,{ jobId: claim.job.id, claimToken: claim.claimToken, sequence: 1, status: "completed", response });
      }
      throw new Error("Model smoke exceeded its bounded decision budget");
    };
    let value = await drive(); expect(value.workspace?.directions.length).toBeGreaterThanOrEqual(2);
    const turn = async (input: { action: "choose"|"answer"|"outline"|"build"|"revise"; text?: string; directionId?: string }) => { value = await continueSeminarTask(scope,task.id,{ ...input, requestId: randomUUID(), expectedVersion: value.version }); value = await drive(); };
    await turn({ action: "choose", directionId: value.workspace!.directions[0].id }); expect(value.workspace?.question).not.toBeNull();
    await turn({ action: "answer", text: "재현을 할 팀원 대상이고 15분, 도식 중심으로 3장만 만들자. 구현 조건과 한계를 토론하고 싶어." });
    await turn({ action: "outline" }); expect(value.workspace?.outline).toHaveLength(3);
    await turn({ action: "build" }); expect(value.seminarDraft?.slides).toHaveLength(3);
    await turn({ action: "revise", text: "마지막 장은 실험 조건과 연구 한계에 집중해줘. 전체 3장과 도식 중심 구성은 유지하자." });
    expect(value.seminarDraft?.slides.every(slide => Boolean(slide.visual && slide.citations?.length))).toBe(true);
    let queued = await queueSeminarExport(scope,task.id,{ requestId: randomUUID(), expectedVersion: value.version, seminar: value.seminarDraft! });
    await runSeminarExport(queued.export.id);
    let artifact = await getSeminarExport(scope,task.id,queued.export.id);
    if (artifact.status === "failed") {
      value = await getTask(scope,task.id);
      await turn({ action: "revise",text: `출력 검수 오류를 고쳐줘: ${artifact.error}. 원문과 전체 3장 구성은 유지하고, 표현을 짧고 읽기 쉽게 다듬자.` });
      queued = await queueSeminarExport(scope,task.id,{ requestId: randomUUID(), expectedVersion: value.version, seminar: value.seminarDraft! });
      await runSeminarExport(queued.export.id); artifact = await getSeminarExport(scope,task.id,queued.export.id);
    }
    expect(artifact.status,artifact.error ?? "render failed").toBe("done");
    const payload = ExportPayloadSchema.parse((await prisma.job.findUniqueOrThrow({ where: { id: artifact.id } })).payload);
    const outPdf = objects.get(payload.files!.pdf.path)!;
    await writeFile(join(directory,"presentation.pdf"),outPdf); await writeFile(join(directory,"presentation.html"),objects.get(payload.files!.html.path)!);
    for (let page=0;page<3;page++) await writeFile(join(directory,`slide-${page+1}.png`),renderPdfPageToPng(outPdf,page));
    const before = await getTask(scope,task.id), saved = await saveTaskSeminar(scope,task.id,{ expectedVersion: before.version, seminar: before.seminarDraft!, artifactJobId: artifact.id }); expect(saved.savedPresentation?.verified).toBe(true);
    await writeFile(join(directory,"result.json"),JSON.stringify({ model: model.id, fixture: "controlled synthetic source; actual CLI inference", transcript, workspace: saved.workspace, export: artifact },null,2));
    console.log(JSON.stringify({ actualModel: model.id, turns: transcript.length, directory, slides: 3, verified: saved.savedPresentation?.verified, export: artifact.status }));
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    await writeFile(join(directory,"transcript.json"),JSON.stringify(transcript,null,2));
    await revokeSession(scope.sessionKey).catch(() => {}); await prisma.$disconnect();
  }
},600_000);
