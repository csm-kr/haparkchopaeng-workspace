# QA 리포트 — phase 5 (full-qa)

매주 토요일 세미나 워크스페이스(하박조팽)의 핵심 User Flow(F1~F6) + 전역 인터랙션을
헤드리스 e2e(Playwright)로 **비파괴** QA한 결과를 집계한다. 이 phase의 마무리 산출물이다.

## 실행 환경

- **커맨드:** `npx playwright test`
- **앱 서버:** `npm run dev -- --port 3100` (Next dev, `NODE_ENV=development`). dev 이메일 로그인
  (`POST /api/auth/login`)이 동작하는 환경 — 프로덕션 빌드는 이 라우트를 404로 막는다(ADR-017).
  `playwright.config.ts` webServer에 `PAPER_WEEKLY_LIMIT=20` 주입(업로드 한도 표시 검증용).
- **DB:** **공유 운영 Supabase Postgres**(로컬 `dev.db` 없음). 데이터가 가변이므로 모든 spec은
  **데이터-무관/조건부**로 작성됐다.
- **로그인 계정:** 단일 관리자 `de8167@gmail.com`(조성민).
- **병렬:** 6 workers, `fullyParallel: true`, `retries: 2`(아래 §결함/개선점 참고).

## 최종 결과

```
16 passed · 1 skipped · 0 failed   (총 17 tests, 종료 코드 0)
```

AC(`npx playwright test` 실패 0건, 종료 코드 0) 충족.

## spec별 결과

| spec 파일 | 대상 Flow | passed / skipped | 비고 |
|---|---|---:|---|
| `dashboard.spec.ts` | 전역 셸 / 홈 | 1 / 0 | 로그인→셸 내비·퀵카드 렌더, live=false라 LIVE 배너 부재 |
| `library.spec.ts` | F3(논문 목록 진입) | 1 / 0 | 목록 행 **또는** 빈 상태 + 에러 카드 부재(데이터 무관) |
| `meeting.spec.ts` | F1(라이브) | 2 / 0 | 빈 상태+[라이브 시작] 노출·활성(클릭 금지), 사이드바→/schedule 비파괴 내비 |
| `upload.spec.ts` | F2(업로드) | 2 / 0 | 모달 PDF 전용+arXiv 입력+한도 표시, 비-PDF·잘못된 arXiv 인라인 거부(검증선까지) |
| `paper.spec.ts` | F3(논문 상세) | 1 / 0 | **조건부**: 논문 있으면 관점 토글·Figure 공통·노트 폼 열고 [취소]까지 |
| `presentation.spec.ts` | F5(발표 자료/회고) | 2 / 0 | 목록 스모크 + **조건부** 상세(뷰어·회고 댓글 입력값 반영까지, 전송 금지) |
| `schedule.spec.ts` | F4(스케줄) | 3 / 0 | 빈 달→[일정 짜기] 편집, [취소] 초안 폐기, 편집 중 월 이동 잠금([저장] 금지) |
| `team.spec.ts` | F6(팀 관리) | 1 / 1 | 본인+초대 블록(역할 3종), ⋯ 메뉴/내보내기 확인 다이얼로그는 **조건부**(아래) |
| `profile.spec.ts` | 설정 | 1 / 0 | 프로필 필드·테마 선택, 테마 전환이 `<html data-theme>`를 바꿈(R20) |
| `global.spec.ts` | 전역(내비·로그아웃) | 2 / 0 | **이번 step 신규** — 사이드바 내비 3경로(aria-current), 로그아웃→보호 라우트 리다이렉트 |

### 이번 step 신규: `global.spec.ts`

1. **사이드바 내비게이션** — `role="navigation"`("주요 메뉴")의 링크로 `논문`→/library,
   `발표 자료`→/presentations, `스케쥴`→/schedule 이동. 각 이동 후 URL + 활성 링크의
   `aria-current="page"`(셸 재렌더 증거)로 단언. 스케줄은 고정 마커 h1 "세미나 스케줄"도 확인.
   (데이터 무관.)
2. **로그아웃** — 셸 UI에 로그아웃 버튼이 없어(코드 확인) `POST /api/auth/logout`으로
   **세션 쿠키만** 파기 → `/dashboard` 재접근 시 홈(로그인 화면 "다시 오셨네요")으로
   리다이렉트되는지 단언(`app/(app)/layout.tsx`의 `redirect("/")`). dev 세션은 Supabase IdP
   세션이 없어 signOut은 무영향 — **공유 운영 DB 불변**(비파괴 허용 범위).

## 의도적 미검증 (범위 밖 — 공유 운영 DB 비파괴 원칙)

다음 파괴적/영속 변경 경로는 공유 운영 DB를 오염시키므로 **실행하지 않았다**. 노출·활성·검증선까지만 단언:

- **라이브 시작/종료**(F1) — 전역 `live` 토글이 모든 사용자에게 배너·배지를 띄움(ADR-001/R6).
- **스케줄 저장**(F4) — `PUT`가 월 영속화 + 순번 포인터 전진. [일정 짜기]=순수 계산까지만.
- **업로드 완료/arXiv 가져오기**(F2) — Paper 생성·Gemini 분석 잡. 415/400 인라인 거부 검증선까지만.
- **노트/댓글/초대/역할 변경/내보내기 생성**(F3/F5/F6) — 폼·메뉴·확인 다이얼로그 노출까지만,
  [추가]/[보내기]/위험 버튼 미클릭.
- **실제 송출/재생**(Cloudflare), **Google OAuth 왕복**, **Supabase Realtime 전이** — 운영 키
  런타임 전용이라 헤드리스 e2e 대상이 아니다(단위/RTL이 별도 커버).

## 데이터 의존 조건부 (있을 때만 검증, 없으면 런타임 skip)

- **paper 상세**(`paper.spec`) — `/library` 행 0이면 skip. `analysisStatus`가 ready면 관점 토글·
  Figure 공통·노트 폼, 미-ready면 상태 블록만. (이번 패스: 논문 존재 → ready 경로 통과.)
- **presentation 상세**(`presentation.spec`) — 발표 자료 0이면 skip. (이번 패스: 존재 → 상세 통과.)
- **team ⋯ 메뉴**(`team.spec`, **1 skipped**) — ⋯ 관리 메뉴는 본인 행에 없다(`isAdmin && !isSelf`).
  현재 워크스페이스가 **단일 관리자**(본인 외 멤버 0)라 관리 대상이 없어 런타임 skip.
  → 결함 아님(데이터 상태에 따른 정상 분기).

## 미포팅 UI (코드로 확인 후 생략 — 가정 단언 금지)

USER_FLOW "전역 인터랙션"이 언급하는 아래 UI는 **프로덕션 셸에 아직 포팅되지 않았다**.
`components/shell/*` · `app/(app)/*`에 해당 핸들러/컴포넌트가 없음을 코드로 확인하고,
없는 UI를 가정해 단언하지 않았다(step 금지사항):

- **명령 팔레트(Cmd/Ctrl+K)** — `cmdk`/keydown 핸들러·`role=dialog` 팔레트 부재. 프로토타입의
  `CommandPalette`는 미포팅 → 해당 케이스 생략(`global.spec.ts` 상단 주석에 사유 기록).
- **통합 검색** — 검색 입력/결과 UI 부재 → 생략.

> 후속 작업(범위 밖): 명령 팔레트·통합 검색을 프로덕션 셸에 포팅하면 `global.spec.ts`에
> 열기/닫기(Esc)·질의→결과/"결과 없음" 빈 상태 케이스를 추가한다.

## 발견된 결함 / 개선점

- **결함:** 이번 패스에서 **회귀·기능 결함 없음.** 모든 단언은 실제 카피/role/단축키와 일치.
- **개선점(테스트 인프라):** 6 워커 병렬 × 원격 공유 Supabase(네트워크 지연) × Next dev
  온디맨드 컴파일/하이드레이션이 겹치면, 행 클릭→RSC 내비게이션이 `toHaveURL` 기본 5초를
  **간헐적으로** 초과하는 타이밍 플레이크가 관측됐다(매 실행 다른 spec이 깜빡임 — paper·
  presentation 상세, upload 로그인의 `ECONNRESET` 등). 단언 자체는 정확하다. 원격 인프라 대상
  E2E의 표준 해법대로 `playwright.config.ts`에 `retries: 2`를 추가해 일시적 타이밍 플레이크만
  흡수한다(결정적 실패는 3회 시도 모두 실패 → 회귀를 가리지 않음). 재실행 시 첫 시도에 전부
  통과(retries 미발동) 확인.
- **개선점(후속):** paper/presentation/team 상세 검증은 고정 시드가 없어 조건부 skip이다.
  결정적 검증이 필요하면 e2e 전용 격리 시드(별도 워크스페이스/DB)를 도입해 상세·파괴 경로까지
  확정 검증하는 것이 바람직하다(현재는 공유 운영 DB 비파괴 원칙상 보류).
