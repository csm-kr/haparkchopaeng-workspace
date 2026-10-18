import { inngest } from "@/lib/inngest";
import { assertChatPreparation, beginChatPreparation, failChatPreparation, finishChatPreparation } from "@/lib/research-chat/preparation";
import { preparePdfSource, type PreparedPdfSource } from "./prepare-pdf-source";

export const prepareResearchChatFn = inngest.createFunction(
  { id: "prepare-research-chat", retries: 3, triggers: [{ event: "research-chat/prepare" }],
    onFailure: async ({ event }) => { await failChatPreparation(event.data.event.data.jobId, event.data.error); },
  },
  async ({ event, step }) => {
    const plan = await step.run("begin-material-preparation", () => beginChatPreparation(event.data.jobId));
    if (!plan) return { jobId: event.data.jobId };
    const prepared: PreparedPdfSource[] = [];
    for (const [kind, ids] of [["paper", plan.paperIds], ["presentation", plan.presentationIds]] as const) {
      for (const id of ids) {
        prepared.push(await preparePdfSource({ kind, id, teamId: plan.teamId }, step, () => assertChatPreparation(plan)));
      }
    }
    await step.run("finish-material-preparation", () => finishChatPreparation(plan, prepared));
    return { jobId: event.data.jobId };
  },
);
