import * as React from "react";
import { pickMemberColor } from "@/lib/member-color";
import type { AuthorSegment } from "@/lib/news";

// 저자 강조 렌더 — splitAuthors가 만든 AuthorSegment[]를 받아 팀원 이름만 색·굵게로 강조한다.
// 강조 색은 멤버 색 토큰(pickMemberColor)으로만 — hex 하드코딩 금지(R20).
// 데이터는 props로만(서버가 splitAuthors로 계산해 내려준다, ADR-015).

export interface AuthorLineProps {
  segments: AuthorSegment[];
  className?: string;
}

export function AuthorLine({ segments, className }: AuthorLineProps) {
  return (
    <span className={className}>
      {segments.map((seg, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span aria-hidden="true">, </span>}
          {seg.isMember ? (
            <strong
              data-member="true"
              className="font-semibold"
              style={{ color: pickMemberColor(seg.text) }}
            >
              {seg.text}
            </strong>
          ) : (
            <span>{seg.text}</span>
          )}
        </React.Fragment>
      ))}
    </span>
  );
}
