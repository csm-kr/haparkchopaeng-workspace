// ============================================
// 하박조팽 — 논문 분석기 (Analyzer)
// 연구 분석 ⇄ 재구현 분석 두 렌즈 · 레이아웃 변형 (stack / grid / toc)
// ============================================
/* eslint-disable */
const { useState: useAnState, useRef: useAnRef } = React;

// ---- small building blocks ----
function AnBadge({ children }) {
  return <span className="ai-badge"><Icon name="sparkles" size={10} /> {children || "AI"}</span>;
}

function DataTable({ spec }) {
  if (!spec) return null;
  return (
    <div className="dtable-wrap">
      <table className="dtable">
        <thead>
          <tr>{spec.columns.map((c, i) => <th key={i} className={i === 0 ? "lead" : ""}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {spec.rows.map((r, ri) => (
            <tr key={ri} className={r.highlight ? "hl" : ""}>
              {r.cells.map((cell, ci) => (
                <td key={ci} className={ci === 0 ? "lead" : ""}>
                  {r.highlight && ci === 0 && <span className="dtable-star">★</span>}
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {spec.caption && <div className="dtable-cap">{spec.caption}</div>}
    </div>
  );
}

// ---- section renderers ----
function renderResearch(id, R, paper) {
  switch (id) {
    case "problem":
      return (
        <>
          <div className="an-hero">{R.problem.oneLine}</div>
          <p className="an-text">{R.problem.setting}</p>
          <div className="an-assume">
            <div className="an-assume-label">전제 / 셋업</div>
            <ul className="an-list">{R.problem.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul>
          </div>
        </>
      );
    case "contrib":
      return (
        <ol className="contrib-list">
          {R.contributions.map((c, i) => (
            <li key={i}><span className="contrib-num">{i + 1}</span><span>{c}</span></li>
          ))}
        </ol>
      );
    case "io":
      return (
        <div className="io-flow">
          <div className="io-col">
            <div className="io-head io-in">INPUT</div>
            {R.io.inputs.map((x, i) => (
              <div className="io-item" key={i}>
                <div className="io-name">{x.name}<code>{x.type}</code></div>
                <div className="io-desc">{x.desc}</div>
              </div>
            ))}
          </div>
          <div className="io-arrow"><Icon name="chevron-right" size={20} /></div>
          <div className="io-col">
            <div className="io-head io-out">OUTPUT</div>
            {R.io.outputs.map((x, i) => (
              <div className="io-item" key={i}>
                <div className="io-name">{x.name}<code>{x.type}</code></div>
                <div className="io-desc">{x.desc}</div>
              </div>
            ))}
          </div>
        </div>
      );
    case "comparison":
      return <DataTable spec={R.comparison} />;
    case "ablation":
      return R.ablation ? <DataTable spec={R.ablation} /> : <div className="an-empty">이 논문은 ablation 표가 제공되지 않았어요.</div>;
    case "figures":
      return (
        <div className="fig-grid">
          {R.figures.map(f => (
            <div className="fig-card" key={f.id}>
              <div className="fig-src"><Icon name="file" size={11} /> 원문 PDF{f.page ? ` p.${f.page}` : ""}에서 추출</div>
              <image-slot
                id={`fig-${paper.id}-${f.id}`}
                shape="rounded"
                radius="8"
                style={{ width: "100%", height: "150px", display: "block" }}
                placeholder={`${f.title} — PDF에서 추출된 그림`}
              ></image-slot>
              <div className="fig-body">
                <div className="fig-title">{f.title}</div>
                <div className="fig-cap">{f.caption}</div>
                <div className="fig-interp"><AnBadge>설명</AnBadge> {f.interpretation}</div>
              </div>
            </div>
          ))}
        </div>
      );
    default: return null;
  }
}

function renderRepro(id, P) {
  switch (id) {
    case "data":
      return <DataTable spec={P.data} />;
    case "model":
      return (
        <>
          <div className="spec-pill">파라미터 규모 · {P.model.params}</div>
          <div className="kv-list">
            {P.model.items.map((m, i) => (
              <div className="kv-row" key={i}><div className="kv-k">{m.name}</div><div className="kv-v">{m.desc}</div></div>
            ))}
          </div>
        </>
      );
    case "loss":
      return (
        <div className="loss-list">
          {P.loss.map((l, i) => (
            <div className="loss-item" key={i}>
              <div className="loss-head">{l.name}</div>
              <code className="loss-expr">{l.expr}</code>
              <div className="loss-desc">{l.desc}</div>
            </div>
          ))}
        </div>
      );
    case "metrics":
      return (
        <div className="kv-list">
          {P.metrics.map((m, i) => (
            <div className="kv-row" key={i}><div className="kv-k mono">{m.name}</div><div className="kv-v">{m.desc}</div></div>
          ))}
        </div>
      );
    case "training":
      return (
        <div className="spec-sheet">
          {P.training.rows.map((row, i) => (
            <div className="spec-row" key={i}><span className="spec-k">{row[0]}</span><span className="spec-v mono">{row[1]}</span></div>
          ))}
          {P.training.caption && <div className="dtable-cap" style={{ padding: "8px 12px 0" }}>{P.training.caption}</div>}
        </div>
      );
    case "testing":
      return <ul className="an-list">{P.testing.map((t, i) => <li key={i}>{t}</li>)}</ul>;
    case "gpu":
      return <GpuViz gpu={P.gpu} />;
    default: return null;
  }
}

function GpuViz({ gpu }) {
  const pct = Math.round((gpu.vramUsedGb / gpu.vramGb) * 100);
  return (
    <div className="gpu-viz">
      <div className="gpu-cards">
        <div className="gpu-card">
          <div className="gpu-val">{gpu.hardware}</div>
          <div className="gpu-lbl">하드웨어</div>
          <div className="gpu-chips">
            {Array.from({ length: Math.min(gpu.count, 8) }).map((_, i) => (
              <span className="gpu-chip" key={i} />
            ))}
            {gpu.count > 8 && <span className="gpu-more">+{gpu.count - 8}</span>}
          </div>
          <div className="gpu-count">× {gpu.count}</div>
        </div>
        <div className="gpu-card">
          <div className="gpu-val">{gpu.vramUsedGb}<span className="gpu-unit"> / {gpu.vramGb}GB</span></div>
          <div className="gpu-lbl">VRAM 사용 (추정)</div>
          <div className="vram-track"><div className="vram-fill" style={{ width: `${pct}%` }} /></div>
          <div className="gpu-count">{pct}% 점유</div>
        </div>
        <div className="gpu-card">
          <div className="gpu-val">~{gpu.trainDays}<span className="gpu-unit">일</span></div>
          <div className="gpu-lbl">학습 시간 (추정)</div>
          <div className="gpu-days">
            {Array.from({ length: Math.min(Math.ceil(gpu.trainDays), 7) }).map((_, i) => (
              <span className="gpu-day" key={i} />
            ))}
          </div>
          <div className="gpu-count">{gpu.hardware} × {gpu.count} 기준</div>
        </div>
      </div>
      <div className="gpu-note"><Icon name="shield" size={12} /> {gpu.note}</div>
    </div>
  );
}

// ---- section meta ----
const RESEARCH_SECTIONS = [
  { id: "problem", title: "Problem Setting", icon: "pin", wide: true },
  { id: "contrib", title: "Contribution", icon: "sparkles", wide: false },
  { id: "io", title: "Input / Output", icon: "thread", wide: false },
  { id: "comparison", title: "Comparison", icon: "list", wide: true },
  { id: "ablation", title: "Ablation", icon: "filter", wide: true },
];
// 그림 분석 — 두 렌즈 공통으로 맨 아래에 고정 (원문 PDF에서 추출)
const FIG_SECTION = { id: "figures", title: "Figure 분석", icon: "grid-view", wide: true };
const REPRO_SECTIONS = [
  { id: "data", title: "Data", icon: "book", wide: true },
  { id: "model", title: "Model", icon: "command", wide: false },
  { id: "loss", title: "Loss", icon: "filter", wide: false },
  { id: "metrics", title: "Evaluation · Metric", icon: "list", wide: false },
  { id: "training", title: "Training", icon: "settings", wide: false },
  { id: "testing", title: "Testing", icon: "play", wide: false },
  { id: "gpu", title: "GPU 범위", icon: "shield", wide: true },
];

function AnalysisView({ paper, layout = "stack", onToast }) {
  const [lens, setLens] = useAnState("research");
  const [extras, setExtras] = useAnState([]); // {id, sectionId, lens, title, body, author}
  const [addingSec, setAddingSec] = useAnState(null); // 현재 작성 중 섹션 id
  const [exTitle, setExTitle] = useAnState("");
  const [exBody, setExBody] = useAnState("");
  const A = window.findAnalysis(paper.id);
  // 본문 섹션 + 맨 아래 고정 Figure 섹션 (두 렌즈 공통)
  const sections = [...(lens === "research" ? RESEARCH_SECTIONS : REPRO_SECTIONS), FIG_SECTION];

  const body = (sec) => {
    if (sec.id === "figures") return renderResearch("figures", A.research, paper);
    return lens === "research"
      ? renderResearch(sec.id, A.research, paper)
      : renderRepro(sec.id, A.repro);
  };

  const openAdd = (secId) => { setAddingSec(secId); setExTitle(""); setExBody(""); };
  const closeAdd = () => { setAddingSec(null); setExTitle(""); setExBody(""); };
  const saveExtra = (secId) => {
    if (!exTitle.trim() || !exBody.trim()) { onToast && onToast("제목과 내용을 모두 입력해주세요"); return; }
    setExtras(xs => [...xs, { id: "ex" + Date.now(), sectionId: secId, lens: sec_lens(secId), title: exTitle.trim(), body: exBody.trim(), author: window.CURRENT_USER.id }]);
    closeAdd();
    onToast && onToast("분석을 추가했어요");
  };
  // figures는 공통 → lens 무관, 그 외엔 현재 lens로 귀속
  const sec_lens = (secId) => secId === "figures" ? "any" : lens;
  const removeExtra = (id) => setExtras(xs => xs.filter(x => x.id !== id));

  const ExtraNote = ({ x }) => {
    const u = window.findUser(x.author) || window.CURRENT_USER;
    return (
      <div className="an-subnote">
        <div className="an-subnote-head">
          <Avatar user={u} size="sm" />
          <span className="an-subnote-name">{u.name}</span>
          <span className="an-subnote-title">{x.title}</span>
          <button className="an-extra-del" onClick={() => removeExtra(x.id)} title="삭제"><Icon name="x" size={12} /></button>
        </div>
        <p className="an-subnote-body">{x.body}</p>
      </div>
    );
  };

  const Section = ({ sec }) => {
    const mine = extras.filter(x => x.sectionId === sec.id && (x.lens === sec_lens(sec.id)));
    return (
      <div className={`an-section ${sec.wide ? "wide" : ""}`} id={`an-${sec.id}`}>
        <div className="an-section-head">
          <Icon name={sec.icon} size={14} />
          <h3>{sec.title}</h3>
          <AnBadge>{sec.id === "figures" ? "PDF 추출" : "분석"}</AnBadge>
        </div>
        <div className="an-section-body">{body(sec)}</div>

        {(mine.length > 0 || addingSec === sec.id) && (
          <div className="an-notes">
            {mine.map(x => <ExtraNote key={x.id} x={x} />)}
            {addingSec === sec.id && (
              <div className="an-add-form">
                <input className="an-add-title" placeholder="분석 제목 — 예: 우리 데이터셋 적용 메모" value={exTitle} onChange={e => setExTitle(e.target.value)} autoFocus />
                <textarea className="an-add-body" placeholder="이 섹션에 대한 이해·해석·재현 메모를 적어주세요" value={exBody} onChange={e => setExBody(e.target.value)} />
                <div className="an-add-actions">
                  <button className="btn btn-ghost btn-sm" onClick={closeAdd}>취소</button>
                  <button className="btn btn-primary btn-sm" onClick={() => saveExtra(sec.id)}><Icon name="plus" size={12} /> 추가</button>
                </div>
              </div>
            )}
          </div>
        )}

        {addingSec !== sec.id && (
          <button className="an-add-row" onClick={() => openAdd(sec.id)}>
            <Icon name="plus" size={13} /> 이 섹션에 분석 추가
          </button>
        )}
      </div>
    );
  };

  return (
    <div className={`analyzer an-${layout}`}>
      <div className="lens-bar">
        <div className="lens-toggle">
          <button className={lens === "research" ? "on" : ""} onClick={() => setLens("research")}>
            🔬 연구 분석
          </button>
          <button className={lens === "repro" ? "on" : ""} onClick={() => setLens("repro")}>
            🛠️ 재구현 분석
          </button>
        </div>
        <div className="lens-hint">
          {lens === "research"
            ? "논문을 이해하기 위한 관점 — 문제·기여·비교·그림"
            : "직접 다시 구현하기 위한 관점 — 데이터·모델·학습·자원"}
        </div>
      </div>

      {layout === "toc" ? (
        <div className="an-toc-layout">
          <aside className="an-toc">
            <div className="an-toc-label">{lens === "research" ? "연구 분석" : "재구현 분석"}</div>
            {sections.map(s => (
              <a key={s.id} className="an-toc-item" href={`#an-${s.id}`}
                 onClick={(e) => {
                   e.preventDefault();
                   const el = document.getElementById(`an-${s.id}`);
                   const scroller = document.querySelector(".content");
                   if (el && scroller) {
                     const top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 12;
                     scroller.scrollTo({ top, behavior: "smooth" });
                   }
                 }}>
                <Icon name={s.icon} size={13} /> {s.title}
              </a>
            ))}
          </aside>
          <div className="an-toc-body">
            {sections.map(s => <Section key={s.id} sec={s} />)}
          </div>
        </div>
      ) : (
        <div className={layout === "grid" ? "an-grid" : "an-stack"}>
          {sections.map(s => <Section key={s.id} sec={s} />)}
        </div>
      )}
    </div>
  );
}

window.AnalysisView = AnalysisView;
Object.assign(window, { AnalysisView });
