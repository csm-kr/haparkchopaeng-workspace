import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AgentTaskView } from "@/types/agent-task";
const api = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), control: vi.fn(), save: vi.fn() }));
vi.mock("../client", () => ({ agentTaskApi: api, AgentApiError: class extends Error {} }));
import { useAgentTasks } from "../use-agent-tasks";

describe("task scope during navigation", () => {
  it("never renders a previous conversation's tasks in the new conversation, including before effects", async () => {
    const task = { id: "private-a", conversationId: "a", status: "completed", version: 1, updatedAt: new Date().toISOString() } as AgentTaskView;
    api.list.mockResolvedValueOnce([task]).mockImplementationOnce(() => new Promise(() => {}));
    const renders: { scope: string; ids: string[] }[] = [];
    const hook = renderHook(({ conversationId }) => { const work = useAgentTasks(true, conversationId); renders.push({ scope: conversationId, ids: work.tasks.map(item => item.id) }); return work; }, { initialProps: { conversationId: "a" } });
    await waitFor(() => expect(hook.result.current.tasks).toHaveLength(1));
    hook.rerender({ conversationId: "b" });
    expect(renders.filter(render => render.scope === "b").every(render => render.ids.length === 0)).toBe(true);
  });
});
