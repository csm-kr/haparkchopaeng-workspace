// ============================================
// 하박조팽 — 세미나 스케줄 (단일 컬럼, 전부 설정 가능)
// 월별 편성: 빈 달 → '일정 짜기' → edit 모드 → 저장 → 확정(display) 모드
// 시간/발표자/주제 편집 · 벌금 설정 · 연도별 현황
// ============================================
/* eslint-disable */
const { useState: useSchedState, useMemo: useSchedMemo } = React;

const SCHED_MONTHS = ["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"];

// 해당 연·월의 모든 토요일 '일' 배열
function saturdaysOf(year, month /*1-12*/) {
  const days = [];
  const d = new Date(year, month - 1, 1);
  while (d.getMonth() === month - 1) {
    if (d.getDay() === 6) days.push(d.getDate());
    d.setDate(d.getDate() + 1);
  }
  return days;
}

// 빈 일정 초안 생성 (로테이션 이어서, 주제는 비움)
function draftMonth(year, month, startIdx) {
  const sats = saturdaysOf(year, month);
  const order = window.TEAM.map(u => u.id);
  return sats.map((day, i) => ({
    week: i + 1,
    date: `${month}월 ${day}일`,
    time: "10:00",
    presenter: order[(startIdx + i) % order.length],
    topic: "",
    confirmed: false,
    presId: null,
  }));
}

function ScheduleScreen({ onNavigate, onToast }) {
  // 월별 저장소: key `${year}-${month}` → { weeks, saved:true }
  const [store, setStore] = useSchedState(() => ({
    [`${window.SCHEDULE.year}-${window.SCHEDULE.month}`]: {
      weeks: window.SCHEDULE.weeks.map(w => ({ ...w, confirmed: true })),
      saved: true,
    },
  }));
  const [year, setYear] = useSchedState(window.SCHEDULE.year);
  const [month, setMonth] = useSchedState(window.SCHEDULE.month);
  const [editing, setEditing] = useSchedState(false);
  const [draft, setDraft] = useSchedState(null); // 편집 중 weeks
  const [rotEnd, setRotEnd] = useSchedState(window.SCHEDULE.weeks.length % window.TEAM.length);

  // 벌금 설정
  const [finePresenter, setFinePresenter] = useSchedState(window.SEMINAR_STATS.finePresenter);
  const [fineAbsent, setFineAbsent] = useSchedState(window.SEMINAR_STATS.fineAbsent);
  const [editFine, setEditFine] = useSchedState(false);

  const S = window.SEMINAR_STATS;
  const fmtWon = (n) => n.toLocaleString("ko-KR") + "원";
  const key = `${year}-${month}`;
  const saved = store[key]; // {weeks, saved} | undefined
  const weeks = editing ? draft : (saved ? saved.weeks : null);

  const goMonth = (delta) => {
    if (editing) { onToast && onToast("편집 중에는 달을 옮길 수 없어요. 저장하거나 취소해주세요"); return; }
    let m = month + delta, y = year;
    if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; }
    setYear(y); setMonth(m);
  };

  const startPlanning = () => {
    setDraft(draftMonth(year, month, rotEnd));
    setEditing(true);
  };
  const editExisting = () => {
    setDraft(saved.weeks.map(w => ({ ...w })));
    setEditing(true);
  };
  const cancelEdit = () => { setEditing(false); setDraft(null); };
  const savePlan = () => {
    setStore(s => ({ ...s, [key]: { weeks: draft.map(w => ({ ...w })), saved: true } }));
    setRotEnd(r => (r + draft.length) % window.TEAM.length);
    setEditing(false); setDraft(null);
    onToast && onToast(`${year}년 ${SCHED_MONTHS[month - 1]} 일정을 저장했어요`);
  };

  const upd = (idx, patch) => setDraft(ws => ws.map((w, i) => i === idx ? { ...w, ...patch } : w));

  const currentIdx = useSchedMemo(() => {
    if (!saved) return -1;
    const i = saved.weeks.findIndex(w => w.status !== "done");
    return i === -1 ? saved.weeks.length - 1 : i;
  }, [saved]);

  const saveFine = () => { setEditFine(false); onToast && onToast("벌금 설정을 저장했어요"); };

  return (
    <>
      <Topbar crumbs={[{ label: "스케쥴" }]} onNavigate={onNavigate} />
      <div className="content">
        <div className="content-inner">
          <div style={{ marginBottom: 22 }}>
            <h1 className="h1">세미나 스케줄</h1>
            <div style={{ marginTop: 8, fontSize: 14, color: "var(--fg-muted)" }}>
              매주 <b style={{ color: "var(--accent)" }}>토요일</b> · 4주차 로테이션 · 매달 직접 편성
            </div>
          </div>

          <div className="sched-col">
            {/* 날짜 보드 */}
            <div className="sched-board">
              <div className="sched-board-head">
                <div className="sched-month-nav">
                  <button className="sched-month-btn" onClick={() => goMonth(-1)} title="이전 달"><Icon name="chevron-left" size={16} /></button>
                  <h2 className="h2" style={{ minWidth: 110, textAlign: "center" }}>{year}년 {SCHED_MONTHS[month - 1]}</h2>
                  <button className="sched-month-btn" onClick={() => goMonth(1)} title="다음 달"><Icon name="chevron-right" size={16} /></button>
                </div>
                {editing
                  ? <span className="sched-mode-pill edit"><span className="live-dot-sm" />편집 모드</span>
                  : saved
                    ? <button className="btn btn-ghost btn-sm" onClick={editExisting}><Icon name="settings" size={13} /> 수정</button>
                    : null}
              </div>

              {/* 빈 달 — 일정 없음 */}
              {!weeks && (
                <div className="sched-empty">
                  <div className="sched-empty-icon"><Icon name="calendar" size={26} /></div>
                  <div className="sched-empty-title">이 달은 아직 일정이 없습니다</div>
                  <div className="sched-empty-sub">{year}년 {SCHED_MONTHS[month - 1]}의 토요일 세미나를 편성해보세요.</div>
                  <button className="btn btn-primary" onClick={startPlanning}><Icon name="plus" size={13} /> 일정 짜기</button>
                </div>
              )}

              {/* 편집 모드 */}
              {editing && weeks && weeks.map((w, idx) => {
                const p = window.findUser(w.presenter);
                return (
                  <div className={`sched-row edit ${w.confirmed ? "confirmed" : ""}`} key={w.week}>
                    <div className="sched-row-main">
                      <label className="sched-check" title="확정">
                        <input type="checkbox" checked={w.confirmed} onChange={e => upd(idx, { confirmed: e.target.checked })} />
                        <span className="sched-check-box"><Icon name="chevron-right" size={11} /></span>
                      </label>
                      <div className="sched-row-date">
                        <div className="sched-row-week">{w.week}주차</div>
                        <div className="sched-row-day mono">{w.date}</div>
                      </div>
                      <div className="sched-time-wrap">
                        <Icon name="calendar" size={13} style={{ color: "var(--fg-subtle)" }} />
                        <input type="time" className="sched-time" value={w.time} onChange={e => upd(idx, { time: e.target.value })} />
                      </div>
                      <div className="sched-row-presenter">
                        {p && <Avatar user={p} size="sm" />}
                        <select className="sched-select" value={w.presenter} onChange={e => upd(idx, { presenter: e.target.value })}>
                          {window.TEAM.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                        </select>
                      </div>
                    </div>
                    <input
                      className="sched-topic-input"
                      value={w.topic}
                      placeholder="발표 주제 입력…"
                      onChange={e => upd(idx, { topic: e.target.value })}
                    />
                  </div>
                );
              })}

              {/* 확정(display) 모드 */}
              {!editing && weeks && weeks.map((w, idx) => {
                const p = window.findUser(w.presenter);
                const isDone = w.status === "done";
                const isCurrent = idx === currentIdx;
                const hasTopic = !!w.topic;
                return (
                  <div key={w.week} className={`sched-row ${isCurrent ? "current" : ""} ${isDone ? "done" : ""}`}>
                    <div className="sched-row-main">
                      <div className="sched-row-date">
                        <div className="sched-row-week">{w.week}주차</div>
                        <div className="sched-row-day mono">{w.date}</div>
                      </div>
                      <div className="sched-time-static mono"><Icon name="calendar" size={12} /> {w.time}</div>
                      <div className="sched-row-presenter">
                        {p && <Avatar user={p} size="sm" />}
                        <span className="sched-presenter-name">{p ? p.name : "미정"}</span>
                      </div>
                      <div className="sched-row-status">
                        {isDone && <span className="sched-status done">완료</span>}
                        {isCurrent && !isDone && <span className="sched-status now"><span className="live-dot-sm" />이번 주</span>}
                        {!isCurrent && !isDone && <span className="sched-status soon">발표예정</span>}
                      </div>
                      <div className="sched-row-action">
                        {isDone && w.presId && (
                          <button className="btn btn-secondary btn-sm" onClick={() => onNavigate("presentation", { presId: w.presId })}><Icon name="play" size={12} /> 자료</button>
                        )}
                        {isCurrent && !isDone && (
                          <button className="btn btn-primary btn-sm" onClick={() => onNavigate("meeting")}><Icon name="video" size={12} /> 입장</button>
                        )}
                        {!isCurrent && !isDone && (w.presId
                          ? <button className="btn btn-ghost btn-sm" onClick={() => onNavigate("presentation", { presId: w.presId })}>미리보기</button>
                          : <span className="sched-pending">준비 전</span>)}
                      </div>
                    </div>
                    <div className={`sched-row-topic ${hasTopic ? "" : "empty"}`}>{hasTopic ? w.topic : "주제 미정"}</div>
                  </div>
                );
              })}

              {/* 편집 액션 바 */}
              {editing && (
                <div className="sched-edit-bar">
                  <span className="sched-edit-hint">확정 {weeks.filter(w => w.confirmed).length}/{weeks.length} · 주제·발표자를 채우고 저장하세요</span>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn btn-ghost btn-sm" onClick={cancelEdit}>취소</button>
                    <button className="btn btn-primary btn-sm" onClick={savePlan}><Icon name="download" size={12} /> 저장</button>
                  </div>
                </div>
              )}
            </div>

            {/* 벌금 설정 */}
            <div className="sched-board">
              <div className="sched-board-head">
                <h2 className="h2">벌금 설정</h2>
                {editFine
                  ? <button className="btn btn-primary btn-sm" onClick={saveFine}>저장</button>
                  : <button className="btn btn-ghost btn-sm" onClick={() => setEditFine(true)}><Icon name="settings" size={13} /> 수정</button>}
              </div>
              <div className="sched-fine-grid">
                <div className="sched-fine-item">
                  <div className="sched-fine-label"><span className="sched-fine-dot pres" /> 발표자 불참</div>
                  {editFine
                    ? <div className="sched-fine-edit"><input type="number" step="1000" min="0" value={finePresenter} onChange={e => setFinePresenter(+e.target.value)} />원</div>
                    : <div className="sched-fine-amt">{fmtWon(finePresenter)}</div>}
                  <div className="sched-fine-desc">발표 차례인데 빠질 때</div>
                </div>
                <div className="sched-fine-item">
                  <div className="sched-fine-label"><span className="sched-fine-dot abs" /> 일반 불참</div>
                  {editFine
                    ? <div className="sched-fine-edit"><input type="number" step="1000" min="0" value={fineAbsent} onChange={e => setFineAbsent(+e.target.value)} />원</div>
                    : <div className="sched-fine-amt">{fmtWon(fineAbsent)}</div>}
                  <div className="sched-fine-desc">참석만 안 할 때</div>
                </div>
              </div>
            </div>

            {/* 로테이션 */}
            <div className="sched-board">
              <div className="sched-board-head"><h2 className="h2">로테이션</h2></div>
              <div className="sched-rotation">
                {window.TEAM.map((u, i) => (
                  <React.Fragment key={u.id}>
                    {i > 0 && <Icon name="chevron-right" size={13} style={{ color: "var(--fg-faint)" }} />}
                    <span className="sched-rot-chip"><Avatar user={u} size="sm" /> {u.name}</span>
                  </React.Fragment>
                ))}
              </div>
              <div className="sched-hint">하수현 → 박진희 → 조성민 → 팽진욱 순서로 순환하며, 새 달을 짜면 이어서 배정돼요.</div>
            </div>

            {/* 연도별 멤버 현황 */}
            <div className="sched-board">
              <div className="sched-board-head">
                <h2 className="h2">{S.year} 멤버 현황</h2>
                <span className="sched-fine-note mono">발표자 {fmtWon(finePresenter)} · 일반 {fmtWon(fineAbsent)}</span>
              </div>
              <div className="dtable-wrap">
                <table className="dtable sched-stats">
                  <thead>
                    <tr>
                      <th className="lead">멤버</th><th>참여</th><th>발표자 불참</th><th>일반 불참</th><th>누적 벌금</th><th>납부액</th><th>미납</th>
                    </tr>
                  </thead>
                  <tbody>
                    {window.TEAM.map(u => {
                      const st = S.members[u.id] || { count: 0, missedPresenter: 0, missedAbsent: 0, paid: 0 };
                      const owed = st.missedPresenter * finePresenter + st.missedAbsent * fineAbsent;
                      const unpaid = owed - st.paid;
                      return (
                        <tr key={u.id}>
                          <td className="lead"><div className="sched-stat-name"><Avatar user={u} size="sm" />{u.name}</div></td>
                          <td>{st.count}회</td>
                          <td>{st.missedPresenter}회</td>
                          <td>{st.missedAbsent}회</td>
                          <td>{fmtWon(owed)}</td>
                          <td>{fmtWon(st.paid)}</td>
                          <td className={unpaid > 0 ? "unpaid" : ""}>{unpaid > 0 ? fmtWon(unpaid) : "완납"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="sched-hint">발표자 불참은 {fmtWon(finePresenter)}, 일반 불참은 {fmtWon(fineAbsent)}으로 정산해요.</div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

window.ScheduleScreen = ScheduleScreen;
Object.assign(window, { ScheduleScreen });
