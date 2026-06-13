import { PrismaClient } from "@prisma/client";

// 개발 중 핫리로드로 PrismaClient가 재생성되는 것을 막는 전역 싱글톤 (ADR-010).
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma: PrismaClient = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
