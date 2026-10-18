"use client";
import * as React from "react";
import type { AgentSeminarDraft, AgentTaskInput, AgentTaskView } from "@/types/agent-task";
import { AgentApiError, agentTaskApi, type TaskControl, type TaskExecution } from "./client";

export function useAgentTasks(enabled: boolean, conversationId?: string) {
  const [tasks, setTasks] = React.useState<AgentTaskView[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const scopeKey = enabled ? conversationId ?? "new" : "disabled";
  const [loadedScope, setLoadedScope] = React.useState(scopeKey);
  const generation = React.useRef(0);
  const busy = React.useRef(false);
  const pending = React.useRef<{ fingerprint: string; requestId: string } | null>(null);
  const blocked = React.useRef(false);
  const valid = (value: number) => generation.current === value;
  function merge(values: AgentTaskView[]) {
    setTasks(previous => {
      const next = new Map(previous.map(task => [task.id, task]));
      for (const task of values) if ((next.get(task.id)?.version ?? -1) <= task.version) next.set(task.id, task);
      return [...next.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 10);
    });
  }
  function fail(cause: unknown) {
    setError(cause instanceof AgentApiError ? cause.message : "작업 상태를 확인하지 못했어요. 같은 요청으로 다시 시도해주세요.");
    if (cause instanceof AgentApiError && (cause.status === 401 || cause.code === "FORBIDDEN")) { blocked.current = true; setTasks([]); pending.current = null; }
  }
  React.useEffect(() => {
    const epoch = ++generation.current;
    setLoadedScope(scopeKey);
    busy.current = false; blocked.current = false; pending.current = null; setTasks([]); setError(null); setBusyId(null);
    setLoading(enabled);
    if (enabled) void agentTaskApi.list(conversationId).then(values => { if (valid(epoch)) merge(values); }).catch(cause => { if (valid(epoch)) fail(cause); }).finally(() => { if (valid(epoch)) setLoading(false); });
    return () => { generation.current = epoch + 1; };
  }, [enabled, conversationId, scopeKey]);
  const polling = tasks.some(task => ["queued", "running"].includes(task.status));
  React.useEffect(() => {
    if (!enabled || !polling || blocked.current) return;
    const epoch = generation.current; let fetching = false, stopped = false;
    const refresh = async () => {
      if (fetching || stopped) return;
      fetching = true;
      try { const values = await agentTaskApi.list(conversationId); if (!stopped && valid(epoch)) { merge(values); setError(null); } }
      catch (cause) { if (!stopped && valid(epoch)) fail(cause); }
      finally { fetching = false; }
    };
    const timer = setInterval(() => void refresh(), 1000);
    window.addEventListener("focus", refresh);
    return () => { stopped = true; clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [enabled, conversationId, polling]);

  async function perform(id: string, action: () => Promise<AgentTaskView>) {
    if (!enabled || blocked.current || busy.current) return false;
    const epoch = generation.current; busy.current = true; setBusyId(id); setError(null);
    try { const task = await action(); if (!valid(epoch)) return false; merge([task]); return true; }
    catch (cause) { if (valid(epoch)) fail(cause); return false; }
    finally { if (valid(epoch)) { busy.current = false; setBusyId(null); } }
  }
  async function start(input: Omit<AgentTaskInput, "requestId" | "conversationId">) {
    const value = { ...input, ...(conversationId ? { conversationId } : {}) };
    const fingerprint = JSON.stringify(value);
    if (pending.current?.fingerprint !== fingerprint) pending.current = { fingerprint, requestId: crypto.randomUUID() };
    const requestId = pending.current.requestId;
    const accepted = await perform("new", () => agentTaskApi.create({ ...value, requestId }));
    if (accepted) pending.current = null;
    return accepted;
  }
  const save = (task: AgentTaskView, content: { title: string; body: string }) => perform(task.id, () => agentTaskApi.save(task.id, { expectedVersion: task.version, ...content }));
  const saveSeminar = (task: AgentTaskView, seminar: AgentSeminarDraft) => perform(task.id, () => agentTaskApi.saveSeminar(task.id, { expectedVersion: task.version, seminar }));
  const control = (task: AgentTaskView, input: Pick<TaskControl, "action" | "goal">, target?: TaskExecution | null) => perform(task.id, () => agentTaskApi.control(task.id, { ...input, expectedVersion: task.version, ...(input.action === "cancel" ? {} : target ?? {}) }));
  async function refresh() {
    const epoch = generation.current;
    try { const values = await agentTaskApi.list(conversationId); if (valid(epoch)) { merge(values); setError(null); } } catch (cause) { if (valid(epoch)) fail(cause); }
  }
  const currentScope = loadedScope === scopeKey;
  return { tasks: currentScope ? tasks : [], error: currentScope ? error : null, busyId: currentScope ? busyId : null, loading: !currentScope || loading, start, save, saveSeminar, control, refresh };
}
