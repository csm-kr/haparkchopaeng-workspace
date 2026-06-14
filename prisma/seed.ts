// 시드 — 깨끗한 시작 상태. 단일 워크스페이스 + 관리자 1명(실제 소유자)만 둔다.
// 멱등: 재실행 시 깨지지 않도록 모든 테이블을 사전 삭제 후 삽입.
// 실제 멤버는 관리자가 Team 페이지에서 초대 → Google 로그인 시 자동 생성(gateInvitedEmail).
import { prisma } from "@/lib/prisma";

// --- 단일 관리자(워크스페이스 소유자) ---
// CRITICAL: email은 실제 Google 계정과 일치해야 OAuth 로그인 시 이 멤버로 해소된다(invite-gate).
const ADMIN = {
  id: "jo",
  name: "조성민",
  handle: "@chominho",
  email: "de8167@gmail.com",
  color: "var(--m-jo)",
  initial: "조",
  presence: "online",
  status: null as string | null,
  role: "관리자",
};

async function main() {
  // 멱등: 자식 → 부모 순으로 전체 삭제.
  await prisma.reaction.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.presentationAsset.deleteMany();
  await prisma.presentationVersion.deleteMany();
  await prisma.presentation.deleteMany();
  await prisma.sectionNote.deleteMany();
  await prisma.figure.deleteMany();
  await prisma.analysis.deleteMany();
  await prisma.paper.deleteMany();
  await prisma.participant.deleteMany();
  await prisma.liveSession.deleteMany();
  await prisma.scheduleWeek.deleteMany();
  await prisma.scheduleMonth.deleteMany();
  await prisma.memberLedger.deleteMany();
  await prisma.fineConfig.deleteMany();
  await prisma.job.deleteMany();
  await prisma.invite.deleteMany();
  await prisma.member.deleteMany();
  await prisma.workspace.deleteMany();

  // 단일 워크스페이스 (ADR-007)
  await prisma.workspace.create({
    data: { name: "하박조팽", slug: "habakjopaeng", seats: 8 },
  });

  // 관리자 1명 (나머지는 초대로 합류)
  await prisma.member.create({
    data: {
      id: ADMIN.id, name: ADMIN.name, handle: ADMIN.handle, email: ADMIN.email, role: ADMIN.role,
      color: ADMIN.color, initial: ADMIN.initial, presence: ADMIN.presence, status: ADMIN.status, availability: "active",
    },
  });
}

main()
  .then(async () => {
    console.log("✅ 시드 완료");
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error("❌ 시드 실패", e);
    await prisma.$disconnect();
    process.exit(1);
  });
