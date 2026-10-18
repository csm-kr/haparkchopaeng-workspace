import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AgentTaskList } from "../task-list";
import type { AgentTaskView } from "@/types/agent-task";

const task: AgentTaskView = { id: "task", conversationId: null, version: 3, revision: 0, goal: "논문 기여와 토론 질문 정리", status: "completed", phase: "draft_ready", paper: { id: "paper", title: "연구 논문" }, draft: { title: "기여 검토", body: "원문에 근거한 질문", lens: "research", sectionId: "contributions", citations: [{ page: 1, quote: "원문에서 확인한 실제 문구입니다." }] }, error: null, savedNote: null, goalVerified: true, canCancel: false, canSave: true, canResume: true, decisionCount: 2, toolCount: 1, createdAt: "2026-10-18T00:00:00Z", updatedAt: "2026-10-18T00:01:00Z", activity: [{ id: "op", label: "원문 읽기", status: "completed", at: "2026-10-18T00:00:30Z" }] };
function show(value = task) {
  const save = vi.fn(), control = vi.fn();
  render(<AgentTaskList tasks={[value]} busyId={null} connected onSave={save} onControl={control} />);
  return { save, control };
}
describe("reviewed research task", () => {
  it("requires an explicit click to save the exact edited content and shows the target and evidence", () => {
    const { save } = show();
    expect(screen.getByText(/연구 분석.*Contribution/)).toBeInTheDocument();
    expect(screen.getByText(task.draft!.citations[0].quote)).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: "노트 본문" }), { target: { value: "검토하고 수정한 본문" } });
    fireEvent.click(screen.getByRole("button", { name: "검토한 내용 저장" }));
    expect(save).toHaveBeenCalledWith(task, { title: task.draft!.title, body: "검토하고 수정한 본문" });
  });
  it("keeps completed draft and saved result distinct, and does not report a missing note as verified", () => {
    show({ ...task, savedNote: { id: "n", href: "/papers/paper#section-contributions", verified: false }, canSave: false });
    expect(screen.getByText(/저장된 노트를 확인하지 못했어요/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "검토한 내용 저장" })).not.toBeInTheDocument();
  });
  it("distinguishes a connection wait and source changes from a running task", () => {
    show({ ...task, status: "waiting_connection", phase: "connection", canSave: false, error: "연결 권한이 끝났어요." });
    expect(screen.getByText("연결 확인 필요")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "검토한 내용 저장" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "연결 후 이어가기" })).toBeEnabled();
  });
  it("shows an editable seminar preview and registers only the explicitly reviewed deck", () => {
    const seminar = { title: "30분 세미나", durationMinutes: 30, summary: "논문의 기여와 한계를 토론한다.", keypoints: ["기여"], slides: [{ title: "문제", body: "문제의 배경" }, { title: "방법", body: "제안 방법" }, { title: "토론", body: "토론 질문" }], citations: task.draft!.citations };
    const save = vi.fn();
    render(<AgentTaskList tasks={[{ ...task, kind: "seminar", status: "waiting_review", draft: null, seminarDraft: seminar }]} busyId={null} connected onSave={vi.fn()} onControl={vi.fn()} onSeminarSave={save} />);
    expect(save).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: "세미나 제목" }), { target: { value: "검토한 발표 제목" } });
    fireEvent.click(screen.getByRole("button", { name: "검토한 세미나 등록" }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ kind: "seminar" }), expect.objectContaining({ title: "검토한 발표 제목", slides: seminar.slides }));
  });
});
