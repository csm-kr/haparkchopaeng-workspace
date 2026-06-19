# Step 1: data-model

`Publication` Prisma 모델과 데이터 접근 헬퍼 `lib/news.ts`(조회 + 저자 강조 유틸)를 만든다. **이 step은 스키마·로컬 client 생성·코드·단위 테스트까지만 한다.** 실제 운영 DB 반영(`prisma db push`)은 **사람이 검토 후 수동**으로 하므로 **여기서 실행하지 않는다**(ADR-020/`docs/dev/DB.md` CRITICAL).

## 읽어야 할 파일

먼저 아래를 읽고 설계 의도를 파악하라. **정본은 루트 `README.md` · `CLAUDE.md` · `PRD.md`이며, 충돌 시 이를 따른다.**

항상:
- `docs/dev/ARCHITECTURE.md` — 스택·디렉토리 구조
- `docs/agent/ADR.md` — **ADR-022(step 0에서 추가, NEWS)** · ADR-016(앱레벨 권한) · ADR-020(팀 스코핑)
- `docs/dev/CODING_CONVENTION.md` — 코드 규칙
- `docs/dev/DB.md` — 스키마 + **"db push 수동" CRITICAL**
- `docs/superpowers/specs/2026-06-19-news-tab-design.md` — 설계서(데이터 모델 절)

수정/참고 대상 코드(꼭 읽어라):
- `prisma/schema.prisma` — 기존 모델 패턴(특히 `Paper`·`Presentation`의 `teamId @default("")` 스코핑·`tags Json`·인덱스)
- `lib/presentations.ts` — 팀 스코핑 조회 헬퍼 패턴(`getPresentations(teamId)` 등). **이 파일을 그대로 본떠 `lib/news.ts`를 쓴다.**
- `lib/__tests__/presentations.test.ts`(또는 인접 lib 테스트) — prisma 목 단위 테스트 패턴
- `lib/prisma.ts` — prisma 클라이언트
- `prisma/seed.ts` — `Member.name` 값(하수현·박진희·조성민·팽진욱) 확인용(저자 강조 매칭 대상)

## 작업

### 1. `prisma/schema.prisma` — `Publication` 모델 추가

`docs/dev/DB.md`/설계서의 시그니처대로 모델을 추가한다:

```prisma
model Publication {
  id          String   @id @default(cuid())
  teamId      String   @default("") // 활성 팀 스코핑(ADR-020/R37). default ""는 컨벤션 일치 sentinel — 쓰기 시 명시 주입.
  title       String
  authors     String   // 자유 텍스트(쉼표 구분). 렌더 시 팀원 이름 강조
  venue       String   // 학회/저널명
  year        Int      // 정렬·그룹화 기준
  month       Int?     // 1–12, 선택
  teaserImage String?  // 스토리지 객체 키(news/ 접두)
  links       Json     // [{ label, url }]
  createdBy   String   // Member.id
  createdAt   DateTime @default(now())

  @@index([teamId])
}
```

그 뒤 **로컬 Prisma client만** 갱신한다:

```bash
npx prisma generate
```

> **CRITICAL: `npx prisma db push` / `prisma migrate` 를 실행하지 마라.** 이유: `DATABASE_URL`/`DIRECT_URL`은 **공유 운영 Supabase**를 가리킨다. 스키마의 실 DB 반영은 ADR-020/DB.md대로 사람이 검토 후 수동으로 한다. `prisma generate`는 로컬 타입 생성일 뿐 DB에 접속하지 않으므로 안전하다.

### 2. `lib/news.ts` — 조회 헬퍼 (TDD 먼저)

`lib/presentations.ts` 패턴을 따른다. 먼저 `lib/__tests__/news.test.ts`에 테스트를 쓴 뒤 구현한다.

```ts
export interface PublicationLink { label: string; url: string }

export interface PublicationView {
  id: string;
  title: string;
  authors: string;
  venue: string;
  year: number;
  month: number | null;
  teaserImage: string | null;
  links: PublicationLink[];
  createdBy: string;
}

/** 활성 팀의 실적 목록 — year desc, month desc(null 마지막). */
export async function getPublications(teamId: string): Promise<PublicationView[]>;

/** 팀 스코프 단건 — 없거나 다른 팀이면 null. */
export async function getPublication(teamId: string, id: string): Promise<PublicationView | null>;
```

- `getPublications`: `prisma.publication.findMany({ where: { teamId }, orderBy: [{ year: "desc" }, { month: "desc" }] })`. Postgres에서 `month desc`는 null이 마지막으로 정렬되는지 확인하고, 보장이 모호하면 정렬을 코드에서 한 번 더 안정화한다(테스트로 고정).
- `getPublication`: `findFirst({ where: { id, teamId } })`. 없으면 null.
- `links`는 `Json`이므로 읽을 때 `PublicationLink[]`로 안전 파싱(형식 안 맞으면 빈 배열).

### 3. `lib/news.ts` — 저자 강조 유틸 (TDD 먼저, 순수 함수)

```ts
export interface AuthorSegment { text: string; isMember: boolean }

/** 자유 텍스트 저자 문자열을 쉼표로 나누고, memberNames에 포함된 이름은 isMember=true로 표시. */
export function splitAuthors(authors: string, memberNames: string[]): AuthorSegment[];
```

- 쉼표(`,`) 기준 분할 + 각 조각 trim. 빈 조각 제거.
- 조각이 `memberNames` 중 하나와 (trim 후) 일치하면 `isMember=true`. 단순 동등 비교로 충분(현 4인 규모, 동명이인 무시).
- 입력이 빈 문자열이면 빈 배열.

### 4. 단위 테스트 `lib/__tests__/news.test.ts`

- `getPublications`: prisma 목으로 호출 시 `where.teamId`가 전달되고 정렬이 year desc·month desc(null 마지막)인지. 다른 팀 데이터가 섞이지 않는지(목 반환을 그대로 검증).
- `getPublication`: id+teamId로 `findFirst` 호출, 없으면 null.
- `splitAuthors`: 팀원 이름 강조 / 외부 저자 비강조 / 공백·빈 조각 처리 / 빈 입력 → 빈 배열.

## Acceptance Criteria

```bash
npx prisma generate          # 로컬 client에 Publication 반영 (DB 접속 없음)
npm run build                # 타입/컴파일 에러 없음
npm test                     # Vitest — news 조회·splitAuthors 단위 테스트
```

## 검증 절차

1. AC 실행.
2. 체크리스트:
   - `Publication`이 기존 `teamId @default("")` 스코핑 패턴을 따르는가?
   - **`prisma db push`/`migrate`를 실행하지 않았는가**(generate만)?
   - `getPublications`/`getPublication`이 팀 스코프를 거는가?
   - `splitAuthors`가 순수 함수이고 팀원 이름만 강조하는가?
   - `docs/dev/CODING_CONVENTION.md`를 지켰는가?
3. `phases/10-news-tab/index.json`의 step 1 업데이트(`completed`+`summary`). summary에 "Publication 모델 추가·prisma generate(로컬), lib/news.ts(getPublications/getPublication/splitAuthors)·테스트. db push는 미실행(수동 후속)" 명시.

## 금지사항

- **`npx prisma db push` / `prisma migrate` 를 실행하지 마라. 이유: 공유 운영 DB — 사람이 검토 후 수동 반영(ADR-020/DB.md).**
- **`Paper` 등 기존 모델을 수정하지 마라.** 이유: NEWS는 독립 추가다. 기존 분석 기능과 의미가 다르다(ADR-022).
- **API 라우트·컴포넌트·화면을 만들지 마라.** 이유: 이 step은 데이터 레이어만 — API는 step 2, UI는 step 3~4.
- 기존 테스트를 깨뜨리지 마라.
