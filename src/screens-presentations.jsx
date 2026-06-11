// ============================================
// 하박조팽 — 발표(Presentations) + 라운지(Lounge)
// ============================================
/* eslint-disable */
const { useState: usePresListState, useRef: usePresListRef, useEffect: usePresListEffect } = React;

// ============================================
// Presentations — 발표 자료 모음 (히스토리 · 댓글 진입)
// ============================================
function PresentationsScreen({ onNavigate, onToast }) {
  const [view, setView] = usePresListState("list");

  const toggleStyle = (active) => ({
    background: active ? "var(--bg-elevated)" : "transparent",
    boxShadow: active ? "var(--shadow-xs)" : "none",
    color: active ? "var(--fg)" : "var(--fg-subtle)",
  });

  return (
    <>
      <Topbar
        crumbs={[{ label: "발표 자료" }]}
        onNavigate={onNavigate}
        actions={
          <button className="btn btn-primary btn-sm"><Icon name="plus" size={12} /> 발표 추가</button>
        }
      />
      <div className="content">
        <div className="content-inner">
          <div className="library-header">
            <div>
              <h1 className="h1">발표 자료</h1>
              <div style={{ marginTop: 8, fontSize: 14, color: "var(--fg-muted)" }}>
                주간 세미나 · 로드맵 발표를 모아두고, <b style={{ color: "var(--accent)" }}>버전 히스토리</b>와 댓글을 남겨요.
              </div>
            </div>
            <div style={{ display: "flex", gap: 4, background: "var(--bg-subtle)", padding: 3, borderRadius: "var(--r-sm)" }}>
              <button className="icon-btn" onClick={() => setView("list")} style={toggleStyle(view === "list")} title="리스트 뷰">
                <Icon name="list" size={14} />
              </button>
              <button className="icon-btn" onClick={() => setView("grid")} style={toggleStyle(view === "grid")} title="그리드 뷰">
                <Icon name="grid" size={14} />
              </button>
            </div>
          </div>

          {view === "grid" ? (
            <div className="pres-cards">
              {window.PRESENTATIONS.map(p => {
                const presenter = window.findUser(p.presenter);
                const extra = window.PRES_EXTRA[p.id] || { assets: [], history: [] };
                const comments = window.PRES_COMMENTS[p.id] || [];
                const ver = extra.history[0] ? extra.history[0].ver : "v1";
                return (
                  <div className="pres-card" key={p.id} onClick={() => onNavigate("presentation", { presId: p.id })}>
                    <div className="pres-card-thumb">
                      <span className="pres-slide-num mono">{String(p.slideCount).padStart(2, "0")} slides</span>
                      <Icon name="play" size={28} />
                      <span className="pres-card-ver mono">{ver}</span>
                    </div>
                    <div className="pres-card-body">
                      <div className="pres-card-tags">
                        {p.tags.map(t => <Tag key={t} variant="accent">{t}</Tag>)}
                      </div>
                      <h3 className="pres-card-title">{p.title}</h3>
                      <div className="pres-card-meta">
                        <Avatar user={presenter} size="sm" />
                        <span><b>{presenter.name}</b> · {p.date} · {p.duration}</span>
                      </div>
                      <div className="pres-card-foot">
                        <span className="pres-card-stat"><Icon name="message" size={13} /> {comments.length}</span>
                        <span className="pres-card-stat"><Icon name="thread" size={13} /> {extra.history.length}버전</span>
                        <span style={{ flex: 1 }} />
                        <button className="pres-card-dl" title="자료 다운로드"
                          onClick={(e) => { e.stopPropagation(); onToast && onToast(`${(extra.assets[0]||{}).name || "자료"} 다운로드 (시뮬레이션)`); }}>
                          <Icon name="download" size={14} /> {extra.assets.length}개
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="paper-list">
              {window.PRESENTATIONS.map(p => {
                const presenter = window.findUser(p.presenter);
                const extra = window.PRES_EXTRA[p.id] || { assets: [], history: [] };
                const comments = window.PRES_COMMENTS[p.id] || [];
                const ver = extra.history[0] ? extra.history[0].ver : "v1";
                return (
                  <div className="pres-row" key={p.id} onClick={() => onNavigate("presentation", { presId: p.id })}>
                    <div className="pres-row-thumb"><Icon name="play" size={16} /></div>
                    <div className="paper-main">
                      <p className="paper-title">{p.title}</p>
                      <p className="paper-sub">{presenter.name} · {p.date} · {p.duration} · {p.slideCount} slides</p>
                    </div>
                    <div className="paper-tags">{p.tags.map(t => <Tag key={t} variant="accent">{t}</Tag>)}</div>
                    <span className="pres-row-ver mono">{ver}</span>
                    <span className="pres-card-stat"><Icon name="message" size={13} /> {comments.length}</span>
                    <button className="pres-card-dl" title="자료 다운로드"
                      onClick={(e) => { e.stopPropagation(); onToast && onToast(`${(extra.assets[0]||{}).name || "자료"} 다운로드 (시뮬레이션)`); }}>
                      <Icon name="download" size={14} /> {extra.assets.length}개
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
window.PresentationsScreen = PresentationsScreen;

// ============================================
// Lounge — 단일 팀 채팅 (#라운지)
// ============================================
function LoungeScreen({ onNavigate }) {
  const [msgs, setMsgs] = usePresListState(window.LOUNGE.map((m, i) => ({ ...m, id: "lg" + i })));
  const [draft, setDraft] = usePresListState("");
  const endRef = usePresListRef(null);

  const send = () => {
    if (!draft.trim()) return;
    setMsgs(m => [...m, { id: "lg" + Date.now(), user: window.CURRENT_USER.id, text: draft, time: "방금" }]);
    setDraft("");
  };

  return (
    <>
      <Topbar
        crumbs={[{ label: "채팅" }, { label: "# 세미나" }]}
        onNavigate={onNavigate}
        actions={<span style={{ fontSize: 12, color: "var(--fg-subtle)" }}>멤버 4명</span>}
      />
      <div className="content">
        <div className="content-inner" style={{ maxWidth: 760 }}>
          <div className="lounge-intro">
            <div className="lounge-hash"><Icon name="hash" size={22} /></div>
            <div>
              <h2 className="h2"># 세미나</h2>
              <p style={{ fontSize: 13, color: "var(--fg-muted)", margin: "4px 0 0" }}>
                세미나·연구 관련 잡담과 공지를 나누는 채널. 특정 논문·발표 피드백은 각 자료의 댓글로 남겨요.
              </p>
            </div>
          </div>

          <div className="lounge-stream">
            {msgs.map(m => {
              const u = window.findUser(m.user) || window.CURRENT_USER;
              return (
                <div className="lounge-msg" key={m.id}>
                  <Avatar user={u} size="md" />
                  <div className="lounge-msg-body">
                    <div className="lounge-msg-head">
                      <b>{u.name}</b>
                      <span className="mono">{m.time}</span>
                    </div>
                    <div className="lounge-msg-text">{m.text}</div>
                  </div>
                </div>
              );
            })}
            <div ref={endRef} />
          </div>

          <div className="lounge-compose">
            <input
              value={draft}
              onChange={e => setDraft(e.target.value)}
              placeholder="# 세미나에 메시지 보내기"
              onKeyDown={e => { if (e.key === "Enter") send(); }}
            />
            <button className="icon-btn" title="이모지"><Icon name="emoji" size={18} /></button>
            <button className="btn btn-primary btn-sm" onClick={send} disabled={!draft.trim()} style={{ opacity: draft.trim() ? 1 : 0.4 }}>
              <Icon name="send" size={12} /> 보내기
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
window.LoungeScreen = LoungeScreen;

Object.assign(window, { PresentationsScreen, LoungeScreen });
