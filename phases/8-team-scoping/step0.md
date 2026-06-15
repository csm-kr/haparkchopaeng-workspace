# Step 0: docs-adr-020

엔티티를 팀별로 스코핑하는 결정(ADR-018이 미뤄둔 것)을 문서에 먼저 박는다. **문서만 수정**한다(코드 변경 없음).

## 읽어야 할 파일

먼저 아래를 읽고 설계 의도를 파악하라. **정본은 루트 `README.md` · `CLAUDE.md` · `PRD.md`이며, 충돌 시 이를 따른다.**

항상:
- `docs/dev/ARCHITECTURE.md` · `docs/agent/ADR.md`(**특히 ADR-018 멀티팀·ADR-019 라이브·ADR-016**) · `docs/dev/CODING_CONVENTION.md`

이 step에서 수정할 문서:
- `docs/agent/ADR.md`(ADR-020 추가) · `docs/agent/RULES.md`(R37 추가) · `docs/dev/DB.md` · `docs/dev/API.md` · `docs/agent/STATE.md`

## 작업

### 1. `docs/agent/ADR.md` — 맨 끝에 ADR-020 추가

```markdown

### ADR-020: 엔티티 팀 스코핑 (ADR-018 보류분 실행 · ADR-019 개정)

> **이 ADR은 ADR-018이 "별도 단계로 미룬다"고 명시한 엔티티 팀 스코핑을 실행하고, ADR-019의 "전역 동시 1개 라이브 세션"을 "팀당 동시 1개"로 개정한다.** RLS 미사용·앱레벨 권한(ADR-016)·초대 토큰 합류(ADR-018)는 그대로 유지한다.

**결정**: 도메인 엔티티를 팀별로 스코핑한다. 각 팀은 자기 데이터(홈·논문·발표자료·스케줄·벌금·라이브)만 본다.
- `Paper`·`Presentation`·`ScheduleMonth`·`FineConfig`·`MemberLedger`·`LiveSession`에 `teamId`. 하위 엔티티(`Analysis`·`Figure`·`SectionNote`·`Comment`·`ScheduleWeek`)는 부모를 통해 스코핑한다(자체 teamId 불필요).
- **활성 팀(active team)**: 사용자는 여러 팀에 속할 수 있고, "활성 팀"을 **쿠키**로 보관한다(검증: 반드시 내 멤버십이어야). 기본값은 가장 최근 합류 팀(`resolveEntryTeam`). `TeamSwitcher`가 활성 팀을 실제로 전환하고 화면을 revalidate한다.
- **쓰기**: `teamId`는 **활성 팀에서 서버가 주입**한다(클라가 보낸 teamId 미신뢰, R3). 다른 팀 엔티티 접근은 `403`(R19).
- **라이브**: 팀당 동시 active 1개(ADR-019 "전역 1개" 개정). `getActiveSession(teamId)`, `LiveSession.teamId`, LiveKit 룸 이름에 팀 포함.
- **고유 제약 변경**: `ScheduleMonth` `@@unique([teamId, year, month])`, `FineConfig` `@@id([teamId, year])`, `MemberLedger` `@@unique([teamId, year, memberId])` — 팀별 독립.

**이유**: ADR-018은 인증/팀 레이어만 했고 엔티티는 단일 워크스페이스로 남겨, 2번째 팀이 1번째 팀 데이터를 공유했다(의도된 과도기). 이 ADR이 그 과도기를 끝낸다.

**트레이드오프**:
- 운영 DB 마이그레이션 필요(teamId 컬럼 + 제약/PK 변경 + 기존 행 백필). **공유 운영 DB라 `prisma db push`(실 반영)는 코드와 분리된 *검토된 수동 단계*로 실행**한다 — harness step은 스키마·백필·테스트 코드까지만 만들고, 실제 push/백필 실행은 사람이 검토 후 한다(ADR-018 step에서 push를 미룬 선례).
- 기존 데이터는 전부 부트스트랩된 "하박조팽" 팀(seed 이관 팀, 가장 먼저 생성된 팀)으로 백필(멱등).
- **교차 팀 격리**가 새 핵심 불변식 — 권한 누락 시 데이터 유출이므로 TDD로 강제한다.
- `R17`(논문 목록 필터 "전체" 하나)은 영향 없음 — 팀 내에서 "전체"는 그대로.
```

### 2. `docs/agent/RULES.md` — "팀 / 인증" 절에 R37 추가 (R19 다음 줄)

```markdown
- **R37. 모든 도메인 조회·변이는 활성 팀으로 스코핑한다.** 논문·발표자료·스케줄·벌금·라이브는 활성 팀(쿠키, **검증된 멤버십**)으로 필터하고, 쓰기 `teamId`는 세션의 활성 팀에서 주입한다(클라 미신뢰). 다른 팀 엔티티 접근은 `403`. (ADR-020, R19)
```

### 3. `docs/dev/DB.md` — 팀 스코핑 반영
- `Paper`·`Presentation`·`ScheduleMonth`·`FineConfig`·`MemberLedger`·`LiveSession`에 `teamId String`(+ `@@index([teamId])`)를 추가한다고 기술.
- 고유 제약 변경(`ScheduleMonth`/`FineConfig`/`MemberLedger`)을 명시.
- **CRITICAL 노트**: 운영 반영(`prisma db push`)·백필은 검토된 수동 단계(ADR-020). 기존 행은 부트스트랩 팀으로 백필.

### 4. `docs/dev/API.md` — 스코핑 반영
- 원칙의 "단일 테넌트: 워크스페이스 ID를 경로에 노출하지 않는다"를 **"활성 팀(쿠키)으로 암묵 스코핑 — 경로에 teamId 노출 안 함, 서버가 활성 팀으로 필터/주입"**으로 갱신.
- 논문·발표자료·스케줄·벌금·라이브 엔드포인트가 활성 팀으로 스코핑됨을 한 줄씩 명시. 활성 팀 전환 엔드포인트(예: `POST /api/teams/active` 또는 Server Action)를 추가.

### 5. `docs/agent/STATE.md` — 앱 레벨 상태에 활성 팀 추가
- 앱 레벨 클라이언트 상태 표에 `activeTeam`(slug, 쿠키 영속) 행 추가 — "대시보드·라이브러리·발표자료·스케줄·벌금·라이브 스코프를 좌우".

## Acceptance Criteria

```bash
npm run build
grep -q "ADR-020" docs/agent/ADR.md
grep -q "R37" docs/agent/RULES.md
```

## 검증 절차

1. AC 실행.
2. 체크리스트: ADR-020이 ADR-018 보류분 실행 + ADR-019(전역→팀당) 개정을 명시했는가? 운영 push가 수동 단계임을 적었는가? R37이 추가됐는가?
3. `phases/8-team-scoping/index.json`의 step 0 업데이트(completed+summary / error).

## 금지사항

- **코드를 수정하지 마라.** 이유: 문서 전용. 스키마·코드 전환은 step 1~5.
- **ADR-018의 멀티팀·초대 토큰 결정을 "고치지" 마라.** 이유: ADR-020은 그 위에 엔티티 스코핑만 얹는다.
- 기존 테스트를 깨뜨리지 마라.
