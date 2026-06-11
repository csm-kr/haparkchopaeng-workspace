// ============================================
// 하박조팽 — Main screens
// Dashboard, Library, Ideas, Team, Profile, Search
// ============================================
/* eslint-disable */
const { useState: useMainState, useMemo: useMainMemo, useRef: useMainRef } = React;

// ============================================
// Dashboard
// ============================================
function DashboardScreen({ onNavigate, onUpload, onToast, live }) {
  const greeting = useMainMemo(() => {
    const h = new Date().getHours();
    if (h < 6) return "늦은 밤이네요";
    if (h < 12) return "좋은 아침이에요";
    if (h < 18) return "좋은 오후예요";
    return "좋은 저녁이에요";
  }, []);

  const quick = [
    { id: "library", icon: "book", label: "논문", count: "87편", desc: "PDF를 올리면 연구·재구현 관점으로 자동 분석", tone: "" },
    { id: "presentations", icon: "play", label: "발표 자료", count: "14개", desc: "세미나·로드맵 발표 자료와 댓글", tone: "" },
    { id: "schedule", icon: "calendar", label: "스케줄", count: "토요일", desc: "주차별 발표 일정·로테이션·참여 현황", tone: "" },
  ];

  const recentPapers = window.PAPERS.slice(0, 4);

  return (
    <>
      <Topbar crumbs={[{ label: "홈" }]} onNavigate={onNavigate} />
      <div className="content">
        <div className="content-inner">
          <div style={{ marginBottom: 22 }}>
            <div style={{ fontSize: 13, color: "var(--fg-muted)", marginBottom: 6 }}>{greeting}, {window.CURRENT_USER.name}님 👋</div>
            <h1 className="h1">하박조팽 워크스페이스</h1>
          </div>

          {/* LIVE 세미나 배너 — 진행 중일 때 최상단 */}
          {live && window.SEMINAR_LIVE && (
            <div className="live-banner" onClick={() => onNavigate("meeting")}>
              <div className="live-banner-l">
                <span className="live-pill"><span className="live-dot-sm" />LIVE</span>
                <div>
                  <div className="live-banner-title">{window.SEMINAR_LIVE.title}</div>
                  <div className="live-banner-sub">지금 진행 중 · 발표 {window.findUser(window.SEMINAR_LIVE.presenter).name} · 참가자 {window.SEMINAR_LIVE.count}명</div>
                </div>
              </div>
              <div className="live-banner-r">
                <div className="live-avatars">
                  {window.TEAM.slice(0, window.SEMINAR_LIVE.count).map(u => <Avatar key={u.id} user={u} size="sm" />)}
                </div>
                <button className="btn btn-primary" onClick={(e) => { e.stopPropagation(); onNavigate("meeting"); }}>
                  <Icon name="video" size={14} /> 세미나 입장
                </button>
              </div>
            </div>
          )}

          {/* 최근 논문 */}
          <div className="spread" style={{ marginBottom: 12 }}>
            <h2 className="h2">최근 논문</h2>
            <button className="btn btn-ghost btn-sm" onClick={() => onNavigate("library")}>전체 보기 <Icon name="chevron-right" size={12} /></button>
          </div>
          <div className="paper-list">
            {recentPapers.map(p => {
              const up = window.findUser(p.uploadedBy);
              return (
                <div className="paper-row" key={p.id} onClick={() => onNavigate("paper", { paperId: p.id })}>
                  <div className={`paper-icon ${p.kind}`}>{p.kind.toUpperCase()}</div>
                  <div className="paper-main">
                    <p className="paper-title">{p.title}</p>
                    <p className="paper-sub">{p.authors} · {p.venue}</p>
                  </div>
                  <div className="paper-tags">{p.tags.slice(0, 2).map(t => <Tag key={t}>{t}</Tag>)}</div>
                  <Avatar user={up} size="sm" />
                  <span className="paper-date">{p.uploadedAt}</span>
                </div>
              );
            })}
          </div>

          {/* 최근 발표 */}
          <div className="spread" style={{ margin: "28px 0 12px" }}>
            <h2 className="h2">최근 발표 자료</h2>
            <button className="btn btn-ghost btn-sm" onClick={() => onNavigate("presentations")}>전체 보기 <Icon name="chevron-right" size={12} /></button>
          </div>
          <div className="paper-list">
            {window.PRESENTATIONS.slice(0, 3).map(p => {
              const pr = window.findUser(p.presenter);
              const comments = window.PRES_COMMENTS[p.id] || [];
              return (
                <div className="pres-row" key={p.id} onClick={() => onNavigate("presentation", { presId: p.id })}>
                  <div className="pres-row-thumb"><Icon name="play" size={16} /></div>
                  <div className="paper-main">
                    <p className="paper-title">{p.title}</p>
                    <p className="paper-sub">{pr.name} · {p.date} · {p.slideCount} slides</p>
                  </div>
                  <div className="paper-tags">{p.tags.map(t => <Tag key={t} variant="accent">{t}</Tag>)}</div>
                  <span className="pres-card-stat"><Icon name="message" size={13} /> {comments.length}</span>
                  <Avatar user={pr} size="sm" />
                  <span className="paper-date">{p.date}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}

function actionText(act) {
  switch (act.action) {
    case "uploaded": return "님이 새 논문을 올렸어요";
    case "commented_on": return "님이 코멘트를 남겼어요 —";
    case "presented": return "님이 발표 자료를 정리했어요";
    case "added_idea": return "님이 새 아이디어를 추가했어요";
    case "shared": return "님이 발표를 공유했어요";
    case "mentioned": return "님이 멘션을 남겼어요 —";
    case "reacted": return `님이 ${act.emoji} 반응을 남겼어요`;
    default: return "";
  }
}
function attachIcon(type) {
  return type === "paper" ? "file" : type === "pres" ? "play" : type === "idea" ? "bulb" : "message";
}
function attachLabel(type) {
  return type === "paper" ? "논문 · PDF" : type === "pres" ? "발표 자료 · 12 슬라이드" : type === "idea" ? "아이디어" : "메시지";
}

window.DashboardScreen = DashboardScreen;

// ============================================
// Library
// ============================================
function LibraryScreen({ onNavigate, onUpload }) {
  const [q, setQ] = useMainState("");
  const [activeFilter, setActiveFilter] = useMainState("all");
  const [activeTag, setActiveTag] = useMainState(null);
  const [view, setView] = useMainState("list");

  const filtered = useMainMemo(() => {
    let res = window.PAPERS;
    if (activeFilter !== "all") res = res.filter(p => p.kind === activeFilter);
    if (activeTag) res = res.filter(p => p.tags.includes(activeTag));
    if (q.trim()) {
      const lower = q.toLowerCase();
      res = res.filter(p => p.title.toLowerCase().includes(lower) || p.authors.toLowerCase().includes(lower));
    }
    return res;
  }, [q, activeFilter, activeTag]);

  const allTags = useMainMemo(() => {
    const set = new Set();
    window.PAPERS.forEach(p => p.tags.forEach(t => set.add(t)));
    return Array.from(set);
  }, []);

  return (
    <>
      <Topbar
        crumbs={[{ label: "논문" }]}
        onNavigate={onNavigate}
        actions={
          <>
            <button className="btn btn-secondary btn-sm">
              <Icon name="download" size={12} /> 내보내기
            </button>
            <button className="btn btn-primary btn-sm" onClick={onUpload}>
              <Icon name="plus" size={12} /> 자료 추가
            </button>
          </>
        }
      />
      <div className="content">
        <div className="content-inner">
          <div className="library-header">
            <div>
              <h1 className="h1">논문</h1>
              <div style={{ fontSize: 13, color: "var(--fg-muted)", marginTop: 6 }}>
                {filtered.length}개 논문 · PDF를 열면 <b style={{ color: "var(--accent)" }}>연구·재구현 분석</b> 탭에서 구조화된 분석을 볼 수 있어요
              </div>
            </div>
          </div>

          <div className="lib-controls">
            <div className="lib-search">
              <Icon name="search" size={14} className="search-icon" />
              <input
                placeholder="제목, 저자, 키워드로 검색..."
                value={q}
                onChange={e => setQ(e.target.value)}
              />
            </div>
            <div style={{ display: "flex", gap: 4, background: "var(--bg-subtle)", padding: 3, borderRadius: "var(--r-sm)" }}>
              <button
                className={`icon-btn ${view === "list" ? "" : ""}`}
                onClick={() => setView("list")}
                style={{ background: view === "list" ? "var(--bg-elevated)" : "transparent", boxShadow: view === "list" ? "var(--shadow-xs)" : "none", color: view === "list" ? "var(--fg)" : "var(--fg-subtle)" }}
              >
                <Icon name="list" size={14} />
              </button>
              <button
                className="icon-btn"
                onClick={() => setView("grid")}
                style={{ background: view === "grid" ? "var(--bg-elevated)" : "transparent", boxShadow: view === "grid" ? "var(--shadow-xs)" : "none", color: view === "grid" ? "var(--fg)" : "var(--fg-subtle)" }}
              >
                <Icon name="grid" size={14} />
              </button>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
            <button className="filter-chip active">전체 <span style={{ fontSize: 10 }}>{window.PAPERS.length}</span></button>
          </div>

          {view === "list" ? (
            <div className="paper-list">
              {filtered.map(paper => {
                const uploader = window.findUser(paper.uploadedBy);
                return (
                  <div className="paper-row" key={paper.id} onClick={() => onNavigate("paper", { paperId: paper.id })}>
                    <div className={`paper-icon ${paper.kind}`}>{paper.kind === "pdf" ? "PDF" : paper.kind === "ppt" ? "PPT" : "MD"}</div>
                    <div className="paper-main">
                      <h3 className="paper-title">{paper.title}</h3>
                      <p className="paper-sub">{paper.authors} · {paper.venue} {paper.year}</p>
                    </div>
                    <div className="paper-tags">
                      {paper.tags.slice(0, 2).map(t => <Tag key={t}>{t}</Tag>)}
                    </div>
                    <Avatar user={uploader} size="sm" />
                    <div className="paper-date">{paper.uploadedAt}</div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 14 }}>
              {filtered.map(paper => {
                const uploader = window.findUser(paper.uploadedBy);
                return (
                  <div key={paper.id} className="card hoverable" onClick={() => onNavigate("paper", { paperId: paper.id })} style={{ padding: 16, cursor: "pointer" }}>
                    <div className={`paper-icon ${paper.kind}`} style={{ marginBottom: 10 }}>{paper.kind.toUpperCase()}</div>
                    <h3 style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.4, margin: "0 0 8px", letterSpacing: "-0.015em" }}>{paper.title}</h3>
                    <p style={{ fontSize: 12, color: "var(--fg-subtle)", margin: "0 0 14px" }}>{paper.authors}</p>
                    <div style={{ display: "flex", gap: 4, marginBottom: 12, flexWrap: "wrap" }}>
                      {paper.tags.map(t => <Tag key={t}>{t}</Tag>)}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 10, borderTop: "1px solid var(--border)" }}>
                      <Avatar user={uploader} size="sm" />
                      <span style={{ fontSize: 11, color: "var(--fg-subtle)" }}>{paper.uploadedAt}</span>
                    </div>
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

window.LibraryScreen = LibraryScreen;

// ============================================
// Ideas board (Kanban)
// ============================================
function IdeasScreen({ onNavigate, onToast }) {
  const [ideas, setIdeas] = useMainState(() => window.IDEAS);
  const [dragId, setDragId] = useMainState(null);
  const [composing, setComposing] = useMainState(null); // status column or null
  const [draftTitle, setDraftTitle] = useMainState("");
  const [aiSuggesting, setAiSuggesting] = useMainState(false);

  const columns = [
    { id: "exploring", title: "🔍 탐색 중", color: "var(--m-jo)" },
    { id: "drafting", title: "✏️ 초안", color: "var(--m-paeng)" },
    { id: "experimenting", title: "🧪 실험 중", color: "var(--m-bak)" },
    { id: "submitted", title: "🚀 제출 완료", color: "var(--m-ha)" },
  ];

  const addIdea = (status) => {
    if (!draftTitle.trim()) { setComposing(null); return; }
    const newIdea = {
      id: "i" + Date.now(),
      title: draftTitle,
      desc: "방금 추가됨 — AI가 관련 논문을 찾는 중...",
      status,
      tags: ["new"],
      owners: [window.CURRENT_USER.id],
    };
    setIdeas([newIdea, ...ideas]);
    setDraftTitle("");
    setComposing(null);
    setAiSuggesting(true);
    onToast("AI가 관련 논문을 찾고 있어요");
    setTimeout(() => setAiSuggesting(false), 2400);
  };

  const onDrop = (newStatus) => {
    if (!dragId) return;
    setIdeas(ideas.map(i => i.id === dragId ? { ...i, status: newStatus } : i));
    setDragId(null);
  };

  return (
    <>
      <Topbar
        crumbs={[{ label: "아이디어 보드" }]}
        onNavigate={onNavigate}
        actions={
          <>
            <button className="btn btn-secondary btn-sm">
              <Icon name="sparkles" size={12} /> AI 추천 받기
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => setComposing("exploring")}>
              <Icon name="plus" size={12} /> 새 아이디어
            </button>
          </>
        }
      />
      <div className="content">
        <div className="content-inner" style={{ maxWidth: "none", padding: "24px 32px" }}>
          <div className="welcome">
            <div>
              <h1 className="h1">아이디어 보드</h1>
              <div style={{ fontSize: 13, color: "var(--fg-muted)", marginTop: 6 }}>
                연구 아이디어를 단계별로 정리해요. 카드를 드래그해 이동하세요. 한 줄 적으면 AI가 관련 논문을 찾아드려요.
              </div>
            </div>
          </div>

          <div className="kanban">
            {columns.map(col => {
              const colIdeas = ideas.filter(i => i.status === col.id);
              return (
                <div
                  className="kanban-col"
                  key={col.id}
                  onDragOver={e => e.preventDefault()}
                  onDrop={() => onDrop(col.id)}
                >
                  <div className="kanban-col-head">
                    <div className="kanban-col-title">
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: col.color }} />
                      {col.title}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span className="kanban-col-count">{colIdeas.length}</span>
                      <button className="add-btn" onClick={() => setComposing(col.id)} style={{ opacity: 1 }}>
                        <Icon name="plus" size={12} />
                      </button>
                    </div>
                  </div>

                  {composing === col.id && (
                    <div className="idea-card" style={{ background: "var(--accent-faint)", borderColor: "var(--accent)" }}>
                      <input
                        autoFocus
                        className="input"
                        style={{ background: "transparent", border: 0, padding: 0, marginBottom: 8, fontSize: 13, fontWeight: 600 }}
                        placeholder="새 아이디어 제목..."
                        value={draftTitle}
                        onChange={e => setDraftTitle(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === "Enter") addIdea(col.id);
                          if (e.key === "Escape") { setComposing(null); setDraftTitle(""); }
                        }}
                      />
                      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                        <button className="btn btn-primary btn-sm" onClick={() => addIdea(col.id)}>
                          <Icon name="sparkles" size={11} /> 추가 + AI 추천
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => { setComposing(null); setDraftTitle(""); }}>취소</button>
                      </div>
                    </div>
                  )}

                  {colIdeas.map(idea => (
                    <div
                      key={idea.id}
                      className={`idea-card ${dragId === idea.id ? "dragging" : ""}`}
                      draggable
                      onDragStart={() => setDragId(idea.id)}
                      onDragEnd={() => setDragId(null)}
                      onClick={() => onToast(`"${idea.title}" 상세 패널 (시뮬레이션)`)}
                    >
                      <h4 className="idea-title">{idea.title}</h4>
                      <p className="idea-desc">{idea.desc}</p>
                      {idea.relatedPaper && (
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--accent)", background: "var(--accent-faint)", padding: "3px 8px", borderRadius: 6, marginBottom: 8 }}>
                          <Icon name="paperclip" size={10} />
                          관련: {window.findPaper(idea.relatedPaper)?.title.slice(0, 32)}...
                        </div>
                      )}
                      <div className="idea-footer">
                        <div className="idea-tags">
                          {idea.tags.slice(0, 2).map(t => <Tag key={t} variant="accent">{t}</Tag>)}
                        </div>
                        <div className="idea-avatars">
                          {idea.owners.map(uid => (
                            <Avatar key={uid} user={window.findUser(uid)} size="sm" />
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}

                  {colIdeas.length === 0 && composing !== col.id && (
                    <div style={{ padding: "20px 8px", textAlign: "center", fontSize: 12, color: "var(--fg-subtle)" }}>
                      비어 있음
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}

window.IdeasScreen = IdeasScreen;

// ============================================
// Team — 멤버 관리
// ============================================
function TeamScreen({ onNavigate, onToast }) {
  const W = window.WORKSPACE;
  const [members, setMembers] = useMainState(() =>
    window.TEAM.map(u => ({ ...u, access: window.ACCESS[u.id] || "멤버" }))
  );
  const [invites, setInvites] = useMainState(() => window.PENDING_INVITES.map(x => ({ ...x })));
  const [inviteEmail, setInviteEmail] = useMainState("");
  const [inviteRole, setInviteRole] = useMainState("멤버");
  const [menuId, setMenuId] = useMainState(null);

  const meId = window.CURRENT_USER.id;
  const usedSeats = members.length + invites.length;

  const sendInvite = () => {
    const email = inviteEmail.trim();
    if (!email || !email.includes("@")) { onToast && onToast("올바른 이메일을 입력해주세요"); return; }
    setInvites(iv => [{ email, role: inviteRole, sentAt: "방금", by: meId }, ...iv]);
    setInviteEmail("");
    onToast && onToast(`${email} 로 초대를 보냈어요`);
  };
  const copyLink = () => {
    const link = `https://${W.slug}.habak.team/join/ab12cd`;
    navigator.clipboard?.writeText(link).catch(() => {});
    onToast && onToast("초대 링크를 복사했어요");
  };
  const changeRole = (id, role) => {
    setMembers(ms => ms.map(m => m.id === id ? { ...m, access: role } : m));
    setMenuId(null);
    onToast && onToast("역할을 변경했어요");
  };
  const removeMember = (id) => {
    const m = members.find(x => x.id === id);
    setMembers(ms => ms.filter(x => x.id !== id));
    setMenuId(null);
    onToast && onToast(`${m ? m.name : "멤버"}님을 내보냈어요`);
  };
  const cancelInvite = (email) => {
    setInvites(iv => iv.filter(x => x.email !== email));
    onToast && onToast("초대를 취소했어요");
  };
  const resendInvite = (email) => onToast && onToast(`${email} 로 초대를 다시 보냈어요`);

  const accessBadge = (a) => a === "관리자" ? "tm-badge admin" : a === "게스트" ? "tm-badge guest" : "tm-badge";

  return (
    <>
      <Topbar crumbs={[{ label: "멤버 관리" }]} onNavigate={onNavigate} />
      <div className="content" onClick={() => setMenuId(null)}>
        <div className="content-inner" style={{ maxWidth: 860 }}>
          <div style={{ marginBottom: 22 }}>
            <h1 className="h1">멤버 관리</h1>
            <div style={{ fontSize: 14, color: "var(--fg-muted)", marginTop: 8 }}>
              {W.name} 워크스페이스 · <b style={{ color: "var(--fg)" }}>{usedSeats}</b>/{W.seats}석 사용 중
            </div>
          </div>

          {/* 초대 컴포저 */}
          <div className="tm-invite">
            <div className="tm-invite-row">
              <div className="tm-invite-field">
                <Icon name="users" size={16} style={{ color: "var(--fg-subtle)" }} />
                <input
                  className="tm-invite-input"
                  placeholder="초대할 이메일 주소"
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && sendInvite()}
                />
              </div>
              <select className="sched-select" value={inviteRole} onChange={e => setInviteRole(e.target.value)}>
                <option>멤버</option>
                <option>관리자</option>
                <option>게스트</option>
              </select>
              <button className="btn btn-primary" onClick={sendInvite}>
                <Icon name="send" size={13} /> 초대 보내기
              </button>
            </div>
            <div className="tm-invite-foot">
              <button className="tm-link" onClick={copyLink}><Icon name="paperclip" size={13} /> 초대 링크 복사</button>
              <span className="tm-roles-hint">관리자: 멤버·설정 관리 · 멤버: 전체 작업 · 게스트: 보기 전용</span>
            </div>
          </div>

          {/* 현재 멤버 */}
          <div className="tm-section-label">멤버 · {members.length}</div>
          <div className="tm-list">
            {members.map(m => (
              <div className="tm-row" key={m.id}>
                <Avatar user={m} size="lg" showPresence />
                <div className="tm-info">
                  <div className="tm-name">
                    {m.name}{m.id === meId && <span className="tm-you">나</span>}
                    <span className={accessBadge(m.access)}>{m.access}</span>
                  </div>
                  <div className="tm-sub">{m.role} · {m.email}</div>
                </div>
                <div className="tm-actions">
                  <div className="tm-menu-wrap" onClick={e => e.stopPropagation()}>
                    <button className="icon-btn" onClick={() => setMenuId(menuId === m.id ? null : m.id)}>
                      <Icon name="more" size={16} />
                    </button>
                    {menuId === m.id && (
                      <div className="tm-menu">
                        <div className="tm-menu-label">역할 변경</div>
                        {["관리자", "멤버", "게스트"].map(r => (
                          <button key={r} className={`tm-menu-item ${m.access === r ? "on" : ""}`} onClick={() => changeRole(m.id, r)}>
                            {r}{m.access === r && <Icon name="chevron-right" size={12} />}
                          </button>
                        ))}
                        {m.id !== meId && (
                          <>
                            <div className="tm-menu-div" />
                            <button className="tm-menu-item danger" onClick={() => removeMember(m.id)}>
                              <Icon name="logout" size={13} /> 내보내기
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* 초대 대기 중 */}
          {invites.length > 0 && (
            <>
              <div className="tm-section-label" style={{ marginTop: 28 }}>초대 대기 중 · {invites.length}</div>
              <div className="tm-list">
                {invites.map(inv => (
                  <div className="tm-row pending" key={inv.email}>
                    <div className="tm-pending-ava"><Icon name="users" size={18} /></div>
                    <div className="tm-info">
                      <div className="tm-name">{inv.email}<span className={accessBadge(inv.role)}>{inv.role}</span></div>
                      <div className="tm-sub">{inv.sentAt} 초대됨 · 수락 대기 중</div>
                    </div>
                    <div className="tm-actions">
                      <button className="btn btn-ghost btn-sm" onClick={() => resendInvite(inv.email)}>재전송</button>
                      <button className="btn btn-ghost btn-sm tm-cancel" onClick={() => cancelInvite(inv.email)}>취소</button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
window.TeamScreen = TeamScreen;

// ============================================
// Profile / Settings
// ============================================
function ProfileScreen({ onNavigate, onToast, onLegal }) {
  const u = window.CURRENT_USER;
  const [notif, setNotif] = useMainState(true);
  const [mentions, setMentions] = useMainState(true);
  const [weekly, setWeekly] = useMainState(false);

  return (
    <>
      <Topbar crumbs={[{ label: "설정" }, { label: "프로필" }]} onNavigate={onNavigate} />
      <div className="content">
        <div className="content-inner" style={{ maxWidth: 760 }}>
          <div className="profile-header" />
          <div className="profile-body">
            <div className="profile-top">
              <div className="profile-avatar" style={{ background: u.color }}>{u.initial}</div>
              <div className="profile-info">
                <h1 className="profile-name">{u.name}</h1>
                <div className="profile-role">{u.role} · {u.handle} · {u.email}</div>
              </div>
              <button className="btn btn-secondary"><Icon name="settings" size={12} /> 프로필 수정</button>
            </div>

            <div className="settings-section">
              <div className="settings-section-head"><h3>일반</h3></div>
              <div className="settings-row">
                <div>
                  <div className="settings-label">표시 이름</div>
                  <div className="settings-desc">팀원에게 보이는 이름</div>
                </div>
                <input className="input" defaultValue={u.name} style={{ maxWidth: 200 }} />
              </div>
              <div className="settings-row">
                <div>
                  <div className="settings-label">상태 메시지</div>
                  <div className="settings-desc">사이드바에 표시되는 한 줄</div>
                </div>
                <input className="input" defaultValue={u.status} style={{ maxWidth: 240 }} />
              </div>
              <div className="settings-row">
                <div>
                  <div className="settings-label">연구 관심사</div>
                  <div className="settings-desc">AI 추천에 사용</div>
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  <Tag variant="accent">멀티모달</Tag>
                  <Tag variant="accent">LLM</Tag>
                  <Tag variant="accent">Eval</Tag>
                  <button className="btn btn-ghost btn-sm"><Icon name="plus" size={11} /></button>
                </div>
              </div>
            </div>

            <div className="settings-section">
              <div className="settings-section-head"><h3>알림</h3></div>
              <div className="settings-row">
                <div>
                  <div className="settings-label">새 자료 알림</div>
                  <div className="settings-desc">팀원이 논문/발표를 올릴 때</div>
                </div>
                <div className={`toggle ${notif ? "on" : ""}`} onClick={() => setNotif(!notif)} />
              </div>
              <div className="settings-row">
                <div>
                  <div className="settings-label">@멘션 알림</div>
                  <div className="settings-desc">나를 멘션한 코멘트</div>
                </div>
                <div className={`toggle ${mentions ? "on" : ""}`} onClick={() => setMentions(!mentions)} />
              </div>
              <div className="settings-row">
                <div>
                  <div className="settings-label">주간 다이제스트</div>
                  <div className="settings-desc">매주 월요일 아침 9시</div>
                </div>
                <div className={`toggle ${weekly ? "on" : ""}`} onClick={() => setWeekly(!weekly)} />
              </div>
            </div>

            <div className="settings-section">
              <div className="settings-section-head"><h3>법적 고지</h3></div>
              <div className="settings-row" style={{ cursor: "pointer" }} onClick={() => onLegal && onLegal("terms")}>
                <div>
                  <div className="settings-label">이용약관</div>
                  <div className="settings-desc">서비스 이용에 관한 약관</div>
                </div>
                <Icon name="chevron-right" size={16} style={{ color: "var(--fg-subtle)" }} />
              </div>
              <div className="settings-row" style={{ cursor: "pointer" }} onClick={() => onLegal && onLegal("privacy")}>
                <div>
                  <div className="settings-label">개인정보처리방침</div>
                  <div className="settings-desc">개인정보 수집·이용·보관 안내</div>
                </div>
                <Icon name="chevron-right" size={16} style={{ color: "var(--fg-subtle)" }} />
              </div>
            </div>

            <div className="settings-section">
              <div className="settings-section-head"><h3>위험 구역</h3></div>
              <div className="settings-row">
                <div>
                  <div className="settings-label" style={{ color: "var(--busy)" }}>로그아웃</div>
                  <div className="settings-desc">현재 기기에서만 로그아웃됩니다</div>
                </div>
                <button className="btn btn-secondary" onClick={() => { window.location.reload(); }}><Icon name="logout" size={12} /> 로그아웃</button>
              </div>
              <div className="settings-row">
                <div>
                  <div className="settings-label" style={{ color: "var(--busy)" }}>워크스페이스 나가기</div>
                  <div className="settings-desc">하박조팽 워크스페이스에서 영구 제외돼요</div>
                </div>
                <button className="btn btn-secondary" style={{ color: "var(--busy)" }}>나가기</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
window.ProfileScreen = ProfileScreen;

// ============================================
// Search results
// ============================================
function SearchScreen({ onNavigate, initialQuery = "MoD" }) {
  const [q, setQ] = useMainState(initialQuery);
  const results = window.SEARCH_RESULTS;
  const counts = useMainMemo(() => {
    const c = { all: results.length, paper: 0, pres: 0, idea: 0, comment: 0 };
    results.forEach(r => {
      if (r.kind === "논문") c.paper++;
      else if (r.kind === "발표") c.pres++;
      else if (r.kind === "아이디어") c.idea++;
      else if (r.kind === "코멘트") c.comment++;
    });
    return c;
  }, []);

  return (
    <>
      <Topbar crumbs={[{ label: "검색" }]} onNavigate={onNavigate} />
      <div className="content">
        <div className="content-inner" style={{ maxWidth: 800 }}>
          <h1 className="h1">검색 결과</h1>
          <div style={{ position: "relative", margin: "20px 0" }}>
            <Icon name="search" size={16} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--fg-subtle)" }} />
            <input
              className="input"
              style={{ paddingLeft: 40, fontSize: 15, paddingTop: 12, paddingBottom: 12 }}
              value={q}
              onChange={e => setQ(e.target.value)}
            />
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
            <button className="filter-chip active">전체 <span>{counts.all}</span></button>
            <button className="filter-chip">논문 <span>{counts.paper}</span></button>
            <button className="filter-chip">발표 <span>{counts.pres}</span></button>
            <button className="filter-chip">아이디어 <span>{counts.idea}</span></button>
            <button className="filter-chip">코멘트 <span>{counts.comment}</span></button>
          </div>
          <div style={{ fontSize: 13, color: "var(--fg-muted)", marginBottom: 8 }}>
            "<b>{q}</b>"에 대한 결과 {results.length}건 (0.18초)
          </div>
          <div>
            {results.map((r, i) => (
              <div className="search-result" key={i} onClick={() => {
                if (r.targetType === "paper") onNavigate("paper", { paperId: r.targetId });
                else if (r.targetType === "pres") onNavigate("presentation", { presId: r.targetId });
                else if (r.targetType === "idea") onNavigate("ideas");
              }}>
                <div className="search-result-kind">{r.kind}</div>
                <div className="search-title">{r.title}</div>
                <div className="search-snippet" dangerouslySetInnerHTML={{ __html: highlightSnippet(r.snippet, q) }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
function highlightSnippet(text, q) {
  if (!q || !q.trim()) return text;
  const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  return text.replace(re, "<mark>$1</mark>");
}
window.SearchScreen = SearchScreen;

Object.assign(window, { DashboardScreen, LibraryScreen, IdeasScreen, TeamScreen, ProfileScreen, SearchScreen, actionText });
