// ============================================
// 하박조팽 — 화상 세미나 룸 (Google Meet 스타일)
// 실제 로컬 카메라(getUserMedia) + 컨트롤 + 채팅 + 자료 다운로드
// ⚠ 다자간 실시간 스트리밍은 WebRTC 시그널링 서버가 필요 (핸드오프 문서 참고)
// ============================================
/* eslint-disable */
const { useState: useMeetState, useEffect: useMeetEffect, useRef: useMeetRef } = React;

function fmtElapsed(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  const h = Math.floor(m / 60);
  const mm = (m % 60).toString().padStart(2, "0");
  const ss = s.toString().padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function MeetTile({ user, speaking, self, camOn, videoRef, muted }) {
  return (
    <div className={`meet-tile ${speaking ? "speaking" : ""}`}>
      {self && camOn ? (
        <video ref={videoRef} className="tile-video" autoPlay muted playsInline />
      ) : (
        <div className="tile-avatar" style={{ background: user.color }}>{user.initial}</div>
      )}
      <div className="tile-name">
        {muted && <Icon name="mic-off" size={12} />}
        {user.name}{self ? " (나)" : ""}
      </div>
      {speaking && !(self && camOn) && <div className="tile-ring" />}
    </div>
  );
}

function MeetingScreen({ onNavigate, onToast, live, onSetLive }) {
  const pres = window.findPres("pres1");
  const presenter = window.findUser(pres.presenter); // 조성민
  const me = window.CURRENT_USER; // 하수현
  const others = window.TEAM.filter(u => u.id !== me.id);
  const slides = pres.slides || [];

  const [micOn, setMicOn] = useMeetState(false);
  const [camOn, setCamOn] = useMeetState(false);
  const present = true;
  const [hand, setHand] = useMeetState(false);
  const [panel, setPanel] = useMeetState(null); // chat | people | files | null
  const [slideIdx, setSlideIdx] = useMeetState(2);
  const [elapsed, setElapsed] = useMeetState(18 * 60 + 42);
  const [floats, setFloats] = useMeetState([]);
  const [chat, setChat] = useMeetState([
    { user: "jo", text: "다들 들리시나요? 시작할게요", time: "방금" },
    { user: "bak", text: "네 잘 들려요 👍", time: "방금" },
    { user: "paeng", text: "7번 슬라이드 질문 있어요", time: "방금" },
  ]);
  const [draft, setDraft] = useMeetState("");
  const videoRef = useMeetRef(null);
  const streamRef = useMeetRef(null);

  // elapsed timer
  useMeetEffect(() => {
    const t = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // camera lifecycle
  useMeetEffect(() => {
    let cancelled = false;
    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      } catch (err) {
        if (!cancelled) { setCamOn(false); onToast && onToast("카메라를 켤 수 없어요 (권한/장치 확인)"); }
      }
    }
    if (camOn) start();
    return () => {
      cancelled = true;
      if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    };
  }, [camOn]);

  const leave = () => {
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    onNavigate("dashboard");
    onToast && onToast("세미나에서 나갔어요");
  };

  const react = (emoji) => {
    const id = Date.now() + Math.random();
    setFloats(f => [...f, { id, emoji, left: 20 + Math.random() * 60 }]);
    setTimeout(() => setFloats(f => f.filter(x => x.id !== id)), 2400);
  };

  const sendChat = () => {
    if (!draft.trim()) return;
    setChat(c => [...c, { user: me.id, text: draft, time: "방금" }]);
    setDraft("");
  };

  const speakingId = presenter.id; // presenter is speaking

  if (!live) {
    return (
      <>
        <Topbar crumbs={[{ label: "세미나 라이브" }]} onNavigate={onNavigate} />
        <div className="content">
          <div className="content-inner">
            <div className="live-empty">
              <div className="live-empty-icon"><Icon name="video" size={30} /></div>
              <div className="live-empty-title">진행 중인 라이브가 없습니다</div>
              <div className="live-empty-sub">
                지금은 열린 세미나가 없어요.<br/>
                새 라이브를 시작하면 팀원들에게 알림이 가고, 홈에 LIVE 배너가 떠요.
              </div>
              <div className="live-empty-actions">
                <button className="btn btn-primary btn-lg" onClick={() => { onSetLive(true); onToast && onToast("라이브 세미나를 시작했어요"); }}>
                  <Icon name="video" size={16} /> 라이브 시작하기
                </button>
                <button className="btn btn-secondary btn-lg" onClick={() => onNavigate("schedule")}>
                  <Icon name="calendar" size={15} /> 스케줄 보기
                </button>
              </div>
              <div className="live-empty-next">
                <span className="live-empty-next-label">다음 세미나</span>
                <span>이번 주 토요일 10:00 · 발표 {presenter.name}</span>
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="meet">
      {/* header */}
      <div className="meet-head">
        <div className="meet-head-l">
          <span className="live-pill"><span className="live-dot-sm" />LIVE</span>
          <div>
            <div className="meet-title">{pres.title}</div>
            <div className="meet-sub mono">{fmtElapsed(elapsed)} · 참가자 {window.TEAM.length}명</div>
          </div>
        </div>
        <div className="meet-head-r">
          <button className="meet-chip danger" onClick={() => { if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop()); onSetLive(false); onNavigate("dashboard"); onToast && onToast("라이브를 종료했어요"); }} title="라이브 종료">
            <Icon name="x" size={14} /> 종료
          </button>
          <button className="meet-chip" onClick={leave} title="나가기">
            <Icon name="back" size={14} /> 나가기
          </button>
        </div>
      </div>

      {/* body */}
      <div className="meet-body">
        <div className="meet-stage">
          {(
            <div className="meet-present">
              <div className="present-main">
                <div className="present-slide">
                  <span className="pres-slide-num">{String(slideIdx + 1).padStart(2, "0")} / {String(slides.length).padStart(2, "0")}</span>
                  <div className="present-badge"><Icon name="screen" size={13} /> {presenter.name}님이 발표 중</div>
                  <h2>{slides[slideIdx]?.title}</h2>
                  {slides[slideIdx]?.body && <p>{slides[slideIdx].body}</p>}
                </div>
                <div className="present-strip">
                  <button className="strip-nav" onClick={() => setSlideIdx(i => Math.max(0, i - 1))}><Icon name="chevron-left" size={16} /></button>
                  <div className="strip-dots">
                    {slides.map((_, i) => <span key={i} className={`strip-dot ${i === slideIdx ? "on" : ""}`} onClick={() => setSlideIdx(i)} />)}
                  </div>
                  <button className="strip-nav" onClick={() => setSlideIdx(i => Math.min(slides.length - 1, i + 1))}><Icon name="chevron-right" size={16} /></button>
                </div>
              </div>
              <div className="filmstrip">
                <MeetTile user={me} self camOn={camOn} videoRef={videoRef} muted={!micOn} speaking={false} />
                {others.map(u => (
                  <MeetTile key={u.id} user={u} muted={u.id !== speakingId} speaking={u.id === speakingId} />
                ))}
              </div>
            </div>
          )}

          {/* floating reactions */}
          <div className="float-layer">
            {floats.map(f => <span key={f.id} className="float-emoji" style={{ left: `${f.left}%` }}>{f.emoji}</span>)}
          </div>
        </div>

        {panel && (
          <aside className="meet-panel">
            <div className="meet-panel-head">
              <div className="meet-panel-tabs">
                <button className={panel === "chat" ? "on" : ""} onClick={() => setPanel("chat")}>채팅</button>
                <button className={panel === "people" ? "on" : ""} onClick={() => setPanel("people")}>참가자</button>
                <button className={panel === "files" ? "on" : ""} onClick={() => setPanel("files")}>자료</button>
              </div>
              <button className="icon-btn" onClick={() => setPanel(null)} style={{ color: "#a8a39a" }}><Icon name="x" size={16} /></button>
            </div>

            {panel === "chat" && (
              <>
                <div className="meet-chat">
                  {chat.map((c, i) => {
                    const u = window.findUser(c.user) || me;
                    return (
                      <div className="meet-msg" key={i}>
                        <Avatar user={u} size="sm" />
                        <div>
                          <div className="meet-msg-head"><b>{u.name}</b> <span>{c.time}</span></div>
                          <div className="meet-msg-text">{c.text}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="meet-compose">
                  <input value={draft} onChange={e => setDraft(e.target.value)} placeholder="모두에게 메시지..."
                    onKeyDown={e => { if (e.key === "Enter") sendChat(); }} />
                  <button className="icon-btn" onClick={sendChat} style={{ color: "var(--accent)" }}><Icon name="send" size={16} /></button>
                </div>
              </>
            )}

            {panel === "people" && (
              <div className="meet-people">
                {window.TEAM.map(u => (
                  <div className="meet-person" key={u.id}>
                    <Avatar user={u} size="sm" showPresence />
                    <div className="meet-person-info">
                      <div className="meet-person-name">{u.name}{u.id === me.id ? " (나)" : ""}{u.id === presenter.id ? " · 발표자" : ""}</div>
                      <div className="meet-person-role">{u.role}</div>
                    </div>
                    <Icon name={u.id === speakingId ? "mic" : "mic-off"} size={14} style={{ color: u.id === speakingId ? "#3ddc84" : "#767168" }} />
                  </div>
                ))}
              </div>
            )}

            {panel === "files" && (
              <div className="meet-files">
                <div className="meet-files-label">이 세미나 자료</div>
                {(window.PRES_EXTRA.pres1.assets).map((a, i) => (
                  <div className="meet-file" key={i} onClick={() => onToast && onToast(`${a.name} 다운로드 (시뮬레이션)`)}>
                    <div className={`paper-icon ${a.type}`}>{a.type.toUpperCase()}</div>
                    <div className="meet-file-info">
                      <div className="meet-file-name">{a.name}</div>
                      <div className="meet-file-size">{a.size}</div>
                    </div>
                    <Icon name="download" size={15} />
                  </div>
                ))}
                <button className="btn btn-secondary btn-sm" style={{ width: "100%", marginTop: 10 }}
                  onClick={() => onNavigate("presentation", { presId: "pres1" })}>
                  발표 페이지 열기 <Icon name="chevron-right" size={12} />
                </button>
              </div>
            )}
          </aside>
        )}
      </div>

      {/* controls */}
      <div className="meet-controls">
        <button className={`ctrl-btn ${!micOn ? "off" : ""}`} onClick={() => setMicOn(v => !v)}>
          <Icon name={micOn ? "mic" : "mic-off"} size={20} />
          <span>{micOn ? "음소거" : "마이크"}</span>
        </button>
        <button className={`ctrl-btn ${!camOn ? "off" : ""}`} onClick={() => setCamOn(v => !v)}>
          <Icon name={camOn ? "video" : "video-off"} size={20} />
          <span>{camOn ? "끄기" : "카메라"}</span>
        </button>
        <button className="ctrl-btn" onClick={() => onToast && onToast("화면 공유는 발표 페이지에서 가능해요 (데모)")}>
          <Icon name="screen" size={20} />
          <span>공유</span>
        </button>
        <button className={`ctrl-btn ${hand ? "active" : ""}`} onClick={() => { setHand(v => !v); if (!hand) react("✋"); }}>
          <Icon name="hand" size={20} />
          <span>손들기</span>
        </button>
        <div className="ctrl-react">
          {["👍", "🔥", "👏", "🤔", "🎉"].map(e => (
            <button key={e} className="react-btn" onClick={() => react(e)}>{e}</button>
          ))}
        </div>
        <button className={`ctrl-btn ${panel ? "active" : ""}`} onClick={() => setPanel(panel ? null : "chat")}>
          <Icon name="message" size={20} />
          <span>채팅</span>
        </button>
        <button className="ctrl-btn leave" onClick={leave}>
          <Icon name="logout" size={20} />
          <span>나가기</span>
        </button>
      </div>
    </div>
  );
}

window.MeetingScreen = MeetingScreen;
Object.assign(window, { MeetingScreen, MeetTile });
