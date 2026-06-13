import { describe, expectTypeOf, it } from "vitest";
import type {
  Analysis,
  ApiResponse,
  Lens,
  MemberFineSummary,
  NoteLens,
  Paper,
  ReproPayload,
  ResearchPayload,
  Role,
  ScheduleMonth,
  WeekStatus,
} from "@/types";

describe("domain types", () => {
  it("유니온 리터럴이 허용값만 받는다", () => {
    expectTypeOf<Lens>().toEqualTypeOf<"research" | "repro">();
    expectTypeOf<NoteLens>().toEqualTypeOf<"research" | "repro" | "any">();
    expectTypeOf<Role>().toEqualTypeOf<"관리자" | "멤버" | "게스트">();
    // current는 파생이라 WeekStatus에 없다
    expectTypeOf<WeekStatus>().toEqualTypeOf<"done" | "upcoming">();
  });

  it("Analysis payload는 lens에 따라 좁혀진다", () => {
    expectTypeOf<Analysis<"research">["payload"]>().toEqualTypeOf<ResearchPayload>();
    expectTypeOf<Analysis<"repro">["payload"]>().toEqualTypeOf<ReproPayload>();
  });

  it("Paper에 analysisStatus가 있고 타입/형식 필드는 없다", () => {
    expectTypeOf<Paper>().toHaveProperty("analysisStatus");
    expectTypeOf<Paper>().not.toHaveProperty("kind");
    expectTypeOf<Paper>().not.toHaveProperty("format");
  });

  it("ScheduleMonth에 낙관적 락 version이 있다", () => {
    expectTypeOf<ScheduleMonth["version"]>().toEqualTypeOf<number>();
  });

  it("파생값은 엔티티가 아니라 별도 계산 결과 타입이다", () => {
    expectTypeOf<MemberFineSummary>().toHaveProperty("accruedFine");
    expectTypeOf<MemberFineSummary>().toHaveProperty("outstanding");
  });

  it("ApiResponse는 data 또는 error 봉투다", () => {
    const ok: ApiResponse<Paper[]> = { data: [] };
    const err: ApiResponse<Paper[]> = { error: { code: "404", message: "없음" } };
    expectTypeOf(ok).toMatchTypeOf<ApiResponse<Paper[]>>();
    expectTypeOf(err).toMatchTypeOf<ApiResponse<Paper[]>>();
  });
});
