"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { acceptInviteAction } from "./actions";

// 합류 버튼 — 인터랙티브 섬(ADR-015). 로그인 상태에서만 노출된다(페이지가 게이팅).
// 실패 코드는 인라인 사유로 보인다(R30). 성공 시 대시보드로(엔티티는 아직 비-팀스코핑, ADR-018).

export function AcceptInviteButton({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  async function join() {
    setError(null);
    setSubmitting(true);
    const result = await acceptInviteAction(token);
    if (!result.ok) {
      setError(result.message);
      setSubmitting(false);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      <Button onClick={join} disabled={submitting} className="w-full">
        {submitting ? "합류 중…" : "합류"}
      </Button>
      {error && (
        <p role="alert" className="text-[12px] text-busy">
          {error}
        </p>
      )}
    </div>
  );
}
