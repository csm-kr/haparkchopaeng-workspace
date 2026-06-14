import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AnalysisView, type NoteView } from "../analysis-view";
import type { ReproPayload, ResearchPayload } from "@/types";

// next/navigation을 고정 — 재분석 후 router.refresh 호출만 확인한다.
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

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
  it("연구 관점에선 figure가 보이고, 재구현 관점에선 숨는다", () => {
    renderView();
    // 연구 관점에서 figure 노출.
    expect(screen.getByText("Figure 1 — 개요")).toBeInTheDocument();
    expect(screen.getByText("원문 PDF p.3에서 추출")).toBeInTheDocument();

    // 재구현으로 토글하면 figure 섹션이 사라진다(figure는 연구 관점 전용).
    fireEvent.click(screen.getByRole("button", { name: /재구현 분석/ }));
    expect(screen.queryByText("Figure 1 — 개요")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Figure 분석" })).toBeNull();
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
  it("pending이면 섹션 대신 '읽고 있어요' 상태를 보인다", () => {
    renderView({ analysisStatus: "pending", research: null, repro: null });
    expect(screen.getByText("논문을 읽고 있어요…")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Contribution" })).toBeNull();
  });

  it("pending 동안 주기적으로 router.refresh로 자동 갱신한다", () => {
    vi.useFakeTimers();
    refresh.mockClear();
    try {
      renderView({ analysisStatus: "pending", research: null, repro: null });
      // 마운트 직후엔 아직 호출 없음.
      expect(refresh).not.toHaveBeenCalled();
      // 인터벌마다 새로고침해 ready 전이를 자동 반영.
      act(() => {
        vi.advanceTimersByTime(4000);
      });
      expect(refresh).toHaveBeenCalledTimes(1);
      act(() => {
        vi.advanceTimersByTime(4000);
      });
      expect(refresh).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
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
