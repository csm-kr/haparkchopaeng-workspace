import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AnalysisView, type NoteView } from "../analysis-view";
import { PaperNotifyProvider } from "@/components/providers/paper-notify-provider";
import type { ReproPayload, ResearchPayload } from "@/types";

// next/navigation을 고정 — 재분석/자동갱신 시 router.refresh 호출을 확인한다.
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

// 논문 알림 채널 모킹 — 분석 완료 push 시 열린 상세가 자동 갱신되는지 검증한다.
type PMsg = { payload?: { paperId: string; title: string } };
const paperHandlers: Record<string, (m: PMsg) => void> = {};
const { createBrowserSupabaseMock } = vi.hoisted(() => ({
  createBrowserSupabaseMock: vi.fn(),
}));
vi.mock("@/lib/supabase/browser", () => ({
  createBrowserSupabase: createBrowserSupabaseMock,
}));
function fakePaperSupabase() {
  const channel = {
    on(_t: string, opts: { event: string }, cb: (m: PMsg) => void) {
      paperHandlers[opts.event] = cb;
      return channel;
    },
    subscribe() {
      return channel;
    },
  };
  return { channel: () => channel, removeChannel: vi.fn() };
}

beforeEach(() => {
  for (const k of Object.keys(paperHandlers)) delete paperHandlers[k];
});

// AnalysisView — 두 관점 토글·figure 공통 렌더·섹션 노트(검증/작성자/lens=any).
// 읽기 데이터는 props로, 노트 쓰기는 주입한 mock 액션으로 검증한다(ADR-015).

const research: ResearchPayload = {
  problem: {
    oneLine: "원라인 문제",
    setting: "문제 세팅 설명",
    assumptions: ["가정 1"],
  },
  contributions: ["기여 1", "기여 2"],
  io: {
    inputs: [{ name: "입력 x", type: "int[L]", desc: "토큰 시퀀스" }],
    outputs: [{ name: "출력 y", type: "float[L]", desc: "로짓" }],
  },
  comparison: {
    caption: "비교표",
    columns: ["방법", "점수"],
    rows: [
      { cells: ["A", "1"], highlight: false },
      { cells: ["B", "2"], highlight: true },
    ],
  },
  ablation: { caption: "애블", columns: ["설정", "변화"], rows: [{ cells: ["x", "-1%"], highlight: false }] },
};

const repro: ReproPayload = {
  data: { caption: "데이터표", columns: ["셋", "규모"], rows: [{ cells: ["코퍼스", "200B"], highlight: false }] },
  model: { params: "220M", items: [{ name: "구조", desc: "디코더" }] },
  loss: [{ name: "CE", expr: "-log p", desc: "교차엔트로피" }],
  metrics: [{ name: "PPL", desc: "퍼플렉서티" }],
  training: { caption: "하이퍼파라미터", rows: [["Optimizer", "AdamW"]] },
  gpu: { hardware: "A100", count: 16, vramGb: 80, vramUsedGb: 58, trainDays: 3, note: "추정" },
  repo: {
    found: true,
    url: "https://github.com/acme/model",
    summary: "공식 구현 저장소",
    tree: [{ name: "src/model.py", desc: "모델 정의" }],
    source: "repo",
  },
  diagram: {
    nodes: [
      { id: "in", label: "입력 데이터", detail: "토큰 시퀀스", group: "data" },
      { id: "enc", label: "Encoder", detail: "12-layer Transformer", group: "model" },
    ],
    edges: [{ from: "in", to: "enc", label: "임베딩" }],
  },
};

const figures = [
  {
    id: "f1",
    title: "Figure 1 — 개요",
    caption: "캡션",
    interpretation: "해석 텍스트",
    sourcePage: 3,
    imageUrl: null,
  },
];

const currentUser = { id: "jo", name: "조성민", initial: "조", color: "var(--m-jo)" };

const baseNotes: NoteView[] = [
  {
    id: "n1",
    sectionId: "contributions",
    lens: "research",
    title: "기여 노트 제목",
    body: "기여 노트 본문",
    createdAt: "2026-06-13T00:00:00.000Z",
    author: { id: "ha", name: "하수현", initial: "하", color: "var(--m-ha)" },
  },
  {
    id: "nf",
    sectionId: "figures",
    lens: "any",
    title: "피규어 노트",
    body: "피규어 노트 본문",
    createdAt: "2026-06-13T00:00:00.000Z",
    author: { id: "ha", name: "하수현", initial: "하", color: "var(--m-ha)" },
  },
];

function renderView(overrides: Partial<React.ComponentProps<typeof AnalysisView>> = {}) {
  const addNote = vi.fn(async (input) => ({
    id: "server-id",
    sectionId: input.sectionId,
    lens: input.lens,
    title: input.title,
    body: input.body,
    createdAt: "2026-06-13T01:00:00.000Z",
    author: currentUser,
  }));
  const deleteNote = vi.fn(async () => {});
  render(
    <AnalysisView
      paperId="p1"
      analysisStatus="ready"
      research={research}
      repro={repro}
      figures={figures}
      notes={baseNotes}
      currentUser={currentUser}
      addNote={addNote}
      deleteNote={deleteNote}
      {...overrides}
    />,
  );
  return { addNote, deleteNote };
}

describe("AnalysisView 관점 토글", () => {
  it("연구↔재구현 섹션을 전환한다", () => {
    renderView();
    // 기본은 연구 관점.
    expect(screen.getByRole("heading", { name: "Contribution" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "데이터" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /재구현 분석/ }));

    expect(screen.getByRole("heading", { name: "데이터" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "모델" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Contribution" })).toBeNull();
  });
});

describe("AnalysisView Figure 분석", () => {
  it("두 관점 모두에서 figure가 공통으로 보인다", () => {
    renderView();
    // 연구 관점에서 figure 노출.
    expect(screen.getByText("Figure 1 — 개요")).toBeInTheDocument();
    expect(screen.getByText("원문 PDF p.3에서 추출")).toBeInTheDocument();

    // 재구현으로 토글해도 figure는 그대로.
    fireEvent.click(screen.getByRole("button", { name: /재구현 분석/ }));
    expect(screen.getByText("Figure 1 — 개요")).toBeInTheDocument();
    expect(screen.getByText("원문 PDF p.3에서 추출")).toBeInTheDocument();
  });
});

describe("AnalysisView 섹션 노트", () => {
  it("노트를 작성자와 함께 표시한다", () => {
    renderView();
    expect(screen.getByText("기여 노트 제목")).toBeInTheDocument();
    // 연구 관점엔 기여 노트 + figure 노트(공통)가 모두 보이므로 작성자가 2회 표기된다.
    expect(screen.getAllByText("하수현").length).toBeGreaterThan(0);
  });

  it("빈 제목/본문은 인라인 안내를 보이고 addNote를 호출하지 않는다", () => {
    const { addNote } = renderView();
    fireEvent.click(
      screen.getByRole("button", { name: "Contribution 섹션에 분석 추가" }),
    );
    // 폼이 열린 뒤 빈 채로 추가.
    fireEvent.click(screen.getByRole("button", { name: "추가" }));

    expect(screen.getByRole("alert")).toHaveTextContent("내용을 입력해주세요.");
    expect(addNote).not.toHaveBeenCalled();
  });

  it("유효한 노트는 세션 사용자로 낙관적 표시되고 addNote가 호출된다", async () => {
    const { addNote } = renderView();
    fireEvent.click(
      screen.getByRole("button", { name: "Contribution 섹션에 분석 추가" }),
    );
    fireEvent.change(screen.getByLabelText("노트 제목"), {
      target: { value: "새 노트" },
    });
    fireEvent.change(screen.getByLabelText("노트 내용"), {
      target: { value: "새 노트 본문" },
    });
    // 낙관적 추가 + 비동기 액션 해소를 act 안에서 함께 flush한다.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "추가" }));
    });

    // 낙관적으로 표시(작성자 = 현재 사용자).
    expect(screen.getByText("새 노트")).toBeInTheDocument();
    expect(screen.getAllByText("조성민").length).toBeGreaterThan(0);
    expect(addNote).toHaveBeenCalledWith({
      paperId: "p1",
      sectionId: "contributions",
      lens: "research",
      title: "새 노트",
      body: "새 노트 본문",
    });
  });

  it("Figure 섹션 노트는 lens=any로 추가된다", async () => {
    const { addNote } = renderView();
    fireEvent.click(
      screen.getByRole("button", { name: "Figure 분석 섹션에 분석 추가" }),
    );
    fireEvent.change(screen.getByLabelText("노트 제목"), {
      target: { value: "피규어 추가 노트" },
    });
    fireEvent.change(screen.getByLabelText("노트 내용"), {
      target: { value: "본문" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "추가" }));
    });

    expect(addNote).toHaveBeenCalledWith({
      paperId: "p1",
      sectionId: "figures",
      lens: "any",
      title: "피규어 추가 노트",
      body: "본문",
    });
  });
});

describe("AnalysisView 분석 상태", () => {
  it("pending이면 섹션 대신 '분석 중입니다' 상태를 보인다", () => {
    renderView({ analysisStatus: "pending", research: null, repro: null });
    expect(screen.getByText("분석 중입니다…")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Contribution" })).toBeNull();
  });

  it("pending + 시작시각·예상시간이 있으면 진행률 바를 보인다(상한 92%)", () => {
    renderView({
      analysisStatus: "pending",
      research: null,
      repro: null,
      analysisStartedAt: new Date(Date.now() - 10_000_000).toISOString(),
      expectedMs: 60_000,
    });
    const bar = screen.getByRole("progressbar");
    // 예상 시간을 한참 넘겼어도 100%로 안 차고 상한(92%)에서 멈춘다.
    expect(bar).toHaveAttribute("aria-valuenow", "92");
  });

  it("시작시각·예상시간이 없으면 진행률 바 대신 스피너로 폴백한다", () => {
    renderView({ analysisStatus: "pending", research: null, repro: null });
    expect(screen.getByText("분석 중입니다…")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("pending 중 내 논문 분석 완료를 받으면 자동 새로고침한다(비동기 갱신)", () => {
    createBrowserSupabaseMock.mockReturnValue(fakePaperSupabase());
    refresh.mockClear();
    render(
      <PaperNotifyProvider teamId="t1">
        <AnalysisView
          paperId="p1"
          analysisStatus="pending"
          research={null}
          repro={null}
          figures={[]}
          notes={[]}
          currentUser={currentUser}
          addNote={vi.fn()}
          deleteNote={vi.fn()}
        />
      </PaperNotifyProvider>,
    );

    act(() =>
      paperHandlers["paper.analyzed"]({
        payload: { paperId: "p1", title: "T" },
      }),
    );
    expect(refresh).toHaveBeenCalled();
  });

  it("다른 논문 완료 이벤트엔 새로고침하지 않는다", () => {
    createBrowserSupabaseMock.mockReturnValue(fakePaperSupabase());
    refresh.mockClear();
    render(
      <PaperNotifyProvider teamId="t1">
        <AnalysisView
          paperId="p1"
          analysisStatus="pending"
          research={null}
          repro={null}
          figures={[]}
          notes={[]}
          currentUser={currentUser}
          addNote={vi.fn()}
          deleteNote={vi.fn()}
        />
      </PaperNotifyProvider>,
    );

    act(() =>
      paperHandlers["paper.analyzed"]({
        payload: { paperId: "other", title: "T" },
      }),
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  it("failed면 다시 분석 안내를 보인다", () => {
    renderView({ analysisStatus: "failed", research: null, repro: null });
    expect(screen.getByText("분석을 못 끝냈어요")).toBeInTheDocument();
  });

  it("'다시 분석'은 reanalyze 라우트를 호출하고 새로고침한다", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    refresh.mockClear();

    renderView({ analysisStatus: "failed", research: null, repro: null });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "다시 분석" }));
    });

    // 재분석은 잡 트리거(R31) — 라우트만 호출하고 인라인 분석은 하지 않는다.
    expect(fetchMock).toHaveBeenCalledWith("/api/papers/p1/reanalyze", {
      method: "POST",
    });
    await waitFor(() => expect(refresh).toHaveBeenCalled());

    vi.unstubAllGlobals();
  });
});
