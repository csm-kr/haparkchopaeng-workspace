# Step 0: docs-team-hub

진입 흐름을 **"로그인 후 항상 팀 허브(`/teams`)를 거쳐 팀을 선택한다"**로 명문화하고, 팀 생성 상한 정책(전역·admin/env)을 **그대로 유지하되 허브 UI에서 가시화**한다는 결정을 문서에 기록한다. **문서 전용 step — 코드/스키마는 건드리지 않는다.**

## 읽어야 할 파일

먼저 아래를 읽고 설계 의도를 파악하라. **정본은 루트 `README.md` · `CLAUDE.md` · `PRD.md`이며, 충돌 시 이를 따른다.**

항상:
- `docs/dev/ARCHITECTURE.md` — 스택·디렉토리 구조
- `docs/agent/ADR.md` — 결정 근거 (특히 **ADR-018 멀티팀**, **ADR-020 팀 스코핑**, **ADR-015 읽기 RSC/쓰기 라우트·액션**). 의도된 결정이다 — "고치지" 말 것.
- `docs/dev/CODING_CONVENTION.md` — 코드 규칙

화면/플로우 레이어:
- `docs/design/SCREEN_FLOW.md` · `docs/design/SCREENS.md` · `docs/user/USER_FLOW.md` — 현재 진입/온보딩 화면 흐름
- `docs/agent/RULES.md` — R3(신원은 세션에서)·R19(앱레벨 권한)·R30(실패는 인라인)·R37(활성 팀 스코핑)

현재 동작(코드를 읽어 사실 확인):
- `app/auth/callback/route.ts` — 로그인 후 `next ?? "/dashboard"`로 착지
- `app/page.tsx` — 이미 로그인 상태면 `next ?? "/dashboard"`
- `app/(app)/layout.tsx` — 멤버십 없으면 `/teams/new`로 가드
- `app/(app)/teams/new/page.tsx` · `create-team-form.tsx` · `actions.ts` — 현재 팀 만들기 화면
- `lib/teams.ts` — `maxTeams()`(env `MAX_TEAMS`, 기본 2, **전역 상한**), `createTeam`(전역 상한 강제), `listMemberships`
- `lib/active-team.ts` — `getActiveTeam`/`setActiveTeam`(쿠키), `app/api/teams/active/route.ts`

## 작업

### 1. `docs/agent/ADR.md` — ADR-021 추가

ADR-020 뒤에 **ADR-021: 진입 팀 허브**를 추가한다. ADR-018(멀티팀)을 **개정이 아니라 정밀화**하는 결정임을 인용 블록에 명시한다(전역 상한·초대 합류·앱레벨 권한은 그대로 유지). 다음을 담는다:

- **결정**: 로그인 사용자는 진입 시 **항상 팀 허브 `/teams`에 착지**한다(팀이 1개여도 거친다). 허브에서:
  - 속한 팀을 선택 → 활성 팀 쿠키 설정(`POST /api/teams/active`, 기존 재사용) → `/dashboard` 진입.
  - 새 팀 만들기(전역 상한 미달일 때만) · 받은 초대 링크로 합류 안내.
  - 팀이 0개면 만들기/초대만 보인다(기존 `/teams/new` 역할 흡수).
- **`/teams/new` 폐지**: 허브로 흡수. "팀 없음" 가드 목적지도 `/teams/new` → `/teams`로.
- **진입 라우팅**: 로그인 후 기본 착지 `/dashboard` → **`/teams`**. 단 **초대 복귀(`next`)는 그대로 우선**(same-origin 정제는 `sanitizeNext` 유지).
- **활성 팀 쿠키는 유지**되므로 `/dashboard` 등 **직접 방문(북마크)은 그대로 동작** — 허브는 "로그인 직후 착지"에만 강제된다(매 네비게이션 벽이 아님).
- **생성 상한 정책(유지 + 가시화)**: 상한은 기존대로 **전역**(서버 전체 `team.count()` vs `MAX_TEAMS`, **per-user 아님**)이며 **admin이 env로만 설정**(사용자 UI로 변경 불가). 허브는 상한 도달 시 만들기를 **비활성 + 안내**로 가시화한다(R30). per-user 한도·플랜은 **상업화 시점에 도입**하며 현재는 미도입(ADR-018 "per-user·플랜 미도입" 정신 계승).
- **위치 근거**: 허브는 `(app)` 셸 **밖**의 독립 로비다(사이드바·`TeamSwitcher` 없음) — `/invite`처럼 "선택 전 화면"과 "선택 후 앱"을 분리한다.

**이유**·**트레이드오프**(항상 허브 = 단일 팀 사용자도 로그인마다 1클릭 추가; `/team`(관리)과 `/teams`(허브) 이름 유사)도 ADR 형식에 맞춰 적는다.

### 2. `docs/design/SCREEN_FLOW.md` · `docs/user/USER_FLOW.md` — 진입 흐름 갱신

로그인 → (초대 `next` 있으면 그쪽) → **팀 허브 `/teams`** → 팀 선택 → `/dashboard` 흐름으로 갱신한다. 기존 "로그인 → 팀 없으면 `/teams/new`" 서술을 "로그인 → 팀 허브 `/teams`(0팀이면 만들기/초대)"로 정정한다.

### 3. `docs/design/SCREENS.md` — 팀 허브 화면 명세 추가

`/teams` 허브 화면 명세를 추가한다: 내 팀 목록(이름·역할, 선택 시 진입) · 새 팀 만들기(상한 도달 시 비활성+안내) · 초대 안내. 기존 "팀 만들기(`/teams/new`)" 항목은 허브로 흡수됨을 명시(삭제 또는 허브로 통합 서술).

## Acceptance Criteria

```bash
npm run build      # 문서 변경이라도 타입/컴파일 깨지지 않음 확인
```

추가 확인:
- `docs/agent/ADR.md`에 `ADR-021` 표제가 존재한다.
- `grep -r "/teams/new" docs/` 결과가 "폐지/흡수" 맥락 외에 진입 목적지로 남아 있지 않다.

## 검증 절차

1. AC 실행.
2. 체크리스트:
   - `docs/dev/ARCHITECTURE.md` 구조·`docs/agent/ADR.md` 결정과 모순되지 않는가?
   - ADR-021이 ADR-018을 **개정**한다고 쓰지 않고 **정밀화**한다고 했는가?(전역 상한·초대 합류·앱레벨 권한 유지)
   - 생성 상한이 **전역·admin/env·per-user 아님**으로 정확히 기술됐는가?
3. `phases/9-team-hub/index.json`의 step 0 업데이트(`completed`+`summary` / `error`).

## 금지사항

- **코드·스키마·테스트를 수정하지 마라.** 이유: 이 step은 문서 전용이다 — 구현은 step 1~3 소관.
- **생성 상한을 per-user로 바꾸는 결정을 쓰지 마라.** 이유: 사용자가 "전역 상한·admin이 설정·상업화 시 추가"로 확정했다 — per-user는 미도입 유지.
- **`maxTeams()`/`MAX_TEAMS` 기본값(2)을 바꾸는 서술을 넣지 마라.** 이유: 값 조정은 admin의 env 소관이다.
- 기존 ADR(018·020 등) 본문을 재작성하지 마라 — ADR-021을 **추가**만 한다.
