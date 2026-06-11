// ============================================
// 하박조팽 — Shell Components
// Icons, Avatar, Sidebar, Topbar, etc.
// ============================================

/* eslint-disable */
const { useState, useEffect, useRef, useMemo } = React;

// ============================================
// Icons — minimal stroke icons
// ============================================
function Icon({ name, size = 18, ...rest }) {
  const props = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    ...rest,
  };
  switch (name) {
    case "home": return <svg {...props}><path d="M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/></svg>;
    case "book": return <svg {...props}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5V21h15"/></svg>;
    case "bulb": return <svg {...props}><path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-4 10.5c.7.6 1.2 1.3 1.4 2.2l.1.3h5l.1-.3c.2-.9.7-1.6 1.4-2.2A6 6 0 0 0 12 3"/></svg>;
    case "users": return <svg {...props}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/></svg>;
    case "hash": return <svg {...props}><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>;
    case "search": return <svg {...props}><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>;
    case "bell": return <svg {...props}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>;
    case "settings": return <svg {...props}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1"/></svg>;
    case "plus": return <svg {...props}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>;
    case "upload": return <svg {...props}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>;
    case "file": return <svg {...props}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>;
    case "paperclip": return <svg {...props}><path d="M21 11.5 12.5 20a5 5 0 0 1-7-7L14 4.5a3 3 0 0 1 4.5 4.5L10 17.5a1 1 0 0 1-1.5-1.5L17 7.5"/></svg>;
    case "sparkles": return <svg {...props}><path d="m12 3-1.9 5.1L5 10l5.1 1.9L12 17l1.9-5.1L19 10l-5.1-1.9z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/></svg>;
    case "chevron-right": return <svg {...props}><polyline points="9 18 15 12 9 6"/></svg>;
    case "chevron-left": return <svg {...props}><polyline points="15 18 9 12 15 6"/></svg>;
    case "chevron-down": return <svg {...props}><polyline points="6 9 12 15 18 9"/></svg>;
    case "x": return <svg {...props}><line x1="6" y1="6" x2="18" y2="18"/><line x1="6" y1="18" x2="18" y2="6"/></svg>;
    case "smile": return <svg {...props}><circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>;
    case "send": return <svg {...props}><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>;
    case "message": return <svg {...props}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>;
    case "filter": return <svg {...props}><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>;
    case "grid": return <svg {...props}><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>;
    case "list": return <svg {...props}><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>;
    case "play": return <svg {...props}><polygon points="6 4 20 12 6 20 6 4" fill="currentColor"/></svg>;
    case "more": return <svg {...props}><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="6" cy="12" r="1.5" fill="currentColor"/><circle cx="18" cy="12" r="1.5" fill="currentColor"/></svg>;
    case "logout": return <svg {...props}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>;
    case "external": return <svg {...props}><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>;
    case "download": return <svg {...props}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>;
    case "calendar": return <svg {...props}><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>;
    case "command": return <svg {...props}><path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3"/></svg>;
    case "moon": return <svg {...props}><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>;
    case "logo": return <svg width={size} height={size} viewBox="0 0 24 24"><path d="M5 7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z" fill="currentColor" opacity="0.3"/><path d="M9 9h6M9 12h6M9 15h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>;
    case "back": return <svg {...props}><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>;
    case "thread": return <svg {...props}><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z"/></svg>;
    case "video": return <svg {...props}><path d="M16 8.5 21.4 5a1 1 0 0 1 1.6.8v12.4a1 1 0 0 1-1.6.8L16 15.5"/><rect x="2" y="5" width="14" height="14" rx="2.5"/></svg>;
    case "video-off": return <svg {...props}><path d="M16 8.5 21.4 5a1 1 0 0 1 1.6.8v12.4a1 1 0 0 1-1.6.8L16 15.5"/><path d="M14 19H4.5A2.5 2.5 0 0 1 2 16.5v-9A2.5 2.5 0 0 1 4.5 5H10"/><line x1="2" y1="2" x2="22" y2="22"/></svg>;
    case "mic": return <svg {...props}><rect x="9" y="2.5" width="6" height="11.5" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><line x1="12" y1="17.5" x2="12" y2="21"/><line x1="8.5" y1="21" x2="15.5" y2="21"/></svg>;
    case "mic-off": return <svg {...props}><line x1="2" y1="2" x2="22" y2="22"/><path d="M9.5 4.3A3 3 0 0 1 15 6v4"/><path d="M15 13.5a3 3 0 0 1-5 0V9"/><path d="M5.5 11a6.5 6.5 0 0 0 9.8 5.6M18.5 11a6.5 6.5 0 0 1-.4 2.2"/><line x1="12" y1="17.5" x2="12" y2="21"/><line x1="8.5" y1="21" x2="15.5" y2="21"/></svg>;
    case "screen": return <svg {...props}><rect x="2" y="3.5" width="20" height="13" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="16.5" x2="12" y2="21"/><path d="M12 12.5V7m0 0-2.2 2.2M12 7l2.2 2.2"/></svg>;
    case "hand": return <svg {...props}><path d="M18 11V6.2a1.8 1.8 0 0 0-3.6 0"/><path d="M14.4 10V4.4a1.8 1.8 0 0 0-3.6 0V10"/><path d="M10.8 10V5.6a1.8 1.8 0 0 0-3.6 0V14"/><path d="M18 8.5a1.8 1.8 0 0 1 3.6 0V14a8 8 0 0 1-8 8h-1.4a7 7 0 0 1-5-2.1l-3.4-3.5a1.8 1.8 0 0 1 2.6-2.5L7.2 15.6"/></svg>;
    case "emoji": return <svg {...props}><circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9.5" x2="9.01" y2="9.5"/><line x1="15" y1="9.5" x2="15.01" y2="9.5"/></svg>;
    case "pin": return <svg {...props}><path d="M12 2 9 9l-5 1 4 4-1 6 5-3 5 3-1-6 4-4-5-1z" opacity="0"/><path d="M9 4h6l-1 5 3 2v2H7v-2l3-2z"/><line x1="12" y1="15" x2="12" y2="21"/></svg>;
    case "lock": return <svg {...props}><rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/></svg>;
    case "grid-view": return <svg {...props}><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/></svg>;
    case "shield": return <svg {...props}><path d="M12 2.5 4.5 5.5v6c0 4.6 3.2 7.9 7.5 10 4.3-2.1 7.5-5.4 7.5-10v-6z"/></svg>;
    case "doc": return <svg {...props}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8.5" y1="13" x2="15.5" y2="13"/><line x1="8.5" y1="16.5" x2="13.5" y2="16.5"/></svg>;
    case "printer": return <svg {...props}><path d="M6 9V3h12v6"/><path d="M6 18H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="7"/></svg>;
    default: return null;
  }
}

window.Icon = Icon;

// ============================================
// Avatar
// ============================================
function Avatar({ user, size = "md", showPresence = false, onClick }) {
  if (!user) return null;
  const sizeClass = size === "sm" ? "sm" : size === "lg" ? "lg" : size === "xl" ? "xl" : "";
  return (
    <div
      className={`avatar ${sizeClass}`}
      style={{ background: user.color }}
      onClick={onClick}
    >
      {user.initial}
      {showPresence && (
        <span className={`presence presence-${user.presence}`} />
      )}
    </div>
  );
}

window.Avatar = Avatar;

// ============================================
// Sidebar
// ============================================
function Sidebar({ currentScreen, onNavigate, onCommandOpen, collapsed, onToggleCollapse, live }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-ws" onClick={() => onNavigate("dashboard")}>
        <div className="ws-logo">하박</div>
        <div className="ws-name">
          하박조팽
          <span className="ws-plan">리서치 워크스페이스</span>
        </div>
        <button className="sidebar-collapse" onClick={(e) => { e.stopPropagation(); onToggleCollapse && onToggleCollapse(); }} title={collapsed ? "사이드바 펼치기" : "사이드바 접기"}>
          <Icon name={collapsed ? "chevron-right" : "chevron-left"} size={15} />
        </button>
      </div>

      <button
        className="nav-item"
        style={{ margin: "0 8px 6px", background: "var(--bg-elevated)", border: "1px solid var(--border)", padding: "7px 10px" }}
        onClick={onCommandOpen}
      >
        <Icon name="search" size={14} style={{ color: "var(--fg-subtle)" }} />
        <span style={{ color: "var(--fg-subtle)", fontSize: 13, flex: 1, textAlign: "left" }}>검색...</span>
        <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--fg-faint)", background: "var(--bg-subtle)", padding: "2px 5px", borderRadius: 3 }}>⌘K</span>
      </button>

      {window.NAV_SECTIONS.map((section, si) => (
        <div className="sidebar-section" key={si}>
          <div className="sidebar-section-label">
            <span>{section.label}</span>
            <button className="add-btn"><Icon name="plus" size={12} /></button>
          </div>
          {section.items.map(item => (
            <div
              key={item.id}
              className={`nav-item ${currentScreen === item.id ? "active" : ""} ${item.unread ? "unread" : ""}`}
              onClick={() => onNavigate(item.id)}
              title={item.label}
            >
              <Icon name={item.icon} size={16} className="nav-icon" />
              <span>{item.label}</span>
              {item.live && live && <span className="nav-live" title="진행 중"><span className="nav-live-dot" />LIVE</span>}
              {!(item.live && live) && (item.count != null || item.unread) && (
                <span className="nav-count">{item.unread || item.count}</span>
              )}
            </div>
          ))}
        </div>
      ))}

      <div className="sidebar-spacer" />

      <div className="sidebar-members">
        <div className="sidebar-section-label" style={{ padding: "4px 8px 8px" }}>
          <span>온라인 — {window.TEAM.filter(u => u.presence === "online").length}/4</span>
        </div>
        {window.TEAM.map(member => (
          <div className="member-row" key={member.id} onClick={() => onNavigate("team", { focusMember: member.id })}>
            <Avatar user={member} size="sm" showPresence />
            <div className="member-info">
              <div className="member-name">{member.name}</div>
              <div className="member-status">{member.status}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="sidebar-user" onClick={() => onNavigate("profile")}>
        <Avatar user={window.CURRENT_USER} size="sm" showPresence />
        <div className="member-info">
          <div className="member-name">{window.CURRENT_USER.name}</div>
          <div className="member-status">{window.CURRENT_USER.role}</div>
        </div>
        <Icon name="settings" size={14} style={{ color: "var(--fg-subtle)" }} />
      </div>
    </aside>
  );
}

window.Sidebar = Sidebar;

// ============================================
// Topbar
// ============================================
function Topbar({ crumbs = [], actions, onNavigate }) {
  return (
    <header className="topbar">
      <div className="breadcrumb">
        {crumbs.map((c, i) => (
          <React.Fragment key={i}>
            {i > 0 && <Icon name="chevron-right" size={12} className="sep" />}
            <span
              className={i === crumbs.length - 1 ? "current" : ""}
              style={{ cursor: c.onClick ? "pointer" : "default" }}
              onClick={c.onClick}
            >
              {c.label}
            </span>
          </React.Fragment>
        ))}
      </div>
      <div className="topbar-actions">
        {actions}
        <button className="icon-btn" title="알림">
          <Icon name="bell" size={16} />
          <span className="badge" />
        </button>
        <button className="icon-btn" title="설정" onClick={() => onNavigate && onNavigate("profile")}>
          <Icon name="settings" size={16} />
        </button>
      </div>
    </header>
  );
}

window.Topbar = Topbar;

// ============================================
// Tag
// ============================================
function Tag({ children, variant = "default" }) {
  return (
    <span className={`tag ${variant !== "default" ? `tag-${variant}` : ""}`}>
      {children}
    </span>
  );
}
window.Tag = Tag;

// ============================================
// Toast
// ============================================
function Toaster({ toasts }) {
  return (
    <div className="toast-stack">
      {toasts.map(t => (
        <div className="toast" key={t.id}>
          <Icon name="sparkles" size={14} style={{ color: "oklch(0.7 0.18 280)" }} />
          {t.text}
        </div>
      ))}
    </div>
  );
}
window.Toaster = Toaster;

// ============================================
// Command palette
// ============================================
function CommandPalette({ open, onClose, onNavigate }) {
  const [q, setQ] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
    else setQ("");
  }, [open]);

  const items = useMemo(() => {
    const all = [
      ...window.PAPERS.map(p => ({ kind: "논문", title: p.title, action: () => onNavigate("paper", { paperId: p.id }) })),
      ...window.PRESENTATIONS.map(p => ({ kind: "발표", title: p.title, action: () => onNavigate("presentation", { presId: p.id }) })),
      { kind: "이동", title: "홈으로 이동", action: () => onNavigate("dashboard") },
      { kind: "이동", title: "논문으로 이동", action: () => onNavigate("library") },
      { kind: "이동", title: "발표로 이동", action: () => onNavigate("presentations") },
      { kind: "이동", title: "스케쥴로 이동", action: () => onNavigate("schedule") },
      { kind: "이동", title: "세미나 채팅으로 이동", action: () => onNavigate("lounge") },
      { kind: "세미나", title: "화상 세미나 입장", action: () => onNavigate("meeting") },
    ];
    if (!q.trim()) return all.slice(0, 8);
    const lower = q.toLowerCase();
    return all.filter(item => item.title.toLowerCase().includes(lower)).slice(0, 8);
  }, [q]);

  if (!open) return null;

  return (
    <div className="cmd-overlay" onClick={onClose}>
      <div className="cmd" onClick={e => e.stopPropagation()}>
        <div className="cmd-input">
          <Icon name="search" size={18} style={{ color: "var(--fg-subtle)" }} />
          <input
            ref={inputRef}
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="논문, 발표, 아이디어, 팀원 검색..."
            onKeyDown={e => {
              if (e.key === "Escape") onClose();
              if (e.key === "Enter" && items[0]) { items[0].action(); onClose(); }
            }}
          />
          <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--fg-faint)", background: "var(--bg-subtle)", padding: "3px 6px", borderRadius: 4 }}>ESC</span>
        </div>
        <div className="cmd-results">
          {items.length === 0 && (
            <div style={{ padding: "24px", textAlign: "center", color: "var(--fg-subtle)", fontSize: 13 }}>
              결과가 없습니다
            </div>
          )}
          {items.map((item, i) => (
            <div
              key={i}
              className={`cmd-result ${i === 0 ? "active" : ""}`}
              onClick={() => { item.action(); onClose(); }}
            >
              <Icon name={item.kind === "논문" ? "file" : item.kind === "발표" ? "play" : item.kind === "아이디어" ? "bulb" : "chevron-right"} size={14} style={{ color: "var(--fg-subtle)" }} />
              <span style={{ flex: 1 }}>{item.title}</span>
              <span className="cmd-kind">{item.kind}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
window.CommandPalette = CommandPalette;

// ============================================
// EmptyState
// ============================================
function EmptyState({ icon = "file", title, desc, action }) {
  return (
    <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--fg-muted)" }}>
      <div style={{ display: "inline-grid", placeItems: "center", width: 56, height: 56, borderRadius: "50%", background: "var(--bg-subtle)", marginBottom: 14 }}>
        <Icon name={icon} size={24} />
      </div>
      <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--fg)", margin: "0 0 4px" }}>{title}</h3>
      <p style={{ fontSize: 13, margin: 0 }}>{desc}</p>
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  );
}
window.EmptyState = EmptyState;

// Make sure components are global
Object.assign(window, { Icon, Avatar, Sidebar, Topbar, Tag, Toaster, CommandPalette, EmptyState });
