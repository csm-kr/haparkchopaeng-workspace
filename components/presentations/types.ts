import type { AssetType } from "@/types";

// 발표 자료 화면 DTO — RSC(page)가 lib/presentations에서 채워 props로 내려준다(ADR-015).
// 댓글은 발표 자료에 귀속된다(ADR-004). 작성자는 서버가 세션에서 주입한다(R3).

/** 멘션 해소·아바타·작성자 표기에 쓰는 멤버 참조. */
export interface MemberRef {
  id: string;
  name: string;
  /** "@hajieun" — 앞의 @ 포함 */
  handle: string;
  initial: string;
  /** 멤버 색 토큰값 (예: "var(--m-ha)") */
  color: string;
}

export interface PresentationListItem {
  id: string;
  title: string;
  date: string;
  duration: string | null;
  slideCount: number;
  tags: string[];
  presenter: MemberRef | null;
}

export interface SlideView {
  title: string;
  subtitle?: string | null;
  body: string;
}

export interface AssetView {
  id: string;
  name: string;
  type: AssetType;
  size: string;
  url: string;
}

export interface VersionView {
  id: string;
  ver: string;
  note: string;
  createdAt: string;
  by: MemberRef | null;
}

export interface ReactionView {
  id: string;
  emoji: string;
  member: MemberRef | null;
}

export interface CommentView {
  id: string;
  /** @멘션은 본문 내 토큰으로 보존 — 렌더 시 링크화한다 */
  body: string;
  /** 특정 슬라이드 참조(없으면 전체) */
  slide: number | null;
  createdAt: string;
  author: MemberRef | null;
  reactions: ReactionView[];
}

export interface PresentationMeta {
  id: string;
  title: string;
  presenter: MemberRef | null;
  date: string;
  duration: string | null;
  slideCount: number;
  tags: string[];
  summary: string | null;
  keypoints: string[];
  slides: SlideView[];
}

export interface PresentationDetailView {
  presentation: PresentationMeta;
  assets: AssetView[];
  versions: VersionView[];
  comments: CommentView[];
}

/** 댓글 작성 입력 — authorId는 보내지 않는다(서버가 세션에서 주입, R3). */
export interface AddCommentInput {
  presentationId: string;
  body: string;
  slide: number | null;
}

/** 반응 토글 입력 — memberId는 보내지 않는다(서버가 세션에서 주입, R3). */
export interface ToggleReactionInput {
  presentationId: string;
  commentId: string;
  emoji: string;
}
