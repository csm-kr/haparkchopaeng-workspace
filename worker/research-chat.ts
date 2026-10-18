import { inngest } from "@/lib/inngest";
import { failChatPreparation, prepareChatTurn } from "@/lib/research-chat/preparation";

export const prepareResearchChatFn = inngest.createFunction(
  { id: "prepare-research-chat", retries: 3, triggers: [{ event: "research-chat/prepare" }],
    onFailure: async ({ event }) => { await failChatPreparation(event.data.event.data.jobId, event.data.error); },
  },
  async ({ event, step }) => {
    await step.run("prepare-material-context", () => prepareChatTurn(event.data.jobId));
    return { jobId: event.data.jobId };
  },
);
