// API 응답 봉투 + 파생 계산 결과 타입. 파생값은 엔티티 저장 필드가 아님(DB.md).

/** 성공 응답: { data } (API.md 응답 포맷) */
export interface ApiOk<T> {
  data: T;
}

/** 실패 응답: { error: { code, message } } */
export interface ApiErr {
  error: { code: string; message: string };
}

export type ApiResponse<T> = ApiOk<T> | ApiErr;

/**
 * 멤버 벌금 파생값 — 저장하지 않고 서버에서 계산(DB.md 파생값).
 * accruedFine = missedPresenter*finePresenter + missedAbsent*fineAbsent
 * outstanding = accruedFine - paid (≤0이면 완납)
 */
export interface MemberFineSummary {
  memberId: string;
  accruedFine: number;
  outstanding: number;
}
