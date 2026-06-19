# Step 4: routes-nav

NEWS 화면을 배선한다: 목록 RSC `/news`(+`loading.tsx`), 티저 상세 RSC `/news/[id]`, 사이드바 내비 항목. RSC가 활성 팀 스코프로 조회하고, 티저 이미지 **서명 URL**과 저자 강조 세그먼트를 계산해 step 3 컴포넌트에 주입한다.

> **E2E 주의:** NEWS는 신규 테이블이라 실제 동작 검증(Playwright)은 운영 DB에 `prisma db push`가 **수동 반영된 뒤**에만 가능하다(ADR-020). 이 step의 AC에 Playwright를 넣지 않는다 — E2E는 db push 후 수동 후속으로 돌린다(아래 검증 절차 참고).

## 읽어야 할 파일

먼저 아래를 읽고 설계 의도를 파악하라. **정본은 루트 `README.md` · `CLAUDE.md` · `PRD.md`이며, 충돌 시 이를 따른다.**

항상:
- `docs/dev/ARCHITECTURE.md` — 라우트/디렉토리 구조
- `docs/agent/ADR.md` — ADR-022(NEWS) · ADR-015(읽기 RSC) · ADR-020(팀 스코핑)
- `docs/dev/CODING_CONVENTION.md` — 코드 규칙
- `docs/design/SCREENS.md`(NEWS 화면) · `docs/design/DESIGN_GUIDE.md`
- `docs/agent/RULES.md` — **R26/R30**(빈 상태·인라인 실패) · **R36**(서명 URL) · **R37**(활성 팀)
- `docs/superpowers/specs/2026-06-19-news-tab-design.md` — 설계서(화면/데이터 흐름 절)

이전 step 산출물(꼭 읽어라):
- `lib/news.ts` — `getPublications`·`getPublication`·`splitAuthors`·타입
- `components/news/*` — `PublicationList`·`PublicationForm`·`TeaserView`·`index.ts`(props 형태 확인)

수정/참고 대상 코드(꼭 읽어라):
- `app/(app)/presentations/page.tsx` — **목록 RSC 정본**(getSession→getActiveTeam(없으면 /teams)→조회→리스트, Topbar crumbs+actions, 실패 시 인라인 에러 카드). 그대로 본뜬다.
- `app/(app)/presentations/[id]/page.tsx` — 상세 RSC 패턴(팀 스코프 단건, 없으면 `notFound()`)
- `app/(app)/presentations/loading.tsx`(있으면) 또는 다른 `loading.tsx` — 스켈레톤 패턴
- `components/shell/nav.ts` — 내비 항목 배열(**여기에 NEWS 추가**)
- `components/shell` (`Topbar`) — 상단바
- `lib/storage.ts` — `signedDownloadUrl(path, ttl)`(티저 서명 URL)
- `lib/active-team.ts`·`lib/auth.ts`
- `lib/prisma.ts` — 저자 강조에 쓸 멤버 이름(`prisma.member.findMany({ select: { name: true } })`)

## 작업

### 1. `app/(app)/news/page.tsx` (목록 RSC)
`presentations/page.tsx`를 본뜬다.
- `getSession()`(없으면 `redirect("/")`) → `getActiveTeam`(없으면 `redirect("/teams")`).
- `getPublications(team.id)` 조회. 각 항목에 대해:
  - `teaserImage`가 있으면 `signedDownloadUrl(teaserImage)`로 `teaserUrl` 해석(없으면 null). 서명 실패는 null로 폴백(화면을 깨지 않음).
  - 멤버 이름 목록으로 `splitAuthors(authors, memberNames)` → `authorSegments`.
  - → `PublicationCardData[]`로 매핑해 `PublicationList`에 전달.
- `Topbar` crumbs `[{ label: "NEWS" }]` + actions에 "실적 추가"(폼으로 이동/모달 — step 3 폼 사용; 발표 자료의 Create 버튼 패턴과 동일 위치).
- 조회 실패 시 **인라인 에러 카드 + 다시 시도**(presentations 패턴, R30).

### 2. `app/(app)/news/[id]/page.tsx` (티저 상세 RSC)
- 세션·활성 팀 확인 → `getPublication(team.id, id)`; 없으면 `notFound()`(다른 팀·없는 id 모두 404).
- 티저 서명 URL + `splitAuthors` 세그먼트 계산 → `TeaserView`에 주입. `canEdit`는 현 정책상 `true`(모든 팀원).

### 3. `app/(app)/news/loading.tsx`
- 목록 스켈레톤(기존 `loading.tsx` 톤).

### 4. (생성/편집 진입) "실적 추가"·편집
- 추가/편집은 step 3의 `PublicationForm`을 쓴다. 발표 자료와 같은 방식으로 노출한다(버튼→모달 또는 전용 경로). **기존 발표 자료가 택한 방식과 동일하게 맞춘다**(create-presentation-button 패턴). 새 패턴을 발명하지 마라.

### 5. `components/shell/nav.ts` — NEWS 항목 추가
- `lucide-react`에서 적절한 아이콘(예: `Newspaper`) import.
- `NAV_ITEMS` 배열에서 **"논문"(library) 다음**에 추가:
  ```ts
  { id: "news", href: "/news", label: "NEWS", Icon: Newspaper },
  ```
- 상단 주석의 내비 순서 설명도 한 줄 갱신한다.

### 6. 테스트(있으면 보강)
- nav에 NEWS 항목이 포함되는지(`components/shell/__tests__/shell.test.tsx` 또는 nav 테스트가 있으면 보강). RSC 자체는 E2E 대상이라 여기선 단위/컴포넌트 수준 회귀만 유지한다.

## Acceptance Criteria

```bash
npx prisma generate          # client 최신화(DB 접속 없음)
npm run build                # 타입/컴파일 에러 없음 — 새 라우트 포함
npm test                     # Vitest + RTL — 기존 + nav 회귀 green
npm run lint                 # 규칙 준수
```

> Playwright(E2E)는 AC에 넣지 않는다 — Publication 테이블이 운영 DB에 아직 없다(db push 수동). 넣으면 `/news`가 런타임에 깨져 실패한다.

## 검증 절차

1. AC 실행(build/test/lint green).
2. 체크리스트:
   - 목록·상세 RSC가 **활성 팀 스코프**인가? 상세는 다른 팀/없는 id에 `notFound()`인가(R37)?
   - 티저 이미지가 **서명 URL**로만 노출되는가(R36)? 서명 실패가 화면을 깨지 않는가?
   - 빈 상태·인라인 에러가 R26/R30을 따르는가?
   - `nav.ts`에 NEWS가 "논문" 다음에 추가됐는가?
   - 생성/편집 진입이 **기존 발표 자료 방식과 동일**한가(새 패턴 발명 금지)?
3. `phases/10-news-tab/index.json`의 step 4 업데이트(`completed`+`summary`). summary에 "/news 목록·/news/[id] 상세 RSC(서명URL·저자강조)·loading·nav NEWS 추가. E2E는 db push 후 수동" 명시.
4. **수동 후속(사람):** 코드 머지 검토 후 `npx prisma db push`로 운영 DB에 `Publication` 반영 → 그 다음 `/news` 핵심 경로 E2E(추가→목록→티저)를 수동 실행. **이 단계는 harness가 하지 않는다(ADR-020).**

## 금지사항

- **`prisma db push`/`migrate`를 실행하지 마라. 이유: 공유 운영 DB 수동 반영(ADR-020/DB.md).**
- **AC에 `npx playwright test`를 넣지 마라. 이유: 테이블 미반영 상태라 `/news`가 런타임 실패한다 — E2E는 db push 후 수동.**
- **`getActiveTeam` 우회·클라 입력 신뢰를 하지 마라(R3/R37).**
- **이미지를 공개 URL로 노출하지 마라(R36).**
- 기존 라우트·내비 동작을 깨뜨리지 마라.
