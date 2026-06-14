# Step 4: team-ui (팀 없음 · 생성 · 초대 수락 · 멤버 관리)

## 읽어야 할 파일
정본은 루트 `README.md`·`CLAUDE.md`·`PRD.md`. 충돌 시 이를 따른다.
- `docs/agent/ADR.md`(**ADR-018**) · `docs/agent/RULES.md`(R18·R19·R26·R27·R29·R30) · `docs/design/DESIGN_GUIDE.md`·`docs/design/SCREENS.md`(토큰만, R20)
- `lib/teams.ts`(step 1: `createTeamAction` 흐름·역할 헬퍼) · `lib/invite.ts`(step 2: `getInviteForAcceptance`/`acceptInvite`/`inviteLink`)
- `app/(app)/teams/new/actions.ts`(step 1) · `app/api/invites/*`(step 2)
- `components/team/team-manager.tsx`·`components/team/types.ts`·`app/(app)/team/page.tsx`·`lib/team.ts`(step 2에서 최소 수정된 상태)
- `components/ui/*`(Button/Card/Input/Badge/Avatar) — 기존 컴포넌트 재사용 · `components/team/__tests__/team.test.tsx`

## 작업
멀티팀 UI를 완성한다. 모든 색·간격은 **토큰만**(R20), 상태 3종(로딩·빈·에러, R26), 파괴적 액션은 확인/되돌리기(R27).

1. **팀 없음 + 생성** — `app/(app)/teams/new/page.tsx`:
   - 멤버십 없는 사용자의 착지 화면. "팀 만들기"(이름·선택 slug 입력 → `createTeamAction`) + "초대 링크로 합류" 안내(링크를 받았다면 그 URL로).
   - `createTeamAction`이 `TEAM_LIMIT`(최대 팀 수 초과)를 주면 **인라인 메시지**로 "최대 팀 수를 초과했어요."(R30) — 토스트 아님. `SLUG_TAKEN`도 인라인.
   - 성공 시 `/app`(또는 대시보드)로 이동.
2. **초대 수락** — `app/invite/[token]/page.tsx`(신규):
   - RSC에서 `getInviteForAcceptance(token)` 호출 → `status`별 카드: `not_found`/`revoked`/`expired`/`used_up`는 사유 안내 카드(가입 불가). `ready`면 팀명·역할 보여주고:
     - 미로그인: "로그인하고 합류" → `/api/auth/google?next=/invite/{token}`(step 3의 복귀).
     - 로그인: "합류" 버튼 → Server Action `acceptInviteAction(token)`(내부 `acceptInvite`, `requireAuth`로 memberId 주입, R3). 성공 시 `/app/{teamSlug}`(또는 대시보드), 실패 코드면 같은 페이지에 사유.
   - 검증 순서 노출: `not_found → revoked → expired → used_up → ready`.
3. **초대 발급 + 멤버 관리** — `components/team/team-manager.tsx` 재작성:
   - 이메일 입력 **제거**. 대신 **초대 링크 생성**: 역할 선택(`admin`/`member` — **owner 없음**) + 사용 횟수(`maxUses`, 기본 1) → `POST /api/invites` → 생성된 `link` 복사 UI(기존 복사 UX 재사용).
   - 활성 초대 목록(역할·남은 횟수 `usedCount/maxUses`·만료) + 회수(`DELETE /api/invites/[id]`, 되돌리기/확인은 기존 패턴).
   - 멤버 목록 + 역할 배지. 역할 변경/추방은 **멤버십 역할**(`owner`/`admin`/`member`) 기준, owner·admin만(R19, 서버가 최종 강제). owner는 추방·강등 불가, 팀당 owner ≥ 1.
   - **역할 표기는 영어 그대로**: `owner` / `admin` / `member`. 한국어(팀장/관리자/팀원)로 번역하지 마라.
   - 권한 배지는 색+텍스트 병행(R29).
4. 멤버 관리 API가 step 2에 없으면 추가: `app/api/teams/[slug]/members/[memberId]/route.ts` — `PATCH {role}`(owner만, 대상 owner 불가, `admin`|`member`만), `DELETE`(본인 탈퇴(비-owner) / owner가 비-owner 제거 / admin이 member 제거; 마지막 owner 제거 차단). 권한은 앱레벨(R19).

CRITICAL:
- 역할 UI 라벨은 **영어**(owner/admin/member). 한국어 번역 금지(사용자 지시).
- owner는 초대 역할로 줄 수 없고, 추방/강등으로 0명이 되게 하지 마라(팀당 owner ≥ 1).
- 합류는 `acceptInvite` 경유만(클라가 멤버십 직접 쓰지 않음).
- 검증은 인라인 메시지, 시스템 에러는 사람말 한국어(R30). hex 하드코딩 금지(R20).
- 권한 UI 게이팅은 보조 — 서버가 최종 강제(R19).

## Acceptance Criteria
```bash
npm run build   # 타입/컴파일 에러 없음
npm test        # team 컴포넌트 테스트 갱신·통과(역할 영어 표기, 이메일 입력 제거, 초대 링크 생성 흐름)
npx playwright test   # 핵심 경로: 팀 생성 → 초대 링크 생성 → (다른 로그인) 초대 수락 → 멤버로 합류. dev 서버 reuse 전제.
```

## 금지사항
- 역할을 한국어로 표기하지 마라. 이유: 사용자가 영어 지시.
- 논문 목록에 팀/카테고리 필터를 추가하지 마라. 이유: R17(필터 "전체" 하나만).
- 기존 기능을 팀별로 쪼개지 마라(이번 phase 범위 밖, ADR-018).
- 기존 테스트를 깨뜨리지 마라.
