import * as React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AnalysisViewProps } from "@/components/analyzer/analysis-view";
import type { PaperDetailView } from "@/lib/papers";
import PaperDetailPage from "../page";

const mock = vi.hoisted(() => ({ session: vi.fn(), team: vi.fn(), paper: vi.fn(), member: vi.fn(), addNote: vi.fn(), deleteNote: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getSession: mock.session }));
vi.mock("@/lib/active-team", () => ({ getActiveTeam: mock.team }));
vi.mock("@/lib/papers", () => ({ getPaperDetail: mock.paper, getExpectedAnalysisMs: vi.fn().mockResolvedValue(30000) }));
vi.mock("@/lib/prisma", () => ({ prisma: { member: { findUnique: mock.member } } }));
vi.mock("../actions", () => ({ addNote: mock.addNote, deleteNote: mock.deleteNote }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); }, useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/providers/paper-notify-provider", () => ({ usePaperNotify: () => ({ onAnalyzed: () => () => {} }) }));
vi.mock("@/components/shell", () => ({ Topbar: ({ actions }: { actions: React.ReactNode }) => <header>{actions}</header> }));
vi.mock("@/components/analyzer", async () => {
  const { AnalysisView } = await vi.importActual<typeof import("@/components/analyzer/analysis-view")>("@/components/analyzer/analysis-view");
  return { AnalysisView, DeletePaperButton: () => null, PaperTitleEditable: ({ initialTitle }: { initialTitle: string }) => <h1>{initialTitle}</h1> };
});
vi.mock("@/components/local-agent/paper-analysis", () => ({ LocalPaperAnalysis: ({ initialStatus }: { initialStatus: string }) => <section aria-label="로컬 분석 실행">실행 상태 {initialStatus}</section> }));

const author = { id: "member-a", name: "연구자", initial: "연", color: "var(--m-ha)" };
const research: NonNullable<AnalysisViewProps["research"]> = {
  problem: { oneLine: "저장한 연구 문제", setting: "기존 문제 설정", assumptions: [] }, contributions: ["저장한 핵심 기여"], io: { inputs: [], outputs: [] },
  comparison: { caption: "", columns: [], rows: [] }, ablation: { caption: "", columns: [], rows: [] },
};
const repro: NonNullable<AnalysisViewProps["repro"]> = {
  data: { caption: "", columns: [], rows: [] }, model: { params: "저장한 모델 설정", items: [] }, loss: [], metrics: [], training: { caption: "", rows: [] },
  gpu: { hardware: "미확인", count: 0, vramGb: 0, vramUsedGb: 0, trainDays: 0, note: "기존 리소스 기록" },
  repo: { found: false, url: null, summary: "", tree: [], source: "paper" }, diagram: { nodes: [], edges: [] },
};
function saved(status: PaperDetailView["paper"]["analysisStatus"]): PaperDetailView {
  return {
    paper: { id: "paper-a", title: "기존 분석 논문", authors: "저자", venue: null, year: null, arxiv: null, pageCount: 2, abstract: null, pdfUrl: "private-object-key", uploadedBy: author.id, analysisStatus: status, analysisStartedAt: null },
    research, repro,
    figures: [{ id: "figure-a", title: "저장한 Figure", caption: "기존 캡션", interpretation: "기존 그림 설명", sourcePage: 1, imageUrl: null }],
    notes: [
      { id: "note-r", sectionId: "contributions", lens: "research", title: "기존 연구 노트", body: "남겨 둔 연구 의견", createdAt: "2026-10-17T00:00:00Z", author },
      { id: "note-p", sectionId: "model", lens: "repro", title: "기존 재현 노트", body: "남겨 둔 구현 의견", createdAt: "2026-10-17T00:00:00Z", author },
      { id: "note-f", sectionId: "figures", lens: "any", title: "기존 그림 노트", body: "남겨 둔 그림 의견", createdAt: "2026-10-17T00:00:00Z", author },
    ],
  };
}
beforeEach(() => {
  vi.resetAllMocks(); mock.session.mockResolvedValue({ memberId: author.id }); mock.team.mockResolvedValue({ id: "team-a" }); mock.member.mockResolvedValue(author);
});
afterEach(cleanup);

it.each(["pending", "failed", "awaiting_ai"] as const)("재분석 %s에서도 저장한 두 관점·Figure·작성자 노트를 계속 읽는다", async (status) => {
  mock.paper.mockResolvedValue(saved(status));
  render(await PaperDetailPage({ params: Promise.resolve({ id: "paper-a" }) }));
  expect(screen.getByRole("region", { name: "로컬 분석 실행" })).toHaveTextContent(`실행 상태 ${status}`);
  expect(screen.getByText("저장한 핵심 기여")).toBeInTheDocument();
  expect(screen.getByText("남겨 둔 연구 의견")).toBeInTheDocument();
  expect(screen.getByText("저장한 Figure")).toBeInTheDocument();
  expect(screen.getByText("남겨 둔 그림 의견")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /재구현 분석/ }));
  expect(screen.getByText(/저장한 모델 설정/)).toBeInTheDocument();
  expect(screen.getByText("남겨 둔 구현 의견")).toBeInTheDocument();
  expect(screen.getByText("저장한 Figure")).toBeInTheDocument();
  expect(screen.getByText("남겨 둔 그림 의견")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "다시 분석" })).toBeNull();
  expect(mock.paper).toHaveBeenCalledWith("paper-a", "team-a");
});

it("최초 분석에 저장 결과가 없으면 로컬 실행 카드만 표시한다", async () => {
  mock.paper.mockResolvedValue({ ...saved("awaiting_ai"), research: null, repro: null, figures: [], notes: [] });
  render(await PaperDetailPage({ params: Promise.resolve({ id: "paper-a" }) }));
  expect(screen.getByRole("region", { name: "로컬 분석 실행" })).toBeInTheDocument();
  expect(screen.queryByRole("group", { name: "분석 관점" })).toBeNull();
  expect(screen.queryByRole("button", { name: "다시 분석" })).toBeNull();
});

it("관점 payload 없이 남은 Figure와 공통 작성자 노트도 보존한다", async () => {
  const detail = saved("failed");
  mock.paper.mockResolvedValue({ ...detail, research: null, repro: null, notes: detail.notes.filter((note) => note.lens === "any") });
  render(await PaperDetailPage({ params: Promise.resolve({ id: "paper-a" }) }));
  expect(screen.getByText("저장한 Figure")).toBeInTheDocument();
  expect(screen.getByText("남겨 둔 그림 의견")).toBeInTheDocument();
});
