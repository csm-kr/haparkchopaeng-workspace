import Link from "next/link";
import { getSession } from "@/lib/auth";
import { getInviteForAcceptance } from "@/lib/invite";
import { AcceptInviteButton } from "./accept-button";

// 초대 수락 화면 (ADR-018). (app) 그룹 밖이라 팀 없음 가드를 받지 않는다 —
// 초대받았지만 아직 팀이 없는 사용자도 합류할 수 있어야 하기 때문.
// 검증 순서: not_found → revoked → expired → used_up → ready (getInviteForAcceptance가 파생).
// CRITICAL: 합류는 acceptInvite(Server Action) 경유만. 토큰은 미노출(프리뷰엔 팀명·역할만).

// 합류 불가 사유 카드 카피(R30 — 시스템 코드 대신 사람말).
const REASON: Record<"not_found" | "revoked" | "expired" | "used_up", { title: string; desc: string }> = {
  not_found: {
    title: "초대를 찾을 수 없어요",
    desc: "링크가 올바른지 확인하거나, 팀 관리자에게 새 초대를 요청해주세요.",
  },
  revoked: {
    title: "회수된 초대예요",
    desc: "이 초대는 더 이상 쓸 수 없어요. 팀 관리자에게 새 초대를 요청해주세요.",
  },
  expired: {
    title: "초대 링크가 만료되었어요",
    desc: "유효 기간이 지났어요. 팀 관리자에게 새 초대를 요청해주세요.",
  },
  used_up: {
    title: "이 초대는 모두 사용되었어요",
    desc: "사용 횟수를 다 썼어요. 팀 관리자에게 새 초대를 요청해주세요.",
  },
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-lg border border-border-token bg-bg-elevated p-8">
        {children}
      </div>
    </main>
  );
}

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const preview = await getInviteForAcceptance(token);

  if (preview.status !== "ready") {
    const r = REASON[preview.status];
    return (
      <Shell>
        <h1 className="text-center text-xl font-bold tracking-[-0.02em] text-fg">{r.title}</h1>
        <p className="mt-2 text-center text-sm leading-relaxed text-fg-muted">{r.desc}</p>
        <Link
          href="/"
          className="mt-6 flex w-full items-center justify-center rounded-sm border border-border-strong px-3.5 py-2.5 text-sm font-medium text-fg hover:bg-bg-subtle"
        >
          홈으로
        </Link>
      </Shell>
    );
  }

  // ready — 팀명·역할(영어 그대로)을 보여주고 합류 경로를 제시한다.
  const session = await getSession();
  return (
    <Shell>
      <h1 className="text-center text-xl font-bold tracking-[-0.02em] text-fg">
        {preview.teamName} 팀에 초대받았어요
      </h1>
      <p className="mt-2 text-center text-sm leading-relaxed text-fg-muted">
        합류하면 <span className="font-medium text-fg">{preview.role}</span> 역할로 참여해요.
      </p>

      <div className="mt-6">
        {session ? (
          <AcceptInviteButton token={token} />
        ) : (
          <a
            href={`/api/auth/google?next=${encodeURIComponent(`/invite/${token}`)}`}
            className="flex w-full items-center justify-center rounded-sm bg-accent px-3.5 py-2.5 text-sm font-medium text-accent-fg hover:bg-accent-hover"
          >
            로그인하고 합류
          </a>
        )}
      </div>
    </Shell>
  );
}
