import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createSeminarWorkspace } from "@/lib/seminar/workflow";
import type { AgentTaskView } from "@/types/agent-task";
import { SeminarWorkspace } from "../workspace";
import { AgentApiError } from "@/components/agent/client";

const mock = vi.hoisted(() => ({ preferred: false, replace: vi.fn(), open: vi.fn(), create: vi.fn(), get: vi.fn(), turn: vi.fn(), control: vi.fn(), save: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mock.replace, refresh: vi.fn() }) }));
vi.mock("@/components/local-agent/provider", () => ({ useLocalAgent: () => ({ phase: "connected", device: { id: "pc", providers: [{ provider: "codex", status: "ready", models: [{ id: "model", name: "Model" }, { id: "chosen-model", name: "Chosen model" }] }] }, selectedModel: { provider: "codex", model: "model" }, chatTarget: mock.preferred ? { provider: "codex", model: "chosen-model" } : null, effort: "medium", open: mock.open }) }));
vi.mock("../client", () => ({ seminarApi: { create: mock.create, get: mock.get, turn: mock.turn, control: mock.control, save: mock.save } }));
const papers = [{ id: "paper", title: "희소 라우팅 논문", sourceReady: true }];
const makeTask = (): AgentTaskView => ({ id: "task", kind: "seminar", conversationId: null, version: 2, revision: 0, goal: "논문으로 PT 만들기", status: "waiting_input", phase: "seminar_interview", paper: { id: "paper", title: papers[0].title }, draft: null, seminarDraft: null, savedNote: null, error: null, goalVerified: false, canCancel: true, canSave: false, canResume: true, decisionCount: 1, toolCount: 2, createdAt: "2026-10-18T00:00:00Z", updatedAt: "2026-10-18T00:00:00Z", activity: [], workspace: { ...createSeminarWorkspace("논문으로 PT 만들기"), pending: null, stage: "interview", selectedDirectionId: "method", question: { id: "depth", text: "어떤 깊이로 설명할까요?", options: [{ id: "core", label: "핵심 개념" }, { id: "repro", label: "재현 단계" }], recommendedId: "repro", reason: "팀의 재현 목표와 맞아요." } } });

describe("전용 논문 PT 제작 공간", () => {
  it("uses the model chosen in current connection settings instead of an older analysis selection", async () => {
    mock.preferred = true;
    mock.create.mockClear();
    mock.create.mockResolvedValue(makeTask());
    mock.get.mockResolvedValue(makeTask());
    try {
      render(<SeminarWorkspace teamId="team" papers={papers} />);
      fireEvent.change(screen.getByRole("combobox", { name: "발표할 논문" }), { target: { value: "paper" } });
      fireEvent.click(screen.getByRole("button", { name: "논문 읽고 시작하기" }));
      await waitFor(() => expect(mock.create).toHaveBeenCalledWith(expect.objectContaining({ model: "chosen-model" })));
    } finally { mock.preferred = false; }
  });
  it("starts by selecting the actual paper, then asks the agent to read and propose directions", async () => {
    mock.create.mockResolvedValue({ ...makeTask(), status: "queued" });
    mock.get.mockResolvedValue(makeTask());
    render(<SeminarWorkspace teamId="team" papers={papers} />);
    fireEvent.change(screen.getByRole("combobox", { name: "발표할 논문" }), { target: { value: "paper" } });
    fireEvent.click(screen.getByRole("button", { name: "논문 읽고 시작하기" }));
    await waitFor(() => expect(mock.create).toHaveBeenCalledWith(expect.objectContaining({ paperId: "paper", kind: "seminar", workflow: "guided" })));
    expect(mock.replace).toHaveBeenCalledWith("/presentations/create/task");
  });
  it("shows one recommended question and sends a free answer without publishing a presentation", async () => {
    const task = makeTask(); mock.get.mockResolvedValue(task); mock.turn.mockResolvedValue({ ...task, version: 3, status: "queued" });
    render(<SeminarWorkspace teamId="team" papers={papers} initialTask={task} />);
    expect(screen.getByText("어떤 깊이로 설명할까요?")).toBeInTheDocument();
    expect(screen.getByText("추천", { exact: true })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "PT 에이전트에게 말하기" }), { target: { value: "실험을 직접 따라할 수 있게 설명해줘" } });
    fireEvent.click(screen.getByRole("button", { name: "답변 보내기" }));
    await waitFor(() => expect(mock.turn).toHaveBeenCalledWith("task", expect.objectContaining({ expectedVersion: 2, action: "answer", text: "실험을 직접 따라할 수 있게 설명해줘" })));
    expect(mock.save).not.toHaveBeenCalled();
  });
  it("clears the private workspace and paper picker when current access is revoked",async () => {
    mock.get.mockRejectedValue(new AgentApiError(403,"FORBIDDEN","현재 팀의 작업 권한이 없어요."));
    render(<SeminarWorkspace teamId="team" papers={papers} initialTask={makeTask()} />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("현재 팀의 작업 권한이 없어요."));
    expect(screen.queryByRole("textbox",{ name: "PT 에이전트에게 말하기" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox",{ name: "발표할 논문" })).not.toBeInTheDocument();
    expect(screen.queryByText(papers[0].title)).not.toBeInTheDocument();
  });
  it("sends an empty team to the real paper library registration entry",() => {
    render(<SeminarWorkspace teamId="team" papers={[]} />);
    expect(screen.getByRole("link",{ name: "논문 등록하러 가기" })).toHaveAttribute("href","/library");
  });
  it("refreshes authoritative publication verification even when task version is unchanged",async () => {
    const task = { ...makeTask(),savedPresentation: { id: "published",href: "/presentations/published",verified: true } };
    mock.get.mockResolvedValue({ ...task,savedPresentation: { ...task.savedPresentation,verified: false },goalVerified: false });
    render(<SeminarWorkspace teamId="team" papers={papers} initialTask={task} />);
    await waitFor(() => expect(screen.getByText("등록된 발표 자료의 현재 내용을 확인해주세요.")).toBeInTheDocument());
  });
  it("offers an explicit reconnect for an idle conversation from an earlier login",async () => {
    const task = { ...makeTask(),requiresReconnect: true,canCancel: false };
    mock.get.mockResolvedValue(task); mock.control.mockResolvedValue({ ...task,requiresReconnect: false,version: 3 });
    render(<SeminarWorkspace teamId="team" papers={papers} initialTask={task} />);
    expect(screen.getByRole("textbox",{ name: "PT 에이전트에게 말하기" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button",{ name: "연결 후 이어가기" }));
    await waitFor(() => expect(mock.control).toHaveBeenCalledWith("task",expect.objectContaining({ action: "resume",expectedVersion: 2,deviceId: "pc" })));
  });
  it("lets an idle conversation restart from the current source when its paper has changed",async () => {
    const task = { ...makeTask(),sourceChanged: true };
    mock.get.mockResolvedValue(task); mock.control.mockResolvedValue({ ...task,sourceChanged: false,version: 3,status: "queued" });
    render(<SeminarWorkspace teamId="team" papers={papers} initialTask={task} />);
    expect(screen.getByRole("textbox",{ name: "PT 에이전트에게 말하기" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button",{ name: "최신 원문으로 다시 시작" }));
    await waitFor(() => expect(mock.control).toHaveBeenCalledWith("task",expect.objectContaining({ action: "steer",goal: task.goal })));
  });
  it("shows a failed paper read distinctly from an active loading state",() => {
    const task = { ...makeTask(),status: "failed" as const,error: "원문을 읽지 못했어요.",workspace: createSeminarWorkspace("발표 준비") };
    mock.get.mockResolvedValue(task);
    render(<SeminarWorkspace teamId="team" papers={papers} initialTask={task} />);
    expect(screen.getByRole("heading",{ name: "발표 방향을 준비하지 못했어요." })).toBeInTheDocument();
    expect(screen.queryByText("논문에서 발표의 실마리를 찾고 있어요.")).not.toBeInTheDocument();
  });
});
