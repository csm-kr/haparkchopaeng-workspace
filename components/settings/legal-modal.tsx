"use client";

import * as React from "react";
import { FileText, Shield, X } from "lucide-react";
import { Card } from "@/components/ui";
import { cn } from "@/lib/utils";

// 약관 / 개인정보처리방침 시트 — 설정의 법적 링크에서 연다(SCREENS §legal).
// 정적 문서. 토큰만 사용하고(R20), Esc로 닫힌다(DESIGN_GUIDE §a11y).
// 표현은 ADR과 정합: AI는 "보조 분석"이지 자동 요약 헤드라인이 아니다(ADR-011).

export type LegalDoc = "terms" | "privacy";

const LEGAL_UPDATED = "2026년 6월 1일";

interface Block {
  h?: string;
  p?: string[];
  list?: string[];
}

const TERMS: Block[] = [
  {
    h: "제1조 (목적)",
    p: [
      '본 약관은 하박조팽(이하 "서비스")이 제공하는 4인 비공개 리서치 워크스페이스의 이용과 관련하여 회사와 회원 간의 권리·의무 및 책임사항을 규정함을 목적으로 합니다.',
    ],
  },
  {
    h: "제2조 (이용 자격)",
    p: [
      "서비스는 공개 회원가입을 제공하지 않으며, 합류는 관리자가 발급한 초대 링크를 통해서만 이루어집니다.",
    ],
  },
  {
    h: "제3조 (콘텐츠의 권리)",
    p: [
      "회원이 업로드한 논문(PDF)·발표 자료·노트·댓글의 저작권은 해당 회원 또는 원저작자에게 귀속됩니다. 회원은 제3자의 권리를 침해하지 않는 자료만 업로드해야 합니다.",
    ],
  },
  {
    h: "제4조 (AI 보조 분석의 한계)",
    p: [
      "논문 분석의 일부는 AI가 초안을 추출하는 보조 기능이며, 결과의 정확성·완전성을 보증하지 않습니다. 회원은 중요한 판단 전 원문과 섹션 노트를 직접 확인할 책임이 있습니다.",
    ],
  },
  {
    h: "제5조 (금지행위)",
    list: [
      "타인의 저작권 등 권리를 침해하는 자료의 업로드",
      "워크스페이스 내 자료를 권한 없이 외부에 유출하는 행위",
      "서비스의 정상적 운영을 방해하는 행위",
    ],
  },
  { h: "부칙", p: [`본 약관은 ${LEGAL_UPDATED}부터 시행합니다.`] },
];

const PRIVACY: Block[] = [
  {
    p: [
      '하박조팽(이하 "회사")은 「개인정보 보호법」 등 관련 법령을 준수하며, 이용자의 개인정보를 보호하기 위해 본 처리방침을 수립·공개합니다.',
    ],
  },
  {
    h: "1. 수집하는 항목",
    list: [
      "필수: 이메일, 이름, Google 로그인 식별자",
      "콘텐츠: 회원이 업로드한 논문·발표 자료·노트·댓글",
      "자동 수집: 접속 로그, 쿠키, 환경설정(테마 등)",
    ],
  },
  {
    h: "2. 이용 목적",
    list: [
      "회원 식별 및 워크스페이스 접근 권한 관리",
      "콘텐츠 보관·공유 및 AI 보조 분석 기능 제공",
      "협업 기능(댓글·멘션·라이브 세미나) 제공",
    ],
  },
  {
    h: "3. 보유 기간",
    p: [
      "개인정보는 회원이 워크스페이스를 떠나면 지체 없이 파기합니다. 다만 관련 법령에 따라 보존이 필요한 경우 해당 기간 동안 보관합니다.",
    ],
  },
  {
    h: "4. 이용자의 권리",
    p: [
      "이용자는 언제든지 자신의 개인정보 열람·정정·삭제를 요청할 수 있으며, 설정 화면 또는 관리자를 통해 행사할 수 있습니다.",
    ],
  },
  { h: "5. 고지의 의무", p: [`본 방침은 ${LEGAL_UPDATED}부터 적용됩니다.`] },
];

function LegalBody({ blocks }: { blocks: Block[] }) {
  return (
    <div className="flex flex-col gap-4">
      {blocks.map((b, i) => (
        <section key={i} className="flex flex-col gap-1.5">
          {b.h && (
            <h3 className="text-[14px] font-semibold text-fg">{b.h}</h3>
          )}
          {b.p?.map((para, j) => (
            <p key={j} className="text-[13px] leading-relaxed text-fg-muted">
              {para}
            </p>
          ))}
          {b.list && (
            <ul className="ml-4 flex list-disc flex-col gap-1 text-[13px] leading-relaxed text-fg-muted">
              {b.list.map((li, j) => (
                <li key={j}>{li}</li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

export function LegalModal({
  doc,
  onClose,
  onSwitch,
}: {
  doc: LegalDoc;
  onClose: () => void;
  onSwitch: (doc: LegalDoc) => void;
}) {
  const isTerms = doc === "terms";
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-[color-mix(in_oklch,var(--fg)_28%,transparent)] p-4"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <Card
        role="dialog"
        aria-modal="true"
        aria-label={isTerms ? "이용약관" : "개인정보처리방침"}
        className="flex max-h-[80vh] w-full max-w-2xl flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border-token px-4 py-3">
          <div role="tablist" className="flex gap-1">
            <button
              type="button"
              role="tab"
              aria-selected={isTerms}
              onClick={() => onSwitch("terms")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-[13px] font-medium",
                isTerms
                  ? "bg-bg-subtle text-fg"
                  : "text-fg-muted hover:bg-bg-hover hover:text-fg",
              )}
            >
              <FileText size={14} aria-hidden="true" /> 이용약관
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={!isTerms}
              onClick={() => onSwitch("privacy")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-[13px] font-medium",
                !isTerms
                  ? "bg-bg-subtle text-fg"
                  : "text-fg-muted hover:bg-bg-hover hover:text-fg",
              )}
            >
              <Shield size={14} aria-hidden="true" /> 개인정보처리방침
            </button>
          </div>
          <button
            type="button"
            aria-label="닫기"
            onClick={onClose}
            className="inline-flex size-8 items-center justify-center rounded-sm text-fg-muted hover:bg-bg-hover hover:text-fg"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="flex flex-col gap-4 overflow-y-auto px-5 py-5">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-[20px] font-semibold text-fg">
              {isTerms ? "이용약관" : "개인정보처리방침"}
            </h2>
            <span className="font-mono text-[11px] text-fg-subtle">
              최종 업데이트 · {LEGAL_UPDATED}
            </span>
          </div>
          <LegalBody blocks={isTerms ? TERMS : PRIVACY} />
          <p className="text-[11px] text-fg-faint">
            © 2026 하박조팽 · research workspace
          </p>
        </div>
      </Card>
    </div>
  );
}
