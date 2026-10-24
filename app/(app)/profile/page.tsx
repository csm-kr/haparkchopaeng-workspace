import { Topbar } from "@/components/shell";
import { Card } from "@/components/ui";
import { SettingsView } from "@/components/settings";
import type { ProfileView } from "@/components/settings";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Role } from "@/types";

// 설정/프로필 — RSC. 현재 멤버는 서버에서 Prisma 직접 조회(ADR-015/R32).
// 프로필 수정은 SettingsView가 기존 PATCH /api/me로 보낸다 — 새 엔드포인트 없음.
// 로딩 상태는 같은 폴더의 loading.tsx(스켈레톤)가 담당한다(R26).

export default async function ProfilePage() {
  // 인증은 (app)/layout이 보장 — 여기선 본인 식별만.
  const session = await getSession();

  let body: React.ReactNode;
  try {
    const member = session
      ? await prisma.member.findUnique({ where: { id: session.memberId } })
      : null;
    if (!member) throw new Error("member not found");

    const profile: ProfileView = {
      id: member.id,
      name: member.name,
      handle: member.handle,
      email: member.email,
      // role 허용값은 시드/검증으로 보장됨(DB는 String) — DTO Role로 좁힌다.
      role: member.role as Role,
      status: member.status,
      color: member.color,
      initial: member.initial,
    };
    body = <SettingsView profile={profile} />;
  } catch {
    // 조회 실패: 화면을 통째로 날리지 않고 인라인 에러 카드 + 다시 시도(R26/R30).
    body = (
      <div className="p-6">
        <Card className="flex flex-col items-center gap-3 px-6 py-12 text-center">
          <p className="text-[15px] font-semibold text-fg">
            설정을 불러오지 못했어요.
          </p>
          <p className="max-w-sm text-[13px] text-fg-muted">
            잠깐 후 다시 시도해주세요.
          </p>
          <a
            href="/profile"
            className="rounded-sm border border-border-strong px-3.5 py-1.5 text-[13px] font-medium text-fg hover:bg-bg-hover"
          >
            다시 시도
          </a>
        </Card>
      </div>
    );
  }

  return (
    <>
      <Topbar crumbs={[{ label: "설정" }]} />
      <div className="flex-1 overflow-y-auto">{body}</div>
    </>
  );
}
