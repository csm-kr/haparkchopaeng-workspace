import { inngest } from "@/lib/inngest";
import { prisma } from "@/lib/prisma";
import { runSeminarExport } from "@/lib/seminar/exports";

export const exportSeminarFn = inngest.createFunction(
  { id: "export-seminar", retries: 2, concurrency: { limit: 1, key: "event.data.jobId" }, triggers: [{ event: "seminar/export" }] },
  async ({ event, step }) => step.run("render-and-store",() => runSeminarExport(event.data.jobId)),
);
export const reconcileSeminarExportsFn = inngest.createFunction(
  { id: "reconcile-seminar-exports", retries: 1, triggers: [{ cron: "*/2 * * * *" }] },
  async ({ step }) => {
    const jobs = await step.run("queued",() => prisma.job.findMany({ where: { type: "seminar_export", OR: [{ status: "queued", createdAt: { lt: new Date(Date.now()-120_000) } },{ status: "running", claimedAt: { lt: new Date(Date.now()-600_000) } }] }, select: { id: true }, take: 20 }));
    for (const job of jobs) await step.sendEvent(`resume-${job.id}`,{ name: "seminar/export", data: { jobId: job.id } });
    return { queued: jobs.length };
  },
);
