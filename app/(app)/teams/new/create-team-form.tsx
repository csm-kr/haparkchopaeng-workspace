"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Input } from "@/components/ui";
import { createTeamAction } from "./actions";

// 팀 만들기 폼 — 인터랙티브 섬(ADR-015). 쓰기는 Server Action(createTeamAction).
// CRITICAL: TEAM_LIMIT/SLUG_TAKEN 등 실패는 토스트가 아니라 인라인 메시지로(R30).

export function CreateTeamForm() {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  async function submit() {
    setError(null);
    setSubmitting(true);
    const result = await createTeamAction({
      name: name.trim(),
      slug: slug.trim() || undefined,
    });
    if (!result.ok) {
      // "최대 팀 수를 초과했어요."(TEAM_LIMIT)·"이미 사용 중인 주소예요."(SLUG_TAKEN) 등 인라인.
      setError(result.message);
      setSubmitting(false);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) void submit();
      }}
      className="flex flex-col gap-3"
    >
      <label className="flex flex-col gap-1.5 text-[13px] font-medium text-fg">
        팀 이름
        <Input
          aria-label="팀 이름"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="예: Robotics Lab"
          maxLength={30}
        />
      </label>
      <label className="flex flex-col gap-1.5 text-[13px] font-medium text-fg">
        팀 주소 <span className="text-fg-subtle">(선택)</span>
        <Input
          aria-label="팀 주소(선택)"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="영문 소문자로 시작 — 비우면 이름에서 자동 생성"
        />
      </label>

      {error && (
        <p role="alert" className="text-[12px] text-busy">
          {error}
        </p>
      )}

      <Button type="submit" disabled={!name.trim() || submitting} className="w-full">
        {submitting ? "만드는 중…" : "팀 만들기"}
      </Button>
    </form>
  );
}
