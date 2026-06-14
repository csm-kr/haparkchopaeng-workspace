import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

// 초대 링크 진입점 (ADR-018). (app) 그룹 밖이라 팀 없음 가드를 받지 않는다 —
// 초대받았지만 아직 팀이 없는 사용자가 합류할 수 있어야 하기 때문.
// 이 step은 라우팅·가드·복귀만 책임진다 — 실제 초대 수락 화면(토큰 검증·합류 버튼)은 step 4 소관.

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const session = await getSession();
  if (!session) {
    // 미로그인 → 로그인으로 보내되, 로그인 후 이 초대 링크로 복귀(next)하도록 보존.
    redirect(`/?next=${encodeURIComponent(`/invite/${token}`)}`);
  }

  // 인증됨 — 복귀 지점. 초대 수락 UI는 step 4가 채운다(여기선 최소 안내만).
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-lg border border-border-token bg-bg-elevated p-8 text-center">
        <h1 className="text-xl font-bold tracking-[-0.02em]">초대</h1>
        <p className="mt-2 text-sm leading-relaxed text-fg-muted">
          로그인했어요. 잠시 후 초대를 확인할 수 있어요.
        </p>
      </div>
    </main>
  );
}
