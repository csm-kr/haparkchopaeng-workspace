// ============================================
// 하박조팽 — Auth & Onboarding screens
// ============================================
/* eslint-disable */
const { useState: useAuthState } = React;

// ============================================
// Auth (Login + Signup)
// ============================================
function AuthScreen({ onAuth, onLegal }) {
  const [mode, setMode] = useAuthState("login");
  const [email, setEmail] = useAuthState("");
  const [password, setPassword] = useAuthState("");
  const [name, setName] = useAuthState("");

  const submit = (e) => {
    e?.preventDefault();
    onAuth(mode === "signup" ? "onboarding" : "dashboard");
  };

  return (
    <div className="auth-screen">
      <div className="auth-hero">
        <div className="auth-hero-deco" />
        <div className="auth-hero-content">
          <div className="auth-hero-logo">
            <div className="ws-logo">하박</div>
            <div>
              <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.02em" }}>하박조팽</div>
              <div style={{ fontSize: 12, color: "var(--fg-muted)", marginTop: 2 }}>research workspace</div>
            </div>
          </div>

          <h1>리서치는<br/>혼자 하는 게 아니야.</h1>
          <p>매주 모여 발표하고, 논문은 올리면 분석되고,<br/>자료와 일정이 한 자리에 쌓이는 곳.<br/>하박조팽 4명을 위한 공동 두뇌.</p>

          <div className="auth-features">
            <div className="auth-feature">
              <div className="auth-feature-icon"><Icon name="video" size={18} /></div>
              <div>
                <div className="auth-feature-title">세미나 라이브</div>
                <div className="auth-feature-desc">매주 토요일, 화상으로 모여 발표하고 함께 봐요</div>
              </div>
            </div>
            <div className="auth-feature">
              <div className="auth-feature-icon"><Icon name="sparkles" size={18} /></div>
              <div>
                <div className="auth-feature-title">논문 분석 관리</div>
                <div className="auth-feature-desc">PDF를 올리면 연구·재구현 관점으로 구조화 분석</div>
              </div>
            </div>
            <div className="auth-feature">
              <div className="auth-feature-icon"><Icon name="play" size={18} /></div>
              <div>
                <div className="auth-feature-title">자료 관리</div>
                <div className="auth-feature-desc">발표 자료를 쌓고 댓글로 회고를 남겨요</div>
              </div>
            </div>
            <div className="auth-feature">
              <div className="auth-feature-icon"><Icon name="calendar" size={18} /></div>
              <div>
                <div className="auth-feature-title">스케쥴 관리</div>
                <div className="auth-feature-desc">발표 순번·로테이션·참여 현황을 한눈에</div>
              </div>
            </div>
          </div>
        </div>

        <div style={{ position: "relative", zIndex: 1, fontSize: 12, color: "var(--fg-subtle)", display: "flex", gap: 16 }}>
          <span>© 2026 하박조팽</span>
          <span>·</span>
          <span style={{ cursor: "pointer" }} onClick={() => onLegal && onLegal("terms")}>이용약관</span>
          <span>·</span>
          <span style={{ cursor: "pointer" }} onClick={() => onLegal && onLegal("privacy")}>개인정보처리방침</span>
        </div>
      </div>

      <div className="auth-form-wrap">
        <form className="auth-form" onSubmit={submit}>
          <h2>{mode === "login" ? "다시 오셨네요" : "워크스페이스에 합류"}</h2>
          <p className="sub">
            {mode === "login" ? "소셜 계정으로 간편하게 로그인" : "팀에 초대된 계정으로 가입해주세요"}
          </p>

          <div className="auth-tabs">
            <div className={`auth-tab ${mode === "login" ? "active" : ""}`} onClick={() => setMode("login")}>로그인</div>
            <div className={`auth-tab ${mode === "signup" ? "active" : ""}`} onClick={() => setMode("signup")}>회원가입</div>
          </div>

          <button type="button" className="social-btn" onClick={submit}>
            <svg width="16" height="16" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
            Google로 {mode === "login" ? "로그인" : "가입"}
          </button>
          <button type="button" className="social-btn" onClick={submit}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.111.82-.261.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.4 3-.405 1.02.005 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>
            GitHub로 {mode === "login" ? "로그인" : "가입"}
          </button>

          <p style={{ fontSize: 12, color: "var(--fg-subtle)", textAlign: "center", marginTop: 24, lineHeight: 1.6 }}>
            계속 진행하면 <a style={{ color: "var(--accent)", cursor: "pointer" }} onClick={() => onLegal && onLegal("terms")}>이용약관</a> 및 <a style={{ color: "var(--accent)", cursor: "pointer" }} onClick={() => onLegal && onLegal("privacy")}>개인정보처리방침</a>에 동의하는 것으로 간주됩니다.
          </p>

          <p style={{ fontSize: 12, color: "var(--fg-subtle)", textAlign: "center", marginTop: 16 }}>
            {mode === "login" ? "계정이 없으신가요? " : "이미 계정이 있나요? "}
            <a style={{ color: "var(--accent)", cursor: "pointer" }} onClick={() => setMode(mode === "login" ? "signup" : "login")}>
              {mode === "login" ? "회원가입" : "로그인"}
            </a>
          </p>
        </form>
      </div>
    </div>
  );
}

window.AuthScreen = AuthScreen;

// ============================================
// Onboarding (4-step team setup)
// ============================================
function OnboardingScreen({ onComplete }) {
  const [step, setStep] = useAuthState(0);
  const [wsName, setWsName] = useAuthState("하박조팽");
  const [field, setField] = useAuthState("AI / ML");
  const [invites, setInvites] = useAuthState([
    { email: "park@university.ac.kr", role: "관리자" },
    { email: "cho@university.ac.kr", role: "멤버" },
    { email: "paeng@university.ac.kr", role: "멤버" },
  ]);

  const next = () => {
    if (step < 3) setStep(step + 1);
    else onComplete();
  };
  const back = () => step > 0 && setStep(step - 1);

  return (
    <div className="onboard-screen">
      <div className="onboard-container">
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 30 }}>
          <div className="ws-logo" style={{ width: 32, height: 32 }}>하박</div>
          <span style={{ fontSize: 14, fontWeight: 600 }}>하박조팽 셋업</span>
          <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--fg-subtle)" }}>{step + 1} / 4</span>
        </div>

        <div className="onboard-progress">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className={`onboard-step ${i < step ? "done" : i === step ? "current" : ""}`} />
          ))}
        </div>

        {step === 0 && (
          <>
            <h1 className="onboard-title">워크스페이스 이름은요?</h1>
            <p className="onboard-sub">팀이 부르는 이름을 적어주세요. 나중에 바꿀 수 있어요.</p>
            <div className="field">
              <label className="field-label">워크스페이스 이름</label>
              <input className="input" value={wsName} onChange={e => setWsName(e.target.value)} placeholder="예: 하박조팽" />
            </div>
            <div className="field">
              <label className="field-label">연구 분야</label>
              <input className="input" value={field} onChange={e => setField(e.target.value)} placeholder="예: AI / ML, 인지과학" />
            </div>
            <div style={{ fontSize: 12, color: "var(--fg-subtle)", marginTop: 8 }}>
              💡 연구 분야 정보는 AI가 논문 요약과 추천을 더 잘 해주는 데 사용돼요.
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <h1 className="onboard-title">팀원을 초대해요</h1>
            <p className="onboard-sub">하박조팽은 4명 팀이죠. 본인 제외 3명을 초대해주세요.</p>

            <div className="invite-grid">
              {invites.map((inv, i) => (
                <div className="invite-row" key={i}>
                  <Avatar user={{ initial: ["박", "조", "팽"][i] || "?", color: ["var(--m-bak)", "var(--m-jo)", "var(--m-paeng)"][i] || "var(--fg-faint)" }} />
                  <input
                    className="input"
                    value={inv.email}
                    onChange={e => {
                      const next = [...invites];
                      next[i] = { ...next[i], email: e.target.value };
                      setInvites(next);
                    }}
                    placeholder="email@university.ac.kr"
                  />
                  <select
                    className="role-select"
                    value={inv.role}
                    onChange={e => {
                      const next = [...invites];
                      next[i] = { ...next[i], role: e.target.value };
                      setInvites(next);
                    }}
                  >
                    <option>멤버</option>
                    <option>관리자</option>
                    <option>게스트</option>
                  </select>
                  <button className="icon-btn" type="button"><Icon name="x" size={14} /></button>
                </div>
              ))}
            </div>

            <button className="btn btn-ghost btn-sm" type="button" onClick={() => setInvites([...invites, { email: "", role: "멤버" }])}>
              <Icon name="plus" size={12} /> 더 초대
            </button>

            <div style={{ marginTop: 24, padding: 14, background: "var(--accent-faint)", borderRadius: "var(--r-md)", fontSize: 12, color: "var(--accent)", display: "flex", gap: 10, alignItems: "flex-start" }}>
              <Icon name="sparkles" size={14} />
              <div>
                초대받은 사람들은 이메일로 가입 링크를 받아요. 가입 전까지 자리는 비워둘게요.
              </div>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h1 className="onboard-title">어떤 자료를 자주 다루나요?</h1>
            <p className="onboard-sub">선택한 항목에 맞춰 AI 요약 템플릿이 맞춰져요.</p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 16 }}>
              {[
                { key: "paper", icon: "file", title: "논문 (PDF)", desc: "Abstract / Method / Result 자동 추출" },
                { key: "slides", icon: "play", title: "발표 슬라이드", desc: "주요 메시지 + 발표 후 정리" },
                { key: "notes", icon: "book", title: "리딩 노트", desc: "마크다운 협업 편집" },
                { key: "ideas", icon: "bulb", title: "아이디어 메모", desc: "관련 논문 자동 추천" },
              ].map(opt => (
                <label
                  key={opt.key}
                  style={{
                    display: "flex",
                    gap: 12,
                    padding: 16,
                    border: "1.5px solid var(--accent)",
                    borderRadius: "var(--r-md)",
                    background: "var(--accent-faint)",
                    cursor: "pointer",
                  }}
                >
                  <input type="checkbox" defaultChecked style={{ accentColor: "var(--accent)" }} />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
                      <Icon name={opt.icon} size={14} /> {opt.title}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--fg-muted)", marginTop: 4 }}>{opt.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h1 className="onboard-title">첫 자료를 올려볼까요?</h1>
            <p className="onboard-sub">건너뛰어도 괜찮아요. 나중에 라이브러리에서 언제든 추가할 수 있어요.</p>

            <div className="upload-zone" style={{ marginTop: 20 }}>
              <div className="upload-icon"><Icon name="upload" size={22} /></div>
              <h3>여기로 끌어다 놓으세요</h3>
              <p>PDF, PPT, PPTX, MD 파일을 지원해요</p>
              <button className="btn btn-secondary btn-sm" type="button">파일 선택</button>
              <div className="upload-types">
                <Tag>PDF</Tag>
                <Tag>PPTX</Tag>
                <Tag>MD</Tag>
                <Tag>URL</Tag>
              </div>
            </div>

            <div style={{ textAlign: "center", marginTop: 20, fontSize: 12, color: "var(--fg-subtle)" }}>
              파일을 올리면 자동으로 AI가 정리를 시작해요 ✨
            </div>
          </>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 40 }}>
          <button className="btn btn-ghost" onClick={back} disabled={step === 0} style={{ opacity: step === 0 ? 0 : 1 }}>
            <Icon name="back" size={14} /> 이전
          </button>
          <div style={{ display: "flex", gap: 10 }}>
            {step === 3 && (
              <button className="btn btn-secondary" onClick={onComplete}>나중에 할게요</button>
            )}
            <button className="btn btn-primary" onClick={next}>
              {step === 3 ? "워크스페이스 시작하기" : "다음"}
              <Icon name="chevron-right" size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

window.OnboardingScreen = OnboardingScreen;

Object.assign(window, { AuthScreen, OnboardingScreen });
