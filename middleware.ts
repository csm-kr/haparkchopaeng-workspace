import { NextResponse, type NextRequest } from "next/server";

// 현재 경로를 x-pathname 요청 헤더로 노출한다 — RSC 레이아웃(app/(app)/layout.tsx)이
// 경로 기반 진입 가드(팀 없음 → /teams/new, /teams/new 자신은 예외)를 하기 위함이다.
// 세션/DB 검증은 하지 않는다(자체 서명 쿠키는 서버 컴포넌트에서, ADR-016/018). 헤더만 덧붙인다.
export function middleware(req: NextRequest): NextResponse {
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-pathname", req.nextUrl.pathname);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  // 정적 자산·이미지·favicon 제외. 페이지/route handler에만 적용.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
