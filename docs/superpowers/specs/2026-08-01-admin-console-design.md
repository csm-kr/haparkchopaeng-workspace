# 관리자 콘솔(`/admin`) — 라이브 사용량 가시화 + 전역 팀 상한 조절

- 작성일: 2026-08-01
- 상태: 설계 승인됨 (구현 대기)
- 관련: ADR-018(멀티팀), ADR-019(LiveKit), ADR-021(팀 허브·상한 정책), R30(인라인 피드백), R19(앱레벨 권한)

## 배경

운영 중 두 가지 문제가 드러났다.

1. **팀을 더 만들 수 없다.** 전역 팀 상한 `MAX_TEAMS`(기본 2)에 도달해 팀 허브에서 "최대 팀 수에 도달했어요"만 뜬다. 값을 바꾸려면 env 수정 + 재배포가 필요해 운영자가 스스로 처리할 수 없다.
2. **LiveKit 무료 한도 1,000분을 얼마나 썼는지 알 수 없다.** 앱 어디에도 라이브 사용량 집계가 없어, 한도 소진을 사후에야 알게 된다.

## 목표 / 비목표

**목표**
- 운영자가 이번 달 라이브 사용량(참가자-분)과 남은 한도를 한 화면에서 본다.
- 운영자가 재배포 없이 전역 팀 상한을 조절한다.

**비목표**
- per-user 팀 한도·요금제 (ADR-018의 "상업화 시점 도입" 유지)
- LiveKit Analytics API 연동 (DB 추정으로 충분하다고 판단 — 아래 "정확도" 참조)
- 주간 논문 분석 한도(`PAPER_WEEKLY_LIMIT`) 조절 UI, 실패 Job 목록 (이번 범위 밖)

## 결정 사항

### 1. ADR-021 개정 — 팀 상한은 이제 DB 설정이다

ADR-021은 상한을 **"admin이 env(`MAX_TEAMS`)로만 설정, 사용자 UI로 변경 불가"** 로 규정했다. 이 조항을 개정한다.

- 개정 후: 상한은 **DB(`AppSetting.maxTeams`)** 에 저장하고 `/admin`에서 조절한다.
- 유지되는 것: 상한은 여전히 **전역**(서버 전체 `team.count()` 기준, per-user 아님)이다.
- env `MAX_TEAMS`는 **폴백**으로 남긴다 — DB row가 없을 때만 참조.

우선순위: **DB > env > 코드 기본(2)**

### 2. `AppSetting` 모델 (단일 row)

```prisma
model AppSetting {
  id        String   @id @default("singleton") // CRITICAL: row는 단 하나
  maxTeams  Int? // null = env/기본값 폴백
  updatedAt DateTime @updatedAt
  updatedBy String? // Member.id (감사용)
}
```

`Workspace`(ADR-007 레거시 단일 row)에 얹지 않는다 — 멀티팀 전환으로 의미가 죽은 모델이라 새 관심사를 섞지 않는다.

### 3. `maxTeams()` 동기 → 비동기 전환

DB를 읽어야 하므로 시그니처가 바뀐다. 이것이 이 작업의 **가장 큰 파급**이다.

```ts
// lib/settings.ts (신규)
export async function maxTeams(): Promise<number>   // DB > env > 2
export async function setMaxTeams(value: number, updatedBy: string): Promise<void>
```

- `lib/teams.ts`의 `maxTeams()`는 제거하고 `lib/settings.ts`에서 re-export하지 않는다(호출부가 직접 import).
- 영향 받는 호출부: `canCreateTeam()`, `createTeam()` — 이미 async라 `await` 추가로 끝난다.
- 영향 받는 테스트: `lib/__tests__/teams.test.ts`의 `process.env.MAX_TEAMS` 기반 케이스(약 14곳). env 폴백 경로는 그대로 유효하므로 **DB row 없음**을 목으로 두고 기존 단언을 유지한다. DB 우선 케이스는 `lib/__tests__/settings.test.ts`에 새로 쓴다.

### 4. 관리자 게이트 — 이메일 고정

현재 `requireRole("관리자")`는 `Member.role` 기반이라 DB에서 누구든 승격될 수 있다. 관리자 콘솔은 **이메일로 고정**한다.

```ts
// lib/auth.ts
export async function requireSuperAdmin(): Promise<Session>
```

- env `ADMIN_EMAIL`(기본 `de8167@gmail.com`)과 세션 `memberId`로 조회한 `Member.email`이 일치할 때만 통과.
- 불일치·미인증이면 `HttpError(404, "NOT_FOUND", ...)`를 던진다. 403이 아니다 — 콘솔의 존재 자체를 숨긴다.
- `notFound()`는 `lib/auth.ts`가 아니라 **`app/admin/page.tsx`에서** 호출한다(라이브러리를 Next 렌더 API에 묶지 않는다). Server Action은 던져진 `HttpError`를 판별 유니온으로 변환한다.
- 비교는 소문자 정규화 + trim 후 수행.

### 5. 라이브 사용량 집계 — `lib/live-usage.ts` (신규)

**단위: 참가자-분(participant-minutes).** LiveKit 과금 단위와 같은 개념이다 — 4명이 30분 미팅하면 120분.

```
참가자별 체류 = (leftAt ?? session.endedAt ?? now) − joinedAt
```

- 음수는 0으로 클램프.
- 월 경계는 **KST 1일 00:00** 기준(`startOfMonthKST()`). `lib/rate-limit.ts`의 `startOfWeekKST()`와 같은 방식으로 구현한다.
- 세션이 월을 걸치면 **`joinedAt`이 속한 달**에 전액 귀속한다. 분할하지 않는다 — 미팅 길이 대비 월 경계 사례가 드물고, 분할 로직이 검증 비용에 비해 이득이 없다.

```ts
export interface LiveUsage {
  usedMinutes: number;      // 이번 달 참가자-분(추정)
  limitMinutes: number;     // LIVE_MINUTES_QUOTA, 기본 1000
  remainingMinutes: number; // max(0, limit − used)
  byTeam: { teamId: string; teamName: string; minutes: number }[];
}
export async function currentMonthUsage(): Promise<LiveUsage>
/** month는 KST 기준 "YYYY-MM". 오래된 달 → 최근 달 순으로 정렬, 사용 없는 달도 0으로 채운다. */
export async function monthlyTrend(months: number): Promise<{ month: string; minutes: number }[]>
```

#### 정확도 — 이 값은 추정치다

UI에 **"추정치"** 라고 명시한다. 실제 LiveKit 과금과 다를 수 있는 이유:

- `Participant`에 `@@unique([liveSessionId, memberId])`가 걸려 있고 재참가 시 기존 행을 `leftAt=null`로 덮어쓴다(`app/api/live/[id]/join/route.ts:43-44`). 이전 체류 구간이 소실되어 **과소집계**된다.
- 탭을 닫으면 `/leave`가 호출되지 않아 `leftAt`이 null로 남는다 → `endedAt`으로 보정하지만, 실제 이탈 시각보다 늦어 **과대집계**될 수 있다.
- 아직 진행 중인 세션은 `now` 기준이라 조회 시점마다 값이 늘어난다.

정확한 값이 필요해지면 LiveKit Analytics API 연동을 별도 작업으로 검토한다.

### 6. 한도 1,000분은 조절 대상이 아니다

LiveKit 플랜이 주는 고정값이므로 `/admin`에 입력 UI를 두지 않는다. 다만 플랜 변경에 대비해 env `LIVE_MINUTES_QUOTA`(기본 1000)로 읽는다.

## 화면 — `app/admin/page.tsx`

`(app)` 셸 **밖**에 둔다. 팀 컨텍스트(활성 팀 쿠키)와 무관한 전역 콘솔이고, `/teams` 로비와 같은 층위다.

**읽기 영역**
- 이번 달 라이브: `사용 N분 / 1,000분` + 진행바 + 남은 분. 80% 초과 시 경고색, 100% 도달 시 위험색.
- "추정치" 배지 + 근거 툴팁.
- 최근 6개월 월별 추이(막대).
- 이번 달 팀별 분해(표).
- 현재 팀 수 / 상한.

**조절 영역**
- 전역 팀 상한: 숫자 입력 + 저장. Server Action `setMaxTeamsAction`.
  - 가드: **현재 팀 수보다 작은 값은 거부**한다(이미 만들어진 팀을 상한 미만으로 남기지 않는다). 코드 `BELOW_CURRENT`.
  - 범위: 1–100. 벗어나면 `INVALID_RANGE`.
  - 결과는 **인라인 메시지**(R30). 토스트 금지.

## 데이터 흐름

```
/admin (RSC)
  ├─ requireSuperAdmin()            → 불일치 시 notFound()
  ├─ currentMonthUsage()            → LiveSession + Participant 조회
  ├─ monthlyTrend(6)
  ├─ prisma.team.count()
  └─ maxTeams()                     → AppSetting > env > 2
        ↓
  admin-settings-form (client)
        └─ setMaxTeamsAction(value) → requireSuperAdmin() 재검증 → setMaxTeams() → revalidatePath("/admin")
```

권한은 **RSC와 Server Action 양쪽에서** 검사한다(R19 — Server Action은 독립 진입점이다).

## 오류 처리

| 상황 | 처리 |
|---|---|
| 비관리자 접근 | `notFound()` → 404 |
| 상한 < 현재 팀 수 | `BELOW_CURRENT` 인라인: "이미 만들어진 팀이 N개예요. 그보다 작게는 못 줄여요." |
| 상한 범위 밖 | `INVALID_RANGE` 인라인: "1–100 사이로 입력해주세요." |
| 라이브 세션 0건 | 사용량 0분으로 정상 표시(빈 상태 문구) |

## 테스트 (TDD — 구현 전 작성)

**`lib/__tests__/live-usage.test.ts`**
- `startOfMonthKST` — 월 경계, KST 1일 00:00 정각 포함, 연말 경계
- `leftAt` null + 세션 종료됨 → `endedAt`으로 보정
- `leftAt` null + 세션 진행 중 → `now`로 보정
- 참가자 3명 × 10분 = 30분(참가자-분)
- 음수 구간 클램프
- 팀별 분해 합 = 전체 합
- 지난달 세션은 이번 달 집계에서 제외

**`lib/__tests__/settings.test.ts`**
- DB row 있으면 DB 값 (env 무시)
- DB row 없고 env 있으면 env 값
- 둘 다 없으면 2
- `maxTeams` null이면 env/기본 폴백
- `setMaxTeams` upsert 멱등

**`lib/__tests__/teams.test.ts` (수정)**
- `maxTeams()` await로 전환, DB row 없음 목으로 기존 env 케이스 유지

**`lib/__tests__/auth.test.ts` (추가)**
- `requireSuperAdmin` — 이메일 일치 통과 / 불일치 throw / 대소문자 무시 / 미인증 throw

**`app/admin/__tests__/`**
- 비관리자 → 404
- 관리자 → 사용량·상한 렌더
- `setMaxTeamsAction` — 현재 팀 수 미만 거부, 범위 밖 거부, 정상 저장

## 마이그레이션

`prisma migrate dev --name add_app_setting` → `AppSetting` 테이블 추가. 초기 row는 만들지 않는다(부재 = env/기본 폴백, ADR-006/R15 정신).

⚠️ Windows에서 `prisma generate` 시 `next dev`가 엔진 DLL을 잡고 있으면 EPERM이 난다 — 개발 서버를 먼저 종료할 것.

## 단계 분리

- **1단계 (완료, 2026-08-01)**: `MAX_TEAMS=3`을 로컬 `.env` + Vercel 프로덕션 env에 추가하고 기존 프로덕션 배포본을 재빌드. 코드 변경 없음. 운영에서 즉시 팀 1개 추가 생성 가능.
- **2단계 (이 문서)**: `/admin` 콘솔 구축. 완료 시 상한 관리 주체가 env → DB로 이관된다. env `MAX_TEAMS=3`은 폴백으로 남겨둔다.
