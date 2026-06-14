import { test } from "@playwright/test";

// 빈 워크스페이스에는 논문이 없어 상세(/papers/:id) 검증 대상이 없다.
// 업로드→분석 후 상세(관점 토글·Figure 공통 노출) 검증은 업로드 플로우와 함께 추후 복구한다.
test.skip("논문 상세 — 빈 워크스페이스라 보류(업로드 후 검증)", () => {});
