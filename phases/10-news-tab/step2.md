# Step 2: api-layer

NEWS 쓰기 API를 만든다: 티저 이미지 프리사인(`presign`에 `kind:"news"` 추가)과 실적 CRUD(`POST /api/news`, `PATCH`/`DELETE /api/news/[id]`). 모두 `requireAuth` + 활성 팀 스코프이고 `teamId`·`createdBy`는 서버가 주입한다(클라 입력 미신뢰).

## 읽어야 할 파일

먼저 아래를 읽고 설계 의도를 파악하라. **정본은 루트 `README.md` · `CLAUDE.md` · `PRD.md`이며, 충돌 시 이를 따른다.**

항상:
- `docs/dev/ARCHITECTURE.md` — 스택·디렉토리 구조
- `docs/agent/ADR.md` — ADR-022(NEWS) · ADR-016(앱레벨 권한) · ADR-020(팀 스코핑) · ADR-013(분 단위 작업만 잡)
- `docs/dev/CODING_CONVENTION.md` — 코드 규칙
- `docs/dev/API.md` — NEWS 엔드포인트(step 0에서 추가)
- `docs/agent/RULES.md` — **R3**(신원/스코프는 세션·활성 팀에서) · **R19/R37**(앱레벨 권한·활성 팀) · **R36**(프리사인·비공개 버킷·서명 URL)
- `docs/security/SECURITY.md` — 업로드/권한 규칙
- `docs/superpowers/specs/2026-06-19-news-tab-design.md` — 설계서(API/보안 절)

이전 step 산출물(꼭 읽어라):
- `lib/news.ts`, `lib/__tests__/news.test.ts` — step 1에서 만든 조회 헬퍼·타입(`PublicationLink`)

수정/참고 대상 코드(꼭 읽어라):
- `app/api/uploads/presign/route.ts` — **이 파일을 수정**한다. 현재 `kind: "paper" | "presentation"` 분기·확장자 화이트리스트·`randomUUID` 객체 키 생성 패턴.
- `app/api/presentations/route.ts` — `POST` 패턴(requireAuth → getActiveTeam(없으면 403) → zod 파싱 → `teamId` 서버 주입 → create). **이 구조를 본떠 `POST /api/news`를 쓴다.**
- `app/api/presentations/[id]/route.ts` — `PATCH`/`DELETE` 패턴(팀 스코프 `findFirst` → 없으면 404 → 수정/삭제). 그대로 본뜬다.
- `lib/http.ts` — `ok`·`fail`·`toErrorResponse`
- `lib/auth.ts` — `requireAuth()`(미인증 throw)
- `lib/active-team.ts` — `getActiveTeam(memberId)`
- `lib/storage.ts` — `createSignedUploadUrl`·`ensureBucket`·`removeObject`
- `lib/prisma.ts`

## 작업

### 1. `app/api/uploads/presign/route.ts` — `news` 종류 추가

- 요청 zod `kind` enum에 `"news"`를 추가한다(`["paper","presentation","news"]`).
- `kind === "news"`: 파일명이 **이미지 확장자(`.png`/`.jpg`/`.jpeg`/`.webp`)** 일 때만 허용, 아니면 `415`("이미지 파일만 올릴 수 있어요."). 객체 키 접두는 `news/`, 확장자는 원본 확장자 유지. `news/${randomUUID()}.${ext}`.
- 기존 `paper`/`presentation` 분기는 그대로 둔다.

### 2. `POST /api/news` — `app/api/news/route.ts` (신규, TDD 먼저)

`app/api/presentations/route.ts`를 본뜬다.

- `requireAuth()` → `getActiveTeam(session.memberId)`(없으면 `fail(403, "FORBIDDEN", ...)`).
- zod 입력:
  ```ts
  const Link = z.object({ label: z.string().trim().min(1), url: z.string().trim().url() });
  const Body = z.object({
    title: z.string().trim().min(1),
    venue: z.string().trim().min(1),
    authors: z.string().trim().min(1),
    year: z.number().int(),
    month: z.number().int().min(1).max(12).optional(),
    teaserImage: z.string().regex(/^news\//).optional(), // 프리사인이 준 news/ 키만 신뢰
    links: z.array(Link).default([]),
  });
  ```
- `prisma.publication.create`로 저장하되 **`teamId: team.id`·`createdBy: session.memberId`를 서버가 주입**한다(클라 값 무시). `links`는 그대로 Json 저장. 응답 `ok({ id }, 201)`.

> **CRITICAL: `teamId`·`createdBy`를 클라 입력에서 받지 마라(R3/R37).** 이유: 권한 위조로 다른 팀에 쓰거나 작성자를 사칭할 수 있다.
> **CRITICAL: `teaserImage`는 `^news/` 접두만 허용하라(R36).** 이유: 임의 객체 경로 참조를 막는다.

### 3. `PATCH` / `DELETE /api/news/[id]` — `app/api/news/[id]/route.ts` (신규, TDD 먼저)

`app/api/presentations/[id]/route.ts`를 본뜬다. 둘 다 `requireAuth` + `getActiveTeam` 후 **`prisma.publication.findFirst({ where: { id, teamId: team.id } })`** 로 팀 스코프를 검증하고 없으면 `404`(존재 숨김, R19/R37).

- `PATCH`: 위 `Body`의 부분 수정(모든 필드 optional). `teamId`/`createdBy`는 변경 불가(무시). `teaserImage` 변경 시 형식(`^news/`) 검증. 업데이트 후 `ok({ id })`.
- `DELETE`: 삭제 후 기존 `teaserImage`가 있으면 `removeObject(teaserImage)`를 **best-effort**(실패해도 200). `ok({ id })`.

### 4. 테스트

- `app/api/news/__tests__/news.test.ts`(신규):
  - 미인증 → throw/401, 활성 팀 없음 → 403.
  - `POST`가 `teamId`·`createdBy`를 **세션/활성 팀에서 주입**하고 클라가 보낸 위조 `teamId`/`createdBy`를 무시하는지.
  - 잘못된 입력(제목/학회/저자 누락, `month` 범위 밖, `teaserImage`가 `news/` 아님, `links[].url` 비-URL) → 400/거부.
  - `PATCH`/`DELETE`가 **다른 팀 id면 404**.
  - `DELETE`가 `teaserImage` 있으면 `removeObject` 호출(목).
  - prisma·storage·auth는 목(기존 api 테스트 패턴).
- `app/api/uploads/presign/__tests__/`(보강 또는 신규): `kind:"news"` + 이미지 확장자 → `news/` 키 발급; 비이미지 → 415.

## Acceptance Criteria

```bash
npm run build      # 타입/컴파일 에러 없음
npm test           # Vitest — news API + presign news 분기
```

## 검증 절차

1. AC 실행.
2. 체크리스트:
   - `teamId`·`createdBy`가 **서버 주입**이고 클라 입력을 신뢰하지 않는가(R3/R37)?
   - 모든 라우트가 **활성 팀 스코프**를 거는가? 다른 팀 자원이 404인가?
   - `teaserImage`가 `^news/` 접두만 허용하는가(R36)? presign이 이미지 확장자만 허용하는가?
   - `DELETE`의 `removeObject`가 best-effort(실패가 삭제를 막지 않음)인가?
   - 기존 `paper`/`presentation` presign 동작을 깨지 않았는가?
3. `phases/10-news-tab/index.json`의 step 2 업데이트(`completed`+`summary`). summary에 "presign news 종류 + /api/news POST·[id] PATCH/DELETE(teamId·createdBy 서버주입, 팀스코프 404, teaserImage news/ 제한, 삭제 시 removeObject)·테스트" 명시.

## 금지사항

- **`teamId`/`createdBy`를 요청 본문에서 받지 마라. 이유: 권한·작성자 위조(R3/R37).**
- **`teaserImage`에 임의 경로를 허용하지 마라(`^news/`만). 이유: 다른 객체 참조 차단(R36).**
- **분석/잡(Inngest)·figure 코드를 건드리지 마라.** 이유: NEWS는 외부 링크만 — 업로드·분석 파이프라인과 무관(ADR-022).
- **컴포넌트·화면을 만들지 마라.** 이유: UI는 step 3~4.
- **`prisma db push`를 실행하지 마라.** 이유: 공유 운영 DB 수동 반영(ADR-020).
- 기존 테스트를 깨뜨리지 마라.
