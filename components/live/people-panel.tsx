"use client";

import { useParticipants } from "@livekit/components-react";
import { Hand, Mic, MicOff, Radio } from "lucide-react";
import { Avatar, Badge } from "@/components/ui";
import type { LiveMember } from "./types";

// 참가자 패널(내용만 — 헤더/탭은 MeetRoom이 제공) — LiveKit presence 기준 로스터.
// CRITICAL: 참가자는 LiveKit identity로 판별해 members에서 매핑(R3).
// CRITICAL: 마이크/발표자/손들기는 색에만 의존하지 않는다 — 아이콘 + 텍스트 병행(R29).

export interface PeoplePanelProps {
  members: LiveMember[];
  presenterId: string;
  currentMemberId: string;
  /** 손든 참가자 identity 집합. */
  hands: Set<string>;
}

export function PeoplePanel({
  members,
  presenterId,
  currentMemberId,
  hands,
}: PeoplePanelProps) {
  const participants = useParticipants();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
        {participants.length === 0 ? (
          <p className="m-auto max-w-[16rem] text-center text-[12px] text-fg-subtle">
            아직 아무도 없어요.
          </p>
        ) : (
          participants.map((p) => {
            const member = members.find((x) => x.id === p.identity);
            const user = member ?? {
              name: p.name || p.identity,
              initial: (p.name || p.identity).slice(0, 1).toUpperCase(),
              color: "var(--fg-faint)",
            };
            const isPresenter = p.identity === presenterId;
            const isSelf = p.identity === currentMemberId;
            const micOn = !!p.isMicrophoneEnabled;
            const handUp = hands.has(p.identity);
            return (
              <div
                key={p.identity}
                className="flex items-center gap-2 rounded-sm px-2 py-1.5"
              >
                <Avatar user={user} size="sm" />
                <span className="min-w-0 flex-1 truncate text-[13px] text-fg">
                  {user.name}
                  {isSelf && <span className="ml-1 text-fg-subtle">(나)</span>}
                </span>
                {handUp && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-away">
                    <Hand size={12} aria-hidden="true" />손 들었어요
                  </span>
                )}
                {isPresenter && (
                  <Badge variant="admin">
                    <Radio size={11} aria-hidden="true" />
                    발표자
                  </Badge>
                )}
                <span
                  className={
                    micOn
                      ? "inline-flex items-center gap-1 text-[11px] text-online"
                      : "inline-flex items-center gap-1 text-[11px] text-fg-subtle"
                  }
                >
                  {micOn ? (
                    <Mic size={12} aria-hidden="true" />
                  ) : (
                    <MicOff size={12} aria-hidden="true" />
                  )}
                  {micOn ? "마이크 켬" : "마이크 끔"}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
