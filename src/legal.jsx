// ============================================
// 하박조팽 — 이용약관 / 개인정보처리방침
// 브랜드 톤의 인앱 문서 시트 (토글 + 인쇄)
// ============================================
/* eslint-disable */
const { useState: useLegalState } = React;

const LEGAL_UPDATED = "2026년 6월 1일";

const TERMS = [
  { h: "제1조 (목적)", p: ["본 약관은 하박조팽(이하 \"서비스\")이 제공하는 리서치 공유 워크스페이스의 이용과 관련하여 회사와 회원 간의 권리·의무 및 책임사항을 규정함을 목적으로 합니다."] },
  { h: "제2조 (정의)", list: [
    "\"회원\"이란 본 약관에 동의하고 서비스 이용 계약을 체결한 자를 말합니다.",
    "\"워크스페이스\"란 팀 단위로 자료·발표·아이디어를 공유하는 작업 공간을 말합니다.",
    "\"콘텐츠\"란 회원이 업로드한 논문(PDF)·발표자료·노트·아이디어 및 코멘트를 말합니다.",
    "\"AI 요약\"이란 업로드된 콘텐츠를 자동 분석하여 요약·구조화하는 기능을 말합니다.",
  ] },
  { h: "제3조 (약관의 효력 및 변경)", p: ["본 약관은 서비스 화면에 게시함으로써 효력이 발생합니다. 회사는 관련 법령을 위반하지 않는 범위에서 약관을 변경할 수 있으며, 변경 시 적용일자 및 사유를 명시하여 사전 공지합니다."] },
  { h: "제4조 (서비스의 제공)", list: [
    "논문·발표자료의 업로드, 보관, 검색 및 공유",
    "AI 기반 자동 요약 및 논문 분석(연구·재구현 관점)",
    "아이디어 보드, 화상 세미나, 팀 채팅 등 협업 기능",
    "회사는 서비스의 내용을 운영상·기술상 필요에 따라 변경할 수 있습니다.",
  ] },
  { h: "제5조 (계정 및 가입)", p: ["회원가입은 소셜 로그인(Google·GitHub) 또는 팀 초대를 통해 이루어집니다. 회원은 계정 정보를 정확하게 유지할 책임이 있으며, 계정의 관리 소홀로 발생한 손해에 대해 회사는 책임지지 않습니다."] },
  { h: "제6조 (콘텐츠의 권리)", p: ["회원이 업로드한 콘텐츠의 저작권은 해당 회원 또는 원저작자에게 귀속됩니다. 회원은 제3자의 저작권을 침해하지 않는 자료만 업로드해야 하며, 타 학술 자료의 업로드 시 라이선스 및 인용 규정을 준수해야 합니다. 회사는 서비스 제공 및 AI 분석 목적에 한해 콘텐츠를 처리할 수 있습니다."] },
  { h: "제7조 (AI 요약·분석의 한계)", p: ["AI 요약 및 분석 결과는 참고용 보조 정보이며, 정확성·완전성을 보증하지 않습니다. 회원은 중요한 의사결정 전 원문을 직접 확인할 책임이 있으며, AI가 추정한 수치(예: 하이퍼파라미터, GPU 자원)는 실제와 다를 수 있습니다."] },
  { h: "제8조 (금지행위)", list: [
    "타인의 저작권 등 권리를 침해하는 자료의 업로드",
    "서비스의 정상적 운영을 방해하는 행위",
    "워크스페이스 내 자료를 권한 없이 외부에 유출하는 행위",
    "자동화된 수단으로 서비스에 비정상적으로 접근하는 행위",
  ] },
  { h: "제9조 (책임의 제한)", p: ["회사는 천재지변, 회원의 귀책사유, 제3자 서비스(클라우드·AI API 등)의 장애로 인한 서비스 중단에 대해 고의 또는 중대한 과실이 없는 한 책임을 지지 않습니다."] },
  { h: "제10조 (준거법 및 분쟁해결)", p: ["본 약관은 대한민국 법령에 따라 해석되며, 서비스 이용과 관련한 분쟁은 회사의 본점 소재지를 관할하는 법원을 제1심 관할법원으로 합니다."] },
  { h: "부칙", p: [`본 약관은 ${LEGAL_UPDATED}부터 시행합니다.`] },
];

const PRIVACY = [
  { p: ["하박조팽(이하 \"회사\")은 「개인정보 보호법」 등 관련 법령을 준수하며, 이용자의 개인정보를 보호하기 위해 다음과 같이 개인정보처리방침을 수립·공개합니다."] },
  { h: "1. 수집하는 개인정보 항목", list: [
    "필수: 이메일, 이름, 소셜 로그인 식별자(Google·GitHub)",
    "자동 수집: 접속 로그, 기기·브라우저 정보, 쿠키, 서비스 이용 기록",
    "콘텐츠: 회원이 업로드한 논문·발표자료·노트·코멘트",
  ] },
  { h: "2. 개인정보의 수집·이용 목적", list: [
    "회원 식별 및 워크스페이스 접근 권한 관리",
    "콘텐츠 보관·공유 및 AI 요약·분석 기능 제공",
    "협업 기능(코멘트·멘션·화상 세미나·채팅) 제공",
    "서비스 개선, 오류 분석 및 보안 사고 대응",
  ] },
  { h: "3. 보유 및 이용 기간", p: ["개인정보는 회원 탈퇴 시 지체 없이 파기합니다. 다만 관련 법령에 따라 보존이 필요한 경우 해당 기간 동안 보관하며, 업로드 콘텐츠는 회원 또는 워크스페이스 관리자가 삭제할 때까지 보관됩니다."] },
  { h: "4. 개인정보 처리의 위탁", p: ["회사는 안정적 서비스 제공을 위해 아래 업무를 위탁할 수 있으며, 수탁자가 개인정보를 안전하게 처리하도록 관리·감독합니다."], list: [
    "클라우드 인프라(자료 저장·전송)",
    "AI 요약·분석 처리(요약·구조화 목적의 콘텐츠 처리)",
    "화상 세미나 미디어 전송(실시간 통신)",
  ] },
  { h: "5. 제3자 제공", p: ["회사는 이용자의 개인정보를 원칙적으로 외부에 제공하지 않습니다. 다만 법령에 근거하거나 수사기관의 적법한 요청이 있는 경우에 한해 제공할 수 있습니다."] },
  { h: "6. 이용자의 권리", p: ["이용자는 언제든지 자신의 개인정보 열람·정정·삭제·처리정지를 요청할 수 있으며, 설정 화면 또는 개인정보 보호책임자를 통해 행사할 수 있습니다."] },
  { h: "7. 개인정보의 파기", p: ["보유 기간이 경과하거나 처리 목적이 달성된 개인정보는 지체 없이 파기합니다. 전자적 파일은 복구가 불가능한 방법으로 삭제하며, 출력물은 분쇄 또는 소각합니다."] },
  { h: "8. 쿠키의 운영", p: ["회사는 로그인 유지 및 환경설정(테마·밀도 등)을 위해 쿠키 및 로컬 저장소를 사용합니다. 이용자는 브라우저 설정을 통해 저장을 거부할 수 있으나, 이 경우 일부 기능이 제한될 수 있습니다."] },
  { h: "9. 개인정보 보호책임자", list: [
    "책임자: 하수현 (PI)",
    "연락처: privacy@habakjopaeng.team",
  ] },
  { h: "10. 고지의 의무", p: [`본 방침은 ${LEGAL_UPDATED}부터 적용되며, 내용 추가·삭제·수정이 있을 경우 시행 전 서비스 화면을 통해 공지합니다.`] },
];

function LegalDoc({ blocks }) {
  return (
    <div className="legal-doc">
      {blocks.map((b, i) => (
        <section key={i} className="legal-block">
          {b.h && <h3 className="legal-h">{b.h}</h3>}
          {b.p && b.p.map((para, j) => <p key={j} className="legal-p">{para}</p>)}
          {b.list && <ul className="legal-ul">{b.list.map((li, j) => <li key={j}>{li}</li>)}</ul>}
        </section>
      ))}
    </div>
  );
}

function LegalModal({ doc, onClose, onSwitch }) {
  if (!doc) return null;
  const isTerms = doc === "terms";
  return (
    <div className="legal-overlay" onClick={onClose}>
      <div className="legal-sheet" onClick={e => e.stopPropagation()}>
        <div className="legal-head">
          <div className="legal-tabs">
            <button className={isTerms ? "on" : ""} onClick={() => onSwitch("terms")}><Icon name="doc" size={14} /> 이용약관</button>
            <button className={!isTerms ? "on" : ""} onClick={() => onSwitch("privacy")}><Icon name="shield" size={14} /> 개인정보처리방침</button>
          </div>
          <div className="legal-head-r">
            <button className="icon-btn" title="인쇄" onClick={() => window.print()} style={{ color: "var(--fg-muted)" }}><Icon name="printer" size={16} /></button>
            <button className="icon-btn" onClick={onClose} style={{ color: "var(--fg-muted)" }}><Icon name="x" size={16} /></button>
          </div>
        </div>
        <div className="legal-body">
          <div className="legal-title-row">
            <h1 className="legal-title">{isTerms ? "이용약관" : "개인정보처리방침"}</h1>
            <span className="legal-updated mono">최종 업데이트 · {LEGAL_UPDATED}</span>
          </div>
          <LegalDoc blocks={isTerms ? TERMS : PRIVACY} />
          <div className="legal-foot">© 2026 하박조팽 · research workspace</div>
        </div>
      </div>
    </div>
  );
}

window.LegalModal = LegalModal;
Object.assign(window, { LegalModal });
