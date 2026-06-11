// ============================================
// 하박조팽 — App router + Tweaks integration
// ============================================
/* eslint-disable */
const { useState: useAppState, useEffect: useAppEffect, useMemo: useAppMemo, useCallback: useAppCallback } = React;

// Tweak defaults — editable on disk
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "light",
  "density": "comfortable",
  "accent": "#8a5cf6",
  "anLayout": "stack"
}/*EDITMODE-END*/;

// Accent color → palette tokens
const ACCENT_PRESETS = {
  "#8a5cf6": { base: "0.58 0.20 280", hover: "0.54 0.20 280", soft: "0.95 0.04 280", faint: "0.97 0.02 280" },
  "#e5664a": { base: "0.62 0.19 25",  hover: "0.58 0.19 25",  soft: "0.95 0.04 25",  faint: "0.97 0.02 25"  },
  "#3a9b6e": { base: "0.55 0.16 145", hover: "0.5 0.16 145",  soft: "0.95 0.04 145", faint: "0.97 0.02 145" },
  "#3577d6": { base: "0.55 0.18 235", hover: "0.5 0.18 235",  soft: "0.95 0.04 235", faint: "0.97 0.02 235" },
};

function App() {
  // Authentication / flow state
  const [stage, setStage] = useAppState("auth"); // auth, onboarding, app
  const [screen, setScreen] = useAppState("dashboard");
  const [screenProps, setScreenProps] = useAppState({});
  const [uploadOpen, setUploadOpen] = useAppState(false);
  const [cmdOpen, setCmdOpen] = useAppState(false);
  const [toasts, setToasts] = useAppState([]);
  const [legal, setLegal] = useAppState(null); // null | 'terms' | 'privacy'
  const [collapsed, setCollapsed] = useAppState(false);
  const [live, setLive] = useAppState(false); // 진행 중인 라이브 세미나

  // Tweaks
  const tweaks = useTweaks ? useTweaks(TWEAK_DEFAULTS) : [TWEAK_DEFAULTS, () => {}];
  const t = tweaks[0];
  const setTweak = tweaks[1];

  // Apply theme + density to root
  useAppEffect(() => {
    document.documentElement.setAttribute("data-theme", t.theme || "light");
    document.documentElement.setAttribute("data-density", t.density || "comfortable");
    const a = ACCENT_PRESETS[t.accent] || ACCENT_PRESETS["#8a5cf6"];
    document.documentElement.style.setProperty("--accent", `oklch(${a.base})`);
    document.documentElement.style.setProperty("--accent-hover", `oklch(${a.hover})`);
    document.documentElement.style.setProperty("--accent-soft", `oklch(${a.soft})`);
    document.documentElement.style.setProperty("--accent-faint", `oklch(${a.faint})`);
  }, [t.theme, t.density, t.accent]);

  // Keyboard shortcuts
  useAppEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCmdOpen(true);
      }
      if (e.key === "Escape") {
        if (cmdOpen) setCmdOpen(false);
        else if (uploadOpen) setUploadOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cmdOpen, uploadOpen]);

  // Navigate helper
  const navigate = useAppCallback((id, props = {}) => {
    setScreen(id);
    setScreenProps(props);
    document.querySelector(".content")?.scrollTo({ top: 0 });
  }, []);

  // Toast helper
  const toast = useAppCallback((text) => {
    const id = Date.now();
    setToasts(ts => [...ts, { id, text }]);
    setTimeout(() => setToasts(ts => ts.filter(t => t.id !== id)), 2800);
  }, []);

  if (stage === "auth") {
    return (
      <>
        <AuthScreen onAuth={(next) => setStage(next === "onboarding" ? "onboarding" : "app")} onLegal={setLegal} />
        <LegalModal doc={legal} onClose={() => setLegal(null)} onSwitch={setLegal} />
      </>
    );
  }
  if (stage === "onboarding") {
    return (
      <>
        <OnboardingScreen onComplete={() => { setStage("app"); toast("환영합니다! 워크스페이스가 준비됐어요 🎉"); }} />
        <LegalModal doc={legal} onClose={() => setLegal(null)} onSwitch={setLegal} />
      </>
    );
  }

  // Main app
  let CurrentScreen;
  switch (screen) {
    case "library": CurrentScreen = <LibraryScreen onNavigate={navigate} onUpload={() => setUploadOpen(true)} />; break;
    case "presentations": CurrentScreen = <PresentationsScreen onNavigate={navigate} onToast={toast} />; break;
    case "schedule": CurrentScreen = <ScheduleScreen onNavigate={navigate} onToast={toast} />; break;
    case "lounge": CurrentScreen = <LoungeScreen onNavigate={navigate} />; break;
    case "meeting": CurrentScreen = <MeetingScreen onNavigate={navigate} onToast={toast} live={live} onSetLive={setLive} />; break;
    case "ideas": CurrentScreen = <IdeasScreen onNavigate={navigate} onToast={toast} />; break;
    case "team": CurrentScreen = <TeamScreen onNavigate={navigate} onToast={toast} />; break;
    case "profile": CurrentScreen = <ProfileScreen onNavigate={navigate} onToast={toast} onLegal={setLegal} />; break;
    case "search": CurrentScreen = <SearchScreen onNavigate={navigate} initialQuery={screenProps.query || "MoD"} />; break;
    case "paper": CurrentScreen = <PaperDetailScreen paperId={screenProps.paperId} onNavigate={navigate} onToast={toast} anLayout={t.anLayout} />; break;
    case "presentation": CurrentScreen = <PresentationScreen presId={screenProps.presId} onNavigate={navigate} onToast={toast} />; break;
    default: CurrentScreen = <DashboardScreen onNavigate={navigate} onUpload={() => setUploadOpen(true)} onToast={toast} live={live} />;
  }

  return (
    <>
      <div className={`app ${collapsed ? "rail" : ""}`}>
        <Sidebar
          currentScreen={screen}
          onNavigate={navigate}
          onCommandOpen={() => setCmdOpen(true)}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed(c => !c)}
          live={live}
        />
        <main className="main">
          {CurrentScreen}
        </main>
      </div>

      <CommandPalette
        open={cmdOpen}
        onClose={() => setCmdOpen(false)}
        onNavigate={navigate}
      />

      <UploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onNavigate={navigate}
        onToast={toast}
      />

      <Toaster toasts={toasts} />

      <LegalModal doc={legal} onClose={() => setLegal(null)} onSwitch={setLegal} />

      <TweaksPanel>
        <TweakSection label="외관">
          <TweakRadio label="테마" value={t.theme} options={[
            { value: "light", label: "라이트" },
            { value: "dark", label: "다크" },
          ]} onChange={v => setTweak("theme", v)} />
          <TweakColor
            label="액센트"
            value={t.accent}
            options={["#8a5cf6", "#e5664a", "#3a9b6e", "#3577d6"]}
            onChange={v => setTweak("accent", v)}
          />
          <TweakRadio label="밀도" value={t.density} options={[
            { value: "comfortable", label: "Comfortable" },
            { value: "compact", label: "Compact" },
          ]} onChange={v => setTweak("density", v)} />
        </TweakSection>

        <TweakSection label="논문 분석 레이아웃">
          <TweakRadio label="분석 탭" value={t.anLayout} options={[
            { value: "stack", label: "스택" },
            { value: "grid", label: "그리드" },
            { value: "toc", label: "문서" },
          ]} onChange={v => setTweak("anLayout", v)} />
        </TweakSection>

        <TweakSection label="흐름 점프">
          <TweakButton label="로그인 화면 다시 보기" onClick={() => setStage("auth")} />
          <TweakButton label="온보딩 다시 보기" onClick={() => setStage("onboarding")} />
          <TweakButton label="업로드 시뮬레이션" onClick={() => setUploadOpen(true)} />
          <TweakButton label="검색 결과 페이지" onClick={() => navigate("search", { query: "MoD" })} />
          <TweakButton label="화상 세미나 입장" onClick={() => navigate("meeting")} />
          <TweakButton label="논문 분석 보기" onClick={() => navigate("paper", { paperId: "p1" })} />
          <TweakButton label="이용약관 보기" onClick={() => setLegal("terms")} />
        </TweakSection>
      </TweaksPanel>
    </>
  );
}

// Mount
const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
