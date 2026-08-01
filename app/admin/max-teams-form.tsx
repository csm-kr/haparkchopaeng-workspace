"use client";

import * as React from "react";
import { Button, Input } from "@/components/ui";
import { setMaxTeamsAction } from "./actions";

// 전역 팀 상한 조절 폼 — 인터랙티브 섬(ADR-015). 쓰기는 Server Action(setMaxTeamsAction).
// CRITICAL: 실패는 토스트가 아니라 인라인 메시지로(R30). 서버가 최종 강제 — 여기 검증은 가시화일 뿐.

type Feedback = { tone: "ok" | "error"; text: string } | null;

export interface MaxTeamsFormProps {
  /** 현재 적용 중인 상한(DB > env > 2). */
  current: number;
  /** 서버 전체 팀 수 — 이보다 낮게는 못 줄인다는 안내에 쓴다. */
  teamCount: number;
}

export function MaxTeamsForm({ current, teamCount }: MaxTeamsFormProps) {
  const [value, setValue] = React.useState(String(current));
  const [feedback, setFeedback] = React.useState<Feedback>(null);
  const [saving, setSaving] = React.useState(false);

  async function save() {
    setSaving(true);
    setFeedback(null);
    const result = await setMaxTeamsAction({ value: Number(value) });
    setSaving(false);
    setFeedback(
      result.ok
        ? { tone: "ok", text: `저장했어요. 이제 최대 ${result.value}개까지 만들 수 있어요.` }
        : { tone: "error", text: result.message },
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="max-teams" className="text-[13px] font-medium text-fg">
        전역 팀 상한
      </label>
      <div className="flex items-center gap-2">
        <Input
          id="max-teams"
          type="number"
          min={1}
          max={100}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-24"
        />
        <Button type="button" onClick={save} disabled={saving}>
          {saving ? "저장 중…" : "저장"}
        </Button>
      </div>
      <p className="text-[12px] text-fg-subtle">
        서버 전체 기준이에요(사용자별 아님). 현재 {teamCount}개 만들어져 있어요.
      </p>
      {feedback && (
        <p
          role="alert"
          className={`text-[12px] ${feedback.tone === "ok" ? "text-fg-muted" : "text-busy"}`}
        >
          {feedback.text}
        </p>
      )}
    </div>
  );
}
