"use client";

import * as React from "react";
import Link from "next/link";
import { SmilePlus } from "lucide-react";
import { Avatar, Button, Card } from "@/components/ui";
import { cn } from "@/lib/utils";
import { parseMentions } from "./mentions";
import type {
  AddCommentInput,
  CommentView,
  MemberRef,
  ReactionView,
  ToggleReactionInput,
} from "./types";

// 회고 댓글 스레드 — 인터랙티브 섬(ADR-015). 댓글은 발표 자료에 귀속(ADR-004).
// CRITICAL: 작성자(authorId)·반응 주체(memberId)는 서버가 세션에서 주입한다 — 클라가 보내지 않는다(R3).
// CRITICAL: 검증은 인라인(빈 값) — 토스트 아님(R30). 낙관적 추가/토글 → 실패 시 롤백.

/** 반응으로 빠르게 달 수 있는 이모지 팔레트. */
const REACTION_PALETTE = ["👍", "🎉", "🙏", "👀"] as const;

export interface CommentThreadProps {
  presentationId: string;
  comments: CommentView[];
  members: MemberRef[];
  currentUser: MemberRef;
  addComment: (input: AddCommentInput) => Promise<CommentView>;
  toggleReaction: (input: ToggleReactionInput) => Promise<ReactionView[]>;
}

/** ISO 8601 → "MM.DD HH:mm" (mono 표기, locale 비의존). */
function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 본문을 @멘션 링크화해 렌더한다(매칭 안 되는 @는 일반 텍스트). */
function CommentBody({
  body,
  members,
}: {
  body: string;
  members: MemberRef[];
}) {
  const segments = parseMentions(body, members);
  return (
    <p className="text-[13px] whitespace-pre-wrap text-fg-muted">
      {segments.map((seg, i) =>
        seg.type === "mention" ? (
          <Link
            key={i}
            href="/team"
            className="rounded-sm font-medium text-accent hover:underline"
          >
            {seg.value}
          </Link>
        ) : (
          <React.Fragment key={i}>{seg.value}</React.Fragment>
        ),
      )}
    </p>
  );
}

interface ReactionGroup {
  emoji: string;
  count: number;
  reactedByMe: boolean;
  names: string[];
}

function groupReactions(
  reactions: ReactionView[],
  meId: string,
): ReactionGroup[] {
  const map = new Map<string, ReactionGroup>();
  for (const r of reactions) {
    const g = map.get(r.emoji) ?? {
      emoji: r.emoji,
      count: 0,
      reactedByMe: false,
      names: [],
    };
    g.count += 1;
    if (r.member?.id === meId) g.reactedByMe = true;
    if (r.member) g.names.push(r.member.name);
    map.set(r.emoji, g);
  }
  return [...map.values()];
}

export function CommentThread({
  presentationId,
  comments: initial,
  members,
  currentUser,
  addComment,
  toggleReaction,
}: CommentThreadProps) {
  // 마운트 후에는 로컬 상태가 진실 — 낙관적 추가/반응 토글을 여기서 관리한다.
  const [comments, setComments] = React.useState<CommentView[]>(initial);
  const [body, setBody] = React.useState("");
  const [slide, setSlide] = React.useState("");
  const [formError, setFormError] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [pickerFor, setPickerFor] = React.useState<string | null>(null);

  async function submit() {
    const text = body.trim();
    // 검증은 인라인 — 토스트가 아니라 입력 옆 안내(R30).
    if (!text) {
      setFormError("내용을 입력해주세요.");
      return;
    }
    const slideNum = slide.trim() ? Number(slide.trim()) : null;
    const slideRef =
      slideNum != null && Number.isInteger(slideNum) && slideNum > 0
        ? slideNum
        : null;

    const tempId = `temp-${Date.now()}`;
    const optimistic: CommentView = {
      id: tempId,
      body: text,
      slide: slideRef,
      createdAt: new Date().toISOString(),
      author: currentUser,
      reactions: [],
    };
    // 낙관적 반영(작성자 = 세션 사용자) 후 입력 비우기.
    setComments((prev) => [...prev, optimistic]);
    setBody("");
    setSlide("");
    setFormError(null);
    setActionError(null);

    try {
      const saved = await addComment({
        presentationId,
        body: text,
        slide: slideRef,
      });
      setComments((prev) => prev.map((c) => (c.id === tempId ? saved : c)));
    } catch {
      // 실패 시 롤백 + 인라인 안내(낙관적 UI 규약).
      setComments((prev) => prev.filter((c) => c.id !== tempId));
      setActionError("댓글을 남기지 못했어요. 잠깐 후 다시 시도해주세요.");
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Cmd/Ctrl+Enter 전송(USER_FLOW F5).
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void submit();
    }
  }

  async function react(commentId: string, emoji: string) {
    setPickerFor(null);
    setActionError(null);
    const prev = comments;

    // 낙관적 토글: 내 반응이 이미 있으면 제거, 없으면 추가(@@unique 동일 규칙).
    setComments((curr) =>
      curr.map((c) => {
        if (c.id !== commentId) return c;
        const mine = c.reactions.find(
          (r) => r.member?.id === currentUser.id && r.emoji === emoji,
        );
        if (mine) {
          return { ...c, reactions: c.reactions.filter((r) => r.id !== mine.id) };
        }
        return {
          ...c,
          reactions: [
            ...c.reactions,
            { id: `temp-${Date.now()}`, emoji, member: currentUser },
          ],
        };
      }),
    );

    try {
      const updated = await toggleReaction({ presentationId, commentId, emoji });
      setComments((curr) =>
        curr.map((c) => (c.id === commentId ? { ...c, reactions: updated } : c)),
      );
    } catch {
      setComments(prev);
      setActionError("반응을 바꾸지 못했어요. 잠깐 후 다시 시도해주세요.");
    }
  }

  return (
    <section aria-label="회고 댓글" className="flex flex-col gap-4">
      <h2 className="text-[16px] font-semibold text-fg">
        회고 댓글 {comments.length > 0 && `(${comments.length})`}
      </h2>

      {actionError && (
        <p
          role="alert"
          className="rounded-md bg-bg-subtle px-3 py-2 text-[13px] text-busy"
        >
          {actionError}
        </p>
      )}

      {comments.length === 0 ? (
        <Card className="px-4 py-8 text-center text-[13px] text-fg-subtle">
          첫 회고를 남겨보세요.
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {comments.map((c) => {
            const groups = groupReactions(c.reactions, currentUser.id);
            return (
              <li key={c.id}>
                <Card className="flex gap-2.5 p-3">
                  {c.author && (
                    <Avatar user={c.author} size="sm" className="mt-0.5" />
                  )}
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] font-medium text-fg">
                        {c.author?.name ?? "알 수 없음"}
                      </span>
                      <span className="font-mono text-[11px] text-fg-faint">
                        {formatTime(c.createdAt)}
                      </span>
                      {c.slide != null && (
                        <span className="rounded-sm bg-bg-subtle px-1.5 py-0.5 text-[11px] text-fg-subtle">
                          슬라이드 {c.slide}
                        </span>
                      )}
                    </div>

                    <CommentBody body={c.body} members={members} />

                    {/* 반응 — 색+이모지(개수) 병행, 내 반응은 강조(R29). */}
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {groups.map((g) => (
                        <button
                          key={g.emoji}
                          type="button"
                          onClick={() => react(c.id, g.emoji)}
                          aria-pressed={g.reactedByMe}
                          aria-label={`${g.emoji} 반응 ${g.count}개${
                            g.reactedByMe ? " (내 반응 포함)" : ""
                          }`}
                          title={g.names.join(", ")}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[12px] transition-colors",
                            g.reactedByMe
                              ? "border-accent bg-accent-soft text-accent"
                              : "border-border-token bg-bg-subtle text-fg-muted hover:bg-bg-hover",
                          )}
                        >
                          <span aria-hidden="true">{g.emoji}</span>
                          <span className="font-mono">{g.count}</span>
                        </button>
                      ))}

                      <span className="relative">
                        <button
                          type="button"
                          aria-label="반응 추가"
                          onClick={() =>
                            setPickerFor((id) => (id === c.id ? null : c.id))
                          }
                          className="inline-flex size-6 items-center justify-center rounded-full text-fg-faint hover:bg-bg-hover hover:text-fg"
                        >
                          <SmilePlus size={14} aria-hidden="true" />
                        </button>
                        {pickerFor === c.id && (
                          <span className="absolute z-10 mt-1 flex gap-1 rounded-md border border-border-token bg-bg-elevated p-1 shadow-[var(--shadow-lg)]">
                            {REACTION_PALETTE.map((emoji) => (
                              <button
                                key={emoji}
                                type="button"
                                aria-label={`${emoji} 반응`}
                                onClick={() => react(c.id, emoji)}
                                className="rounded-sm px-1.5 py-0.5 text-[14px] hover:bg-bg-hover"
                              >
                                {emoji}
                              </button>
                            ))}
                          </span>
                        )}
                      </span>
                    </div>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {/* 작성 — textarea(Cmd/Ctrl+Enter 전송)·슬라이드 참조(선택). */}
      <Card className="flex flex-col gap-2 p-3">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label="댓글 내용"
          placeholder="회고를 남겨보세요 (@로 멤버를 멘션)"
          rows={3}
          className="w-full resize-y rounded-sm border border-border-strong bg-bg-elevated px-3 py-[9px] text-sm text-fg outline-none transition-[border-color,box-shadow] placeholder:text-fg-faint focus:border-accent focus:ring-[3px] focus:ring-accent-soft"
        />
        {formError && (
          <p role="alert" className="text-[12px] text-busy">
            {formError}
          </p>
        )}
        <div className="flex items-center justify-between gap-2">
          <label className="flex items-center gap-1.5 text-[12px] text-fg-subtle">
            슬라이드
            <input
              type="number"
              min={1}
              value={slide}
              onChange={(e) => setSlide(e.target.value)}
              aria-label="슬라이드 번호(선택)"
              placeholder="선택"
              className="w-20 rounded-sm border border-border-strong bg-bg-elevated px-2 py-1 text-[12px] text-fg outline-none focus:border-accent focus:ring-[3px] focus:ring-accent-soft"
            />
          </label>
          <span className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-fg-faint">
              ⌘/Ctrl + Enter
            </span>
            <Button size="sm" onClick={submit}>
              보내기
            </Button>
          </span>
        </div>
      </Card>
    </section>
  );
}
