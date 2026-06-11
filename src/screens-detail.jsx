// ============================================
// 하박조팽 — Detail screens
// PaperDetail, PresentationView, UploadModal
// ============================================
/* eslint-disable */
const { useState: useDetailState, useEffect: useDetailEffect, useRef: useDetailRef } = React;

// ============================================
// Paper Detail — AI summary view
// ============================================
function PaperDetailScreen({ paperId, onNavigate, onToast, anLayout = "stack" }) {
  const paper = window.findPaper(paperId) || window.PAPERS[0];
  const uploader = window.findUser(paper.uploadedBy);

  return (
    <>
      <Topbar
        crumbs={[
          { label: "논문", onClick: () => onNavigate("library") },
          { label: paper.title.length > 36 ? paper.title.slice(0, 36) + "..." : paper.title }
        ]}
        onNavigate={onNavigate}
        actions={
          <button className="btn btn-secondary btn-sm" onClick={() => onToast("원문 PDF 다운로드 (시뮬레이션)")}>
            <Icon name="download" size={12} /> 원문 PDF
          </button>
        }
      />
      <div className="content">
        <div className="content-inner">
          <div className="detail-layout full">
            <div className="detail-main">
              <div className="detail-header">
                <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <Tag variant="accent"><span className="tag-dot" />arXiv:{paper.arxiv || "2024.XXXXX"}</Tag>
                  <Tag>{paper.venue}</Tag>
                  {paper.tags.map(t => <Tag key={t}>{t}</Tag>)}
                </div>
                <h1 className="detail-title">{paper.title}</h1>
                <div className="detail-authors">{paper.authors}</div>
                <div className="detail-meta">
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <Avatar user={uploader} size="sm" />
                    {uploader.name}이 업로드
                  </span>
                  <span>·</span>
                  <span>{paper.uploadedAt}</span>
                  <span>·</span>
                  <span>{paper.pageCount || 14}페이지</span>
                  <span>·</span>
                  <span>👀 12회 열람</span>
                </div>
              </div>

              <AnalysisView paper={paper} layout={anLayout} onToast={onToast} />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function linkifyMentions(text) {
  return text
    .replace(/@(\S+)/g, '<span class="mention">@$1</span>')
    .replace(/\n/g, "<br/>");
}

window.PaperDetailScreen = PaperDetailScreen;

// ============================================
// Presentation View
// ============================================
function PresentationScreen({ presId, onNavigate, onToast }) {
  const pres = window.findPres(presId) || window.PRESENTATIONS[0];
  const presenter = window.findUser(pres.presenter);
  const [idx, setIdx] = useDetailState(0);
  const extra = window.PRES_EXTRA[pres.id] || { assets: [], history: [] };
  const [pcomments, setPcomments] = useDetailState(window.PRES_COMMENTS[pres.id] || []);
  const [pdraft, setPdraft] = useDetailState("");
  const [saved, setSaved] = useDetailState(false);
  const [pdfDrag, setPdfDrag] = useDetailState(false);
  const sendP = () => {
    if (!pdraft.trim()) return;
    setPcomments([...pcomments, { id: "pc" + Date.now(), user: window.CURRENT_USER.id, text: pdraft, time: "방금", slide: idx + 1 }]);
    setPdraft("");
    onToast && onToast("발표에 코멘트를 남겼어요");
  };

  const slides = pres.slides && pres.slides.length ? pres.slides : [
    { title: pres.title, body: "슬라이드 준비 중" }
  ];

  const slide = slides[idx];
  const total = slides.length;

  return (
    <>
      <Topbar
        crumbs={[
          { label: "발표 자료", onClick: () => onNavigate("presentations") },
          { label: pres.title.length > 36 ? pres.title.slice(0, 36) + "..." : pres.title }
        ]}
        onNavigate={onNavigate}
        actions={
          <>
            <button className="btn btn-ghost btn-sm"><Icon name="download" size={12} /> PPTX</button>
            <button className="btn btn-secondary btn-sm" onClick={() => onNavigate("meeting")}><Icon name="video" size={12} /> 세미나 입장</button>
            <button className="btn btn-primary btn-sm"><Icon name="paperclip" size={12} /> 공유</button>
          </>
        }
      />
      <div className="content">
        <div className="content-inner">
          <div className="detail-header" style={{ marginBottom: 18 }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              {pres.tags.map(t => <Tag key={t} variant="accent">{t}</Tag>)}
              <Tag>{pres.date}</Tag>
              <Tag>{pres.duration}</Tag>
            </div>
            <h1 className="detail-title">{pres.title}</h1>
            <div className="detail-meta">
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Avatar user={presenter} size="sm" />
                <b style={{ color: "var(--fg)" }}>{presenter.name}</b> 발표
              </span>
              <span>·</span>
              <span>{total}개 슬라이드</span>
              <span>·</span>
              <span>👀 7명이 봤어요</span>
            </div>
          </div>

          <div className="pres-single">
              <div className="pres-stage">
                <div className="pres-slide">
                  <span className="pres-slide-num">{String(idx + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}</span>
                  <h2>{slide.title}</h2>
                  {slide.subtitle && <p style={{ fontSize: 18, opacity: 0.7, marginBottom: 8 }}>{slide.subtitle}</p>}
                  {slide.body && <p style={{ whiteSpace: "pre-line", fontSize: 16 }}>{slide.body}</p>}
                </div>
                <div className="pres-controls">
                  <button className="btn btn-ghost btn-sm" disabled={idx === 0} onClick={() => setIdx(Math.max(0, idx - 1))} style={{ opacity: idx === 0 ? 0.4 : 1 }}>
                    <Icon name="chevron-left" size={14} /> 이전
                  </button>
                  <div style={{ fontSize: 12, color: "var(--fg-muted)", fontVariantNumeric: "tabular-nums" }}>
                    {idx + 1} / {total}
                  </div>
                  <button className="btn btn-ghost btn-sm" disabled={idx === total - 1} onClick={() => setIdx(Math.min(total - 1, idx + 1))} style={{ opacity: idx === total - 1 ? 0.4 : 1 }}>
                    다음 <Icon name="chevron-right" size={14} />
                  </button>
                </div>
                <div className="pres-thumbs">
                  {slides.map((s, i) => (
                    <div
                      key={i}
                      className={`pres-thumb ${i === idx ? "active" : ""}`}
                      onClick={() => setIdx(i)}
                    >
                      {String(i + 1).padStart(2, "0")}
                    </div>
                  ))}
                </div>
              </div>

              <div className="pres-single-actions">
                <button className={`btn ${saved ? "btn-secondary" : "btn-primary"}`} onClick={() => { setSaved(s => !s); onToast && onToast(saved ? "저장을 해제했어요" : "내 자료로 저장했어요"); }}>
                  <Icon name="pin" size={13} /> {saved ? "저장됨" : "저장하기"}
                </button>
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 12, color: "var(--fg-subtle)" }}>{extra.assets.length}개 자료 · {extra.history.length}개 버전</span>
              </div>

              <div className="pres-comments">
                <div className="pres-comments-head">
                  <Icon name="message" size={15} />
                  <h3>발표 댓글</h3>
                  <span className="kanban-col-count">{pcomments.length}</span>
                </div>
                <div className="pres-comments-list">
                  {pcomments.length === 0 && (
                    <div style={{ padding: "20px 0", textAlign: "center", color: "var(--fg-subtle)", fontSize: 13 }}>
                      첫 댓글을 남겨보세요 — 특정 슬라이드를 언급하면 좋아요.
                    </div>
                  )}
                  {pcomments.map(c => {
                    const u = window.findUser(c.user) || window.CURRENT_USER;
                    return (
                      <div className="comment" key={c.id}>
                        <Avatar user={u} size="sm" />
                        <div className="comment-body">
                          <div className="comment-head">
                            <span className="comment-name">{u.name}</span>
                            {c.slide && <span className="pres-comment-slide mono">슬라이드 {c.slide}</span>}
                            <span className="comment-time">{c.time}</span>
                          </div>
                          <div className="comment-text" dangerouslySetInnerHTML={{ __html: linkifyMentions(c.text) }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="pres-compose">
                  <textarea
                    placeholder={`${idx + 1}번 슬라이드에 댓글 — @멘션 가능`}
                    value={pdraft}
                    onChange={e => setPdraft(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) sendP(); }}
                  />
                  <div className="compose-actions">
                    <span style={{ fontSize: 11, color: "var(--fg-subtle)" }}>현재 {idx + 1}번 슬라이드 기준</span>
                    <button className="btn btn-primary btn-sm" disabled={!pdraft.trim()} onClick={sendP} style={{ opacity: pdraft.trim() ? 1 : 0.4 }}>
                      <Icon name="send" size={11} /> 보내기
                    </button>
                  </div>
                </div>
              </div>

              <div className="pres-keypoints" style={{ marginTop: 16 }}>
                <h3><Icon name="download" size={12} /> 발표 자료</h3>
                <div className="pres-assets">
                  {extra.assets.map((a, i) => (
                    <div className="pres-asset" key={i} onClick={() => onToast && onToast(`${a.name} 다운로드 (시뮬레이션)`)}>
                      <div className={`paper-icon ${a.type}`}>{a.type.toUpperCase()}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="pres-asset-name">{a.name}</div>
                        <div className="pres-asset-size mono">{a.size}</div>
                      </div>
                      <Icon name="download" size={15} style={{ color: "var(--fg-subtle)" }} />
                    </div>
                  ))}
                </div>
                <div
                  className={`pres-upload ${pdfDrag ? "drag" : ""}`}
                  onClick={() => onToast && onToast("발표 PDF 업로드 (시뮬레이션)")}
                  onDragOver={e => { e.preventDefault(); setPdfDrag(true); }}
                  onDragLeave={() => setPdfDrag(false)}
                  onDrop={e => { e.preventDefault(); setPdfDrag(false); onToast && onToast("발표 PDF 업로드 (시뮬레이션)"); }}
                >
                  <Icon name="upload" size={18} />
                  <div className="pres-upload-text">
                    <div className="pres-upload-title">발표 PDF 올리기</div>
                    <div className="pres-upload-sub">슬라이드 PDF·PPTX를 끌어다 놓거나 클릭해서 추가</div>
                  </div>
                </div>
              </div>
          </div>
        </div>
      </div>
    </>
  );
}

window.PresentationScreen = PresentationScreen;

// ============================================
// Upload Modal — supports drag/drop, AI summary states
// ============================================
function UploadModal({ open, onClose, onNavigate, onToast }) {
  const [stage, setStage] = useDetailState("idle"); // idle, uploading, processing, done
  const [filename, setFilename] = useDetailState("");
  const [dragOver, setDragOver] = useDetailState(false);
  const [progress, setProgress] = useDetailState(0);

  useDetailEffect(() => {
    if (!open) {
      setStage("idle");
      setFilename("");
      setProgress(0);
    }
  }, [open]);

  const startUpload = (name = "Mixture-of-Experts-Survey-2024.pdf") => {
    setFilename(name);
    setStage("uploading");
    setProgress(0);
    let p = 0;
    const t = setInterval(() => {
      p += 12 + Math.random() * 15;
      if (p >= 100) {
        clearInterval(t);
        setProgress(100);
        setStage("processing");
        setTimeout(() => {
          setStage("done");
        }, 2400);
      } else setProgress(p);
    }, 240);
  };

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h2>새 자료 추가</h2>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
        <div className="modal-body">
          {stage === "idle" && (
            <>
              <div
                className={`upload-zone ${dragOver ? "drag" : ""}`}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => { e.preventDefault(); setDragOver(false); startUpload(); }}
                onClick={() => startUpload()}
                style={{ padding: "40px 20px" }}
              >
                <div className="upload-icon"><Icon name="upload" size={22} /></div>
                <h3>PDF를 여기로 끌어다 놓으세요</h3>
                <p>또는 클릭해서 PDF 파일 선택</p>
                <div className="upload-types">
                  <Tag>PDF</Tag>
                </div>
              </div>

              <div className="auth-divider">또는 arXiv URL로</div>

              <div style={{ display: "flex", gap: 8 }}>
                <input className="input" placeholder="https://arxiv.org/abs/2404.02258" />
                <button className="btn btn-primary" onClick={() => startUpload("arxiv-2404.02258.pdf")}>가져오기</button>
              </div>
            </>
          )}

          {(stage === "uploading" || stage === "processing") && (
            <div style={{ padding: "12px 0" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
                <div className={`paper-icon pdf`} style={{ width: 40, height: 40 }}>PDF</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{filename}</div>
                  <div style={{ fontSize: 12, color: "var(--fg-muted)" }}>
                    {stage === "uploading" ? `업로드 중... ${Math.round(progress)}%` : "AI가 정리하고 있어요..."}
                  </div>
                </div>
              </div>

              <div style={{ height: 6, background: "var(--bg-subtle)", borderRadius: 3, overflow: "hidden", marginBottom: 22 }}>
                <div style={{
                  height: "100%",
                  width: `${stage === "uploading" ? progress : 100}%`,
                  background: "var(--accent)",
                  transition: "width 0.2s",
                  animation: stage === "processing" ? "shimmer 1.4s linear infinite" : "none",
                  backgroundSize: stage === "processing" ? "200% 100%" : "auto",
                  backgroundImage: stage === "processing" ? "linear-gradient(90deg, var(--accent) 0%, oklch(0.72 0.18 280) 50%, var(--accent) 100%)" : "none",
                }} />
              </div>

              {stage === "processing" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {[
                    { label: "텍스트 추출", done: true },
                    { label: "Abstract / Method / Result 분할", done: true },
                    { label: "한국어 번역", done: progress > 50 },
                    { label: "키워드 + 관련 논문 찾기", done: false },
                  ].map((step, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
                      <div style={{ width: 16, height: 16, borderRadius: "50%", background: step.done ? "var(--accent)" : "var(--bg-subtle)", display: "grid", placeItems: "center", color: "white", fontSize: 10 }}>
                        {step.done ? "✓" : ""}
                      </div>
                      <span style={{ color: step.done ? "var(--fg)" : "var(--fg-muted)" }}>{step.label}</span>
                      {!step.done && i === 3 && <div className="skel" style={{ height: 8, flex: 1, marginLeft: 8 }} />}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {stage === "done" && (
            <div style={{ textAlign: "center", padding: "16px 0" }}>
              <div style={{ width: 56, height: 56, borderRadius: "50%", background: "var(--accent-soft)", color: "var(--accent)", display: "inline-grid", placeItems: "center", marginBottom: 14 }}>
                <Icon name="sparkles" size={26} />
              </div>
              <h3 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 6px", letterSpacing: "-0.02em" }}>정리가 끝났어요!</h3>
              <p style={{ fontSize: 13, color: "var(--fg-muted)", margin: "0 0 8px" }}>{filename}</p>
              <p style={{ fontSize: 12, color: "var(--fg-subtle)", margin: "0 0 22px" }}>요약 · 키워드 · 관련 논문 3건 추출 완료</p>
              <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                <button className="btn btn-secondary" onClick={onClose}>닫기</button>
                <button className="btn btn-primary" onClick={() => { onClose(); onNavigate("paper", { paperId: "p1" }); }}>
                  요약 보기 <Icon name="chevron-right" size={12} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

window.UploadModal = UploadModal;

Object.assign(window, { PaperDetailScreen, PresentationScreen, UploadModal });
