# Step 0: docs-bootstrap-spec

## 읽어야 할 파일

먼저 아래를 읽고 아키텍처·설계 의도를 파악하라. **정본은 루트 `README.md` · `CLAUDE.md` · `PRD.md`이며, 충돌 시 이를 따른다.**

항상:
- `docs/dev/ARCHITECTURE.md` — 스택·디렉토리 구조
- `docs/agent/ADR.md` — 특히 **ADR-007**(단일 테넌트·초대 전용), **ADR-017**(Google OAuth + 초대 게이트). 의도된 결정이다. 코드를 보고 "고치지" 말 것.
- `docs/dev/CODING_CONVENTION.md`

이 step(문서)의 대상:
- `docs/user/USER_JOURNEY.md` · `docs/user/USER_FLOW.md`
- `docs/dev/DB.md` · `docs/dev/API.md`
- `docs/security/SECURITY.md` · `docs/dev/ENV.md`
- `docs/design/SCREEN_FLOW.md`

현 동작 파악용(읽기만, **수정 금지**):
- `app/auth/callback/route.ts` — Google OAuth 콜백 + 초대 게이트
- `lib/invite-gate.ts` — `gateInvitedEmail`(멤버/초대 해소)
- `app/api/auth/logout/route.ts` — 기존 로그아웃 API(이미 존재)
- `prisma/seed.ts` — 현재 워크스페이스/멤버 시드 생성

## 작업

"**워크스페이스 부트스트랩**" 기능의 설계 의도를 문서에 먼저 박는다(후속 step 1~3의 가드레일이 된다). **코드는 일절 건드리지 않는다.**

모든 문서가 아래 한 가지 결정을 **일관되게** 반영해야 한다:

- 단일 테넌트(ADR-007)는 **불변**. `Workspace` row는 여전히 **최대 1개**.
- 시드(`prisma/seed.ts`)는 **로컬 개발 편의로 유지**한다. **프로덕션 첫 실행**은 부트스트랩 UI로 워크스페이스 + 첫 관리자를 만든다.
- 부트스트랩은 **`Workspace`가 아직 없을 때만** 가능(사실상 1회). 첫 Google 인증 사용자가 팀을 만들고 **관리자(👑)**가 된다. 그 뒤로는 기존 초대 전용 게이트(ADR-007/017)가 모든 합류를 통제한다.
- 로그아웃 버튼을 **설정 화면(자신/프로필)** 에 노출한다 — 기존 `POST /api/auth/logout`을 호출한다(새 엔드포인트 없음).

문서별 변경:

1. `docs/agent/ADR.md` — ADR-017 다음에 **ADR-018: 워크스페이스 부트스트랩**을 결정/이유/트레이드오프 형식으로 추가. 핵심: "ADR-007 단일 테넌트 불변 · 시드는 dev 편의 · 프로덕션 첫 실행은 부트스트랩 UI · `Workspace` 부재 시에만 1회 · 첫 인증자=관리자".
2. `docs/dev/DB.md` — `Workspace` 모델 주석에 "시드 또는 **부트스트랩**으로 생성; 여전히 row 1개만(ADR-007/018)" 보강. '시드 데이터' 절에 "프로덕션은 부트스트랩으로 생성" 한 줄.
3. `docs/dev/API.md` — `### 인증 · 멤버` 표에 `POST /api/workspace`(부트스트랩: 팀 생성 + 첫 관리자) 행 추가. 표 아래에 규칙 명시: "**CRITICAL: `Workspace` 존재 시 `409`.** 이메일은 클라가 아니라 **Supabase 검증 신원**에서 취한다." 로그아웃 행 설명에 "설정 화면에서 호출" 보강. `409` 상태코드 매핑 표에 "이미 팀이 만들어졌어요" 카피 한 줄.
4. `docs/security/SECURITY.md` — 인증 절에 "**부트스트랩**: `Workspace` 부재 시에만 1회, Supabase 검증 이메일로 관리자 생성, 존재 시 `409`(공개 가입이 아니라 첫 실행 창)" 추가. 위협모델 ①에 부트스트랩 창 한 줄. 체크리스트에 "부트스트랩이 `Workspace` 부재로 가드되는가" 추가.
5. `docs/user/USER_JOURNEY.md` — '보조 저니'에 **D. 워크스페이스 부트스트랩(첫 팀 만들기)** 추가: 첫 사용자가 Google 로그인 → 팀 이름 입력 → 워크스페이스 생성·관리자 → 환영(첫인상 톤과 일관). 그리고 **로그아웃**(설정에서 나가기, 재로그인 가능) 한 항목.
6. `docs/user/USER_FLOW.md` — `## F7. 팀 만들기(부트스트랩) · 로그아웃` 절 추가. 기존 표기 규칙(`[버튼]`·`→`·`◇`·`※`) 그대로. 부트스트랩 분기(Workspace 없음 → `/setup`, 있음 → 차단)와 로그아웃 플로우(설정 → 로그아웃 → 로그인 화면)를 담는다.
7. `docs/design/SCREEN_FLOW.md` — `setup`(팀 만들기) 화면을 흐름에 가볍게 추가(로그인 후 `Workspace` 없으면 setup으로 진입).

## Acceptance Criteria

```bash
npm run build   # 코드 무변경 — 타입/빌드가 그대로 통과해야 한다
```

## 검증 절차

1. 위 AC를 실행한다(코드 변경이 없으므로 통과해야 한다).
2. 아키텍처 체크리스트:
   - ADR-007(단일 테넌트·초대 전용)을 뒤집지 않았는가? (부트스트랩은 "Workspace 부재 시 1회"로만 기술)
   - 각 문서 상단 인용 블록의 상호 링크가 깨지지 않았는가?
3. `phases/3-team-bootstrap/index.json`의 step 0을 업데이트한다(성공 → `completed` + `summary`).

## 금지사항

- 코드 파일(`app/**`, `lib/**`, `components/**`, `prisma/**`)을 수정하지 마라. 이유: 이 step은 문서만 — 구현은 step 1~3에서 한다.
- ADR-007을 폐기/완화하지 마라. 이유: 단일 테넌트·초대 전용은 불변(사용자 결정). 부트스트랩은 그 예외가 아니라 "최초 1회 생성" 절차다.
- 시드 삭제를 문서화하지 마라. 이유: 시드는 dev 편의로 유지한다.
