import { inngest } from "@/lib/inngest";
import { prisma } from "@/lib/prisma";
import { advanceTask, agentSourceTarget, failAgentSource } from "@/lib/agent/service";
import { preparePdfSource } from "./prepare-pdf-source";
import { HttpError } from "@/lib/http";

export const runAgentTaskFn = inngest.createFunction(
  { id: "run-agent-task", retries: 3, concurrency: { limit: 1, key: "event.data.taskId" }, triggers: [{ event: "agent-task/run" }],
    onFailure: async ({ event }) => {
      const { taskId, revision } = event.data.event.data;
      if (!Number.isInteger(revision)) return;
      await prisma.agentTask.updateMany({ where: { id: taskId, revision, status: { in: ["queued", "running"] } }, data: { status: "failed", phase: "failed", error: "작업을 이어가지 못했어요. 저장된 초안을 확인하고 다시 준비해주세요.", version: { increment: 1 } } });
    },
  },
  async ({ event, step }) => {
    if (!Number.isInteger(event.data.revision)) return { taskId: event.data.taskId, status: "stopped" };
    try {
      const target = await step.run("paper-source-target", () => agentSourceTarget(event.data.taskId, event.data.revision));
      if (target) await preparePdfSource(target, step, async () => {
        if (!await agentSourceTarget(event.data.taskId, event.data.revision)) throw new HttpError(409, "TASK_CHANGED", "작업 상태가 바뀌었어요.");
      });
    } catch (cause) {
      await step.run("source-failed", () => failAgentSource(event.data.taskId, event.data.revision, cause));
      return { taskId: event.data.taskId, status: "source_failed" };
    }
    for (let tick = 0; tick < 360; tick++) {
      const task = await step.run(`advance-${tick}`, () => advanceTask(event.data.taskId, event.data.revision));
      if (!task || task.revision !== event.data.revision || !["queued", "running"].includes(task.status)) return { taskId: event.data.taskId, status: task?.status ?? "stopped" };
      await step.sleep(`wait-${tick}`, "2s");
    }
    return { taskId: event.data.taskId, status: "timeout" };
  },
);

/** Recover a committed task whose initial event was lost. Never renews a web grant. */
export const reconcileAgentTasksFn = inngest.createFunction(
  { id: "reconcile-agent-tasks", retries: 1, triggers: [{ cron: "*/2 * * * *" }] },
  async ({ step }) => {
    if (process.env.AGENT_TASKS_ENABLED !== "1") return { queued: 0 };
    const ids = await step.run("pending-tasks", async () => prisma.agentTask.findMany({ where: { status: { in: ["queued", "running"] }, updatedAt: { lt: new Date(Date.now() - 120_000) } }, select: { id: true, revision: true }, take: 20 }));
    for (const task of ids) await step.sendEvent(`resume-${task.id}`, { name: "agent-task/run", data: { taskId: task.id, revision: task.revision } });
    return { queued: ids.length };
  },
);
