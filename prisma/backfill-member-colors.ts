// 일회성 백필 — 기존 멤버 아바타 색을 pickMemberColor(email)로 재분배한다.
// 배경: 과거 findOrCreateMember가 모든 멤버에 color="var(--m-jo)"를 하드코딩해 아바타가 전부 같은 색이었다.
// 멱등: pickMemberColor는 결정적이라 재실행해도 결과가 같다.
// 실행: npx tsx prisma/backfill-member-colors.ts
import { prisma } from "@/lib/prisma";
import { pickMemberColor } from "@/lib/member-color";

async function main() {
  const members = await prisma.member.findMany({ select: { id: true, email: true, color: true } });
  let changed = 0;
  for (const m of members) {
    const next = pickMemberColor(m.email);
    if (next !== m.color) {
      await prisma.member.update({ where: { id: m.id }, data: { color: next } });
      changed++;
    }
  }
  console.log(`backfill 완료: 멤버 ${members.length}명 중 ${changed}명 색 갱신`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
