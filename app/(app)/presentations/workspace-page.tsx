import { redirect } from "next/navigation";
import { Topbar } from "@/components/shell";
import { SeminarWorkspace } from "@/components/seminar/workspace";
import { getConnectionSession } from "@/lib/auth";
import { getActiveTeam } from "@/lib/active-team";
import { getTask } from "@/lib/agent/service";
import { listResearchPapers } from "@/lib/research-chat/service";
import type { AgentTaskView } from "@/types/agent-task";
import type { ResearchPaperOption } from "@/types/research-chat";
import { HttpError } from "@/lib/http";

export async function SeminarWorkspacePage({ taskId, paperId }: { taskId?: string; paperId?: string } = {}) {
  const session = await getConnectionSession(); if (!session) redirect("/");
  const team = await getActiveTeam(session.memberId); if (!team) redirect("/teams");
  const scope = { memberId: session.memberId, teamId: team.id, sessionKey: session.sessionKey, sessionExpiresAt: session.expiresAt };
  let papers: ResearchPaperOption[] = [], task: AgentTaskView | null = null, error: string | null = null;
  try { [papers, task] = await Promise.all([listResearchPapers(scope), taskId ? getTask(scope, taskId) : Promise.resolve(null)]); if (task && !task.workspace) throw new HttpError(404, "NOT_FOUND", "이 작업은 PT 제작 대화가 아니에요."); }
  catch (cause) { error = cause instanceof HttpError ? cause.message : "PT 제작 공간을 불러오지 못했어요. 잠시 뒤 다시 확인해주세요."; task = null; }
  return <><Topbar crumbs={[{ label: "발표 자료", href: "/presentations" }, { label: "PT 만들기" }]} /><SeminarWorkspace teamId={team.id} papers={papers} initialTask={task} initialPaperId={papers.some(paper => paper.id === paperId) ? paperId : undefined} initialError={error} enabled={process.env.AGENT_TASKS_ENABLED === "1"} /></>;
}
