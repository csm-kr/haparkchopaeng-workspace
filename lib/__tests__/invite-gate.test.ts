import { beforeEach, describe, expect, it, vi } from "vitest";

// 신원(IdP)으로 검증된 이메일을 Member로 해소하는 로직을 prisma 인메모리 목으로 검증한다.
// 멀티팀(ADR-018): 로그인은 누구나 — 거부 게이트(gateInvitedEmail)는 제거됐다. 합류는 토큰(acceptInvite)으로만.

const { db } = vi.hoisted(() => ({
  db: {
    members: new Map<string, { id: string; name: string; email: string; role: string }>(),
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    member: {
      findUnique: vi.fn(async ({ where }: { where: { email: string } }) => {
        for (const m of db.members.values()) if (m.email === where.email) return m;
        return null;
      }),
      create: vi.fn(
        async ({ data }: { data: { id: string; name: string; email: string; role: string } }) => {
          db.members.set(data.id, data);
          return data;
        },
      ),
    },
  },
}));

import { findOrCreateMember } from "@/lib/invite-gate";

beforeEach(() => {
  db.members.clear();
});

describe("findOrCreateMember (멀티팀 — 로그인은 누구나, ADR-018)", () => {
  it("이미 있는 멤버는 그대로 반환한다(생성하지 않음)", async () => {
    db.members.set("ha", { id: "ha", name: "하수현", email: "ha@uni.ac.kr", role: "관리자" });
    const member = await findOrCreateMember("ha@uni.ac.kr");
    expect(member.id).toBe("ha");
    expect(db.members.size).toBe(1); // 새로 만들지 않는다
  });

  it("없으면 거부하지 않고 생성한다(이름=local-part, 기본 역할 멤버)", async () => {
    const member = await findOrCreateMember("stranger@evil.com");
    expect(member.email).toBe("stranger@evil.com");
    expect(member.name).toBe("stranger"); // local-part
    expect(member.role).toBe("멤버"); // 기본 역할
    expect(db.members.size).toBe(1);
  });
});
