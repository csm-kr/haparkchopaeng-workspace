import type { MemberRef } from "./types";

// @멘션 파싱 — 본문 내 "@토큰"을 멤버로 해소해 링크화 대상 세그먼트로 쪼갠다.
// 알림 트리거는 미결(ISSUES I-5) — 지금은 파싱·링크화만 한다.

export type MentionSegment =
  | { type: "text"; value: string }
  | { type: "mention"; value: string; member: MemberRef };

// @ 뒤의 한글/영문/숫자/언더스코어 연속을 토큰으로 본다.
const MENTION_RE = /@([A-Za-z0-9_가-힣]+)/g;

/** 토큰(@ 제외)이 멤버 이름 또는 핸들(앞의 @ 제외)과 일치하면 그 멤버를 돌려준다. */
function resolve(token: string, members: MemberRef[]): MemberRef | null {
  for (const m of members) {
    if (m.name === token) return m;
    // handle은 "@hajieun" 형태 — 앞의 @를 떼고 비교한다.
    if (m.handle.replace(/^@/, "") === token) return m;
  }
  return null;
}

/**
 * 본문을 텍스트/멘션 세그먼트 배열로 분해한다.
 * 매칭되지 않는 "@..."는 일반 텍스트로 남긴다(잘못된 멘션을 링크화하지 않음).
 */
export function parseMentions(
  body: string,
  members: MemberRef[],
): MentionSegment[] {
  const segments: MentionSegment[] = [];
  let lastIndex = 0;

  for (const match of body.matchAll(MENTION_RE)) {
    const token = match[1];
    const start = match.index ?? 0;
    const member = resolve(token, members);
    if (!member) continue; // 일반 텍스트로 흘려보낸다(아래 tail에서 포함).

    if (start > lastIndex) {
      segments.push({ type: "text", value: body.slice(lastIndex, start) });
    }
    segments.push({ type: "mention", value: match[0], member });
    lastIndex = start + match[0].length;
  }

  if (lastIndex < body.length) {
    segments.push({ type: "text", value: body.slice(lastIndex) });
  }
  return segments;
}
