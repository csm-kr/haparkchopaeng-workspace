"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuth, requireRole } from "@/lib/auth";
import { HttpError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { getFines, getScheduleMembers, resolveStartIdx } from "@/lib/schedule";
import {
  draftMonth as draftWeeks,
  ensureVersion,
  nextPointer,
} from "@/lib/schedule-logic";
import type {
  FinesView,
  MemberOption,
  SaveMonthResult,
  ScheduleMonthView,
  ScheduleWeekView,
  WeekInput,
} from "@/components/schedule/types";

// 스케줄 쓰기 — Server Action(쓰기는 Server Action/route handler, ADR-015/R32).
// CRITICAL: 순번 포인터는 클라가 보내지 않는다 — 서버가 직전 저장월 기준으로 계산·전진한다(R16).
// CRITICAL: 저장은 낙관적 락(version) — 불일치면 409(R35). 초안(draft)은 DB에 저장하지 않는다(R16).

const YearMonth = z.object({
  year: z.number().int(),
  month: z.number().int().min(1).max(12),
});

/**
 * 빈 달 초안 — 토요일 계산 + 직전 저장월의 순번부터 발표자 배정.
 * CRITICAL: DB에 저장하지 않는다(초안). 저장은 saveMonth(PUT)만.
 */
export async function draftMonthAction(
  year: number,
  month: number,
): Promise<ScheduleWeekView[]> {
  await requireAuth();
  const parsed = YearMonth.safeParse({ year, month });
  if (!parsed.success) {
    throw new HttpError(400, "BAD_REQUEST", "잘못된 달이에요.");
  }
  // 로테이션 = 실제 멤버(가입순). 시작 순번은 직전 저장월에서 이어받는다(연속 전진).
  // 멤버 수를 넘는 자투리 주는 draftWeeks가 방학으로 둔다.
  const rotation = (await getScheduleMembers()).map((m) => m.id);
  const startIdx = await resolveStartIdx(parsed.data.year, parsed.data.month);
  return draftWeeks(parsed.data.year, parsed.data.month, startIdx, rotation);
}

const WeekInputSchema = z.object({
  week: z.number().int().positive(),
  date: z.string().min(1),
  time: z.string().min(1),
  presenterId: z.string().nullable(),
  topic: z.string(),
  confirmed: z.boolean(),
  status: z.enum(["done", "upcoming"]),
  presentationId: z.string().nullable(),
});

const SaveMonthSchema = YearMonth.extend({
  version: z.number().int().min(0),
  weeks: z.array(WeekInputSchema),
});

function weekCreate(w: WeekInput) {
  return {
    week: w.week,
    date: w.date,
    time: w.time,
    presenterId: w.presenterId,
    topic: w.topic,
    confirmed: w.confirmed,
    status: w.status,
    presentationId: w.presentationId,
  };
}

type SavedMonth = {
  year: number;
  month: number;
  day: string;
  rotationPointerAfter: number;
  version: number;
  weeks: Array<{
    week: number;
    date: string;
    time: string;
    presenterId: string | null;
    topic: string | null;
    confirmed: boolean;
    status: string;
    presentationId: string | null;
  }>;
};

function toMonthView(m: SavedMonth): ScheduleMonthView {
  return {
    year: m.year,
    month: m.month,
    day: m.day,
    rotationPointerAfter: m.rotationPointerAfter,
    version: m.version,
    weeks: m.weeks
      .slice()
      .sort((a, b) => a.week - b.week)
      .map((w) => ({
        week: w.week,
        date: w.date,
        time: w.time,
        presenterId: w.presenterId,
        topic: w.topic,
        confirmed: w.confirmed,
        status: w.status === "done" ? "done" : "upcoming",
        presentationId: w.presentationId,
      })),
  };
}

/**
 * 저장 — 영속화 + 순번 포인터 전진(서버 원자적) + 낙관적 락.
 * 저장 권한: 관리자·멤버(게스트 ❌, SECURITY). 충돌(409)·권한(403)은 판별 유니온으로 돌려준다.
 */
export async function saveMonth(input: {
  year: number;
  month: number;
  version: number;
  weeks: WeekInput[];
}): Promise<SaveMonthResult> {
  try {
    await requireRole("관리자", "멤버");
  } catch {
    return { ok: false, code: "FORBIDDEN", message: "스케줄을 저장할 권한이 없어요." };
  }

  const parsed = SaveMonthSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "ERROR", message: "일정을 확인해주세요." };
  }
  const { year, month, version, weeks } = parsed.data;

  // 순번 연속 전진: 이 달 시작 인덱스 = 직전 저장월의 rotationPointerAfter,
  // 이 달 발표 배정 수(방학 제외)만큼 전진. 멤버 수는 가변이라 실제 멤버 수로 나눈다(R16).
  const startIdx = await resolveStartIdx(year, month);
  const len = (await getScheduleMembers()).length;
  const presented = weeks.filter((w) => w.presenterId !== null).length;
  const pointer = nextPointer(startIdx, presented, len);

  try {
    const saved = await prisma.$transaction(async (tx) => {
      // 복합 unique가 [teamId, year, month]로 바뀜(ADR-020) — 팀 스코핑은 step 3/4.
      // 단일 워크스페이스라 (year, month) findFirst로 동일하게 ≤1건.
      const existing = await tx.scheduleMonth.findFirst({
        where: { year, month },
      });

      if (existing) {
        ensureVersion(existing.version, version); // 불일치면 409(R35)
        return tx.scheduleMonth.update({
          where: { id: existing.id },
          data: {
            saved: true,
            rotationPointerAfter: pointer,
            version: existing.version + 1,
            weeks: { deleteMany: {}, create: weeks.map(weekCreate) },
          },
          include: { weeks: true },
        });
      }

      // row가 없던 빈 달 — 사용자가 저장을 눌렀을 때만 생성한다(자동 생성 아님, R15).
      return tx.scheduleMonth.create({
        data: {
          year,
          month,
          day: "토요일",
          saved: true,
          rotationPointerAfter: pointer,
          version: 1,
          weeks: { create: weeks.map(weekCreate) },
        },
        include: { weeks: true },
      });
    });

    revalidatePath("/schedule");
    return { ok: true, month: toMonthView(saved) };
  } catch (e) {
    if (e instanceof HttpError && e.status === 409) {
      return { ok: false, code: "CONFLICT", message: e.message };
    }
    return {
      ok: false,
      code: "ERROR",
      message: "저장하지 못했어요. 잠깐 후 다시 시도해주세요.",
    };
  }
}

const UpdateFinesSchema = z.object({
  year: z.number().int(),
  finePresenter: z.number().int().min(0),
  fineAbsent: z.number().int().min(0),
});

/** 벌금 금액 수정 — 관리자만(👑, SECURITY). 장부 표가 즉시 재계산되도록 최신 FinesView 반환. */
export async function updateFines(input: {
  year: number;
  finePresenter: number;
  fineAbsent: number;
}): Promise<FinesView> {
  await requireRole("관리자");
  const parsed = UpdateFinesSchema.safeParse(input);
  if (!parsed.success) {
    throw new HttpError(400, "BAD_REQUEST", "금액을 확인해주세요.");
  }
  const { year, finePresenter, fineAbsent } = parsed.data;

  // FineConfig PK가 [teamId, year]로 바뀜(ADR-020) — update는 unique를 요구하므로 updateMany로.
  // 단일 워크스페이스라 (year) 한 건만 갱신된다. 팀 스코핑은 step 3/4.
  await prisma.fineConfig.updateMany({
    where: { year },
    data: { finePresenter, fineAbsent },
  });
  revalidatePath("/schedule");

  const fines = await getFines(year);
  if (!fines) throw new HttpError(404, "NOT_FOUND", "벌금 설정이 없어요.");
  return fines;
}

const ReorderInput = z.array(z.string().min(1)).min(1);

/** 로테이션 순서(iteration) 편성 — 관리자만(👑). 보낸 순서대로 rotationOrder를 1..N으로 굳힌다. */
export async function reorderRotation(orderedIds: string[]): Promise<MemberOption[]> {
  await requireRole("관리자");
  const parsed = ReorderInput.safeParse(orderedIds);
  if (!parsed.success) {
    throw new HttpError(400, "BAD_REQUEST", "순서를 확인해주세요.");
  }

  // 실제 멤버 id만 신뢰(R3) — 보낸 목록에서 존재하는 것만, 보낸 순서대로.
  const existing = await prisma.member.findMany({ select: { id: true } });
  const valid = new Set(existing.map((m) => m.id));
  const ids = parsed.data.filter((id) => valid.has(id));

  await prisma.$transaction(
    ids.map((id, i) =>
      prisma.member.update({ where: { id }, data: { rotationOrder: i + 1 } }),
    ),
  );
  revalidatePath("/schedule");
  return getScheduleMembers();
}
