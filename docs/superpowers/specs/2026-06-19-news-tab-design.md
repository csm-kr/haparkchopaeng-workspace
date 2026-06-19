# NEWS 탭 — 팀 출판 실적 쇼케이스 설계

- 날짜: 2026-06-19
- 상태: 승인됨 (구현 진행)
- 관련: 발표 자료 CRUD 패턴(`presentations`), 팀 스코핑(ADR-020/R37), 스토리지 프리사인·서명 URL(R36), 단일 그룹 비공개 워크스페이스(ADR-007)

## 배경 / 목표

지금 "논문" 기능(`Paper`)은 **남의 논문을 업로드해 두 관점(연구·재구현)으로 분석**하는 협업 도구다. 이번에 추가하는 **NEWS 탭**은 성격이 전혀 다르다 — **우리 팀이 쓴(발표한) 논문 = 우리 실적**을 모아 보여주는 내부 쇼케이스다. 랩 홈페이지의 "Publications/News" 섹션을 팀 내부 전용으로 옮긴 것.

각 실적은 **제목·학회명·저자·연/월·티저 이미지·외부 링크**를 담고, 전용 **티저 상세 페이지**에서 대표 이미지로 "그 논문을 보여준다". 모든 팀원이 추가·편집·삭제할 수 있다.

## 방식 선택

- **택함: 새 `Publication` 모델 + 전용 CRUD.** `presentations`/`papers` 구조를 그대로 미러링한다(목록 RSC + 상세 RSC + `app/api` CRUD + `lib` 헬퍼 + `components`). 분석 기능과 의미가 깔끔히 분리되고 기존 패턴과 100% 일치.
- **버림: 기존 `Paper`에 `kind` 플래그.** `schema.prisma`에 **"CRITICAL: kind 같은 타입 필드 두지 말 것"** 이 명시돼 있고, Paper엔 `analyses`/`figures`/`notes`가 딸려 의미가 다르다. 부적합.
- **공개 범위: 팀 내부 전용.** 외부 공개 라우트·인증 우회·SEO 없음 — 기존 앱 셸 안에서 로그인+활성 팀 스코프로만 접근(가장 단순, 보안 일관).
- **저자: 자유 텍스트 한 줄.** 외부 공저자가 자연스럽고 기존 `Paper.authors`와 동일. 렌더 시 팀원 이름만 자동 강조(Member 연결 없음 — 집계 요구 없음, YAGNI).
- **티저 이미지: 클라→스토리지 프리사인 직접 업로드(R36).** figure 이미지와 동일하게 **비공개 버킷 + 단기 서명 URL**로 서빙. 공개 버킷·영구 URL 금지.

## 범위

**In**
- Prisma 모델 `Publication`(아래) + 마이그레이션(`teamId` 포함).
- 사이드바 `nav.ts`에 `NEWS` 항목 추가("논문" 다음).
- `lib/news.ts` — `getPublications(teamId)`, `getPublication(teamId, id)`(Prisma 직접, 팀 스코핑).
- 라우트(RSC): `/news`(목록 카드 그리드), `/news/[id]`(티저 상세).
- API: `POST /api/news`(생성), `PATCH`/`DELETE /api/news/[id]`. `requireAuth`+활성 팀, `teamId`·`createdBy` 서버 주입(R3/R37).
- 프리사인 확장: `presign`에 `kind: "news"` 추가 → `news/` 접두 + 이미지 확장자(png/jpg/webp)만 허용.
- 컴포넌트: 목록(`PublicationList`/카드 + 빈 상태 CTA), 추가/편집 폼(모달 또는 인라인), 티저 상세 뷰, 저자 팀원 강조 유틸.

**Out (이번 범위 아님)**
- 외부 공개 페이지·공유 링크·SEO — 내부 전용.
- 초록/본문 텍스트 — 선택 안 함(필요 시 컬럼 추가). 이미지 중심 티저.
- 출판 상태 배지(under review/accepted) — 실적(완료) 쇼케이스라 제외.
- 팀원 Member 연결·멤버별 실적 집계 — 자유 텍스트 강조로 충분.
- PDF 업로드/분석 — 그건 기존 "논문" 기능 소관. NEWS는 외부 링크만.
- 댓글/반응/버전 — 실적 카드엔 불필요.

## 데이터 모델

```prisma
model Publication {
  id          String   @id @default(cuid())
  teamId      String   @default("") // 활성 팀 스코핑(ADR-020/R37). default ""는 백필 sentinel — 쓰기 시 명시 주입.
  title       String
  authors     String   // 자유 텍스트(쉼표 구분). 렌더 시 팀원 이름 강조
  venue       String   // 학회/저널명 (예: "NeurIPS 2025")
  year        Int      // 정렬·그룹화 기준
  month       Int?     // 1–12, 선택. 모르면 null(연도만 표시)
  teaserImage String?  // 스토리지 객체 키(news/ 접두). 없으면 플레이스홀더
  links       Json     // [{ label: string, url: string }] — arXiv/PDF/코드/프로젝트
  createdBy   String   // Member.id
  createdAt   DateTime @default(now())

  @@index([teamId])
}
```

- 정렬: `year` desc, `month` desc(null은 마지막). 표시는 `month` 있으면 "2025.03", 없으면 "2025".
- `authors`: 팀 4인(하수현·박진희·조성민·팽진욱) 이름이 본문에 있으면 색/굵게 강조. 매칭은 `Member.name` 기준.
- `links`: 빈 배열 허용. 폼에서 "arXiv/PDF/코드/프로젝트" 프리셋 라벨 + URL 입력으로 행 추가.
- 기존 팀 스코프 엔티티(Paper/Presentation 등)와 동일하게 `teamId @default("")` sentinel — 신규 테이블이라 백필 대상은 없지만 컨벤션 일치.

## 화면 / 데이터 흐름

1. **목록 `/news`(RSC):** `getSession`→`getActiveTeam`(없으면 `/teams`)→`getPublications(team.id)`. 카드 그리드 — 티저 썸네일(서명 URL) + 제목 + 학회명·연/월 + 저자(팀원 강조). 빈 상태: "아직 등록된 실적이 없어요" + "첫 실적 추가하기" CTA. 우상단 Topbar 액션 "실적 추가"(모든 팀원). 조회 실패 시 인라인 에러 카드 + 다시 시도(presentations 패턴).
2. **추가/편집:** 폼에서 제목·학회·저자·연·월·링크 입력 + 티저 이미지 선택 → `presign(kind:"news")`로 객체 키 받아 스토리지 직접 업로드 → `POST /api/news`(또는 `PATCH`)에 객체 키·필드 전송. 서버가 `teamId`·`createdBy` 주입.
3. **티저 상세 `/news/[id]`(RSC):** 큰 티저 이미지(서명 URL) + 제목 + 학회명·연/월 + 저자(강조) + 외부 링크 버튼들. 편집·삭제 액션(모든 팀원). 다른 팀/없는 id면 404(존재 숨김, R19/R37).
4. **삭제:** `DELETE /api/news/[id]` → DB 삭제 + `removeObject(teaserImage)` best-effort 정리.

## 아키텍처 (델타)

| 파일 | 변경 |
|---|---|
| `prisma/schema.prisma` | **신규 모델** `Publication` + 마이그레이션 |
| `components/shell/nav.ts` | `{ id:"news", href:"/news", label:"NEWS", Icon: Newspaper }` 추가("논문" 다음) |
| `lib/news.ts` | **신규** — `getPublications(teamId)`, `getPublication(teamId,id)` |
| `lib/member-color.ts` 또는 `lib/news.ts` | 저자 문자열에서 팀원 이름 강조용 분할 유틸(`highlightAuthors`) |
| `app/(app)/news/page.tsx` | **신규** — 목록 RSC(+`loading.tsx` 스켈레톤) |
| `app/(app)/news/[id]/page.tsx` | **신규** — 티저 상세 RSC |
| `app/api/news/route.ts` | **신규** — POST 생성 |
| `app/api/news/[id]/route.ts` | **신규** — PATCH/DELETE |
| `app/api/uploads/presign/route.ts` | `kind` enum에 `news` 추가 + 이미지 확장자/`news/` 접두 분기 |
| `components/news/*` | **신규** — `PublicationList`, 카드, 폼(추가/편집), 티저 뷰, `index.ts` |
| `lib/news-image.ts` 또는 기존 이미지 서빙 경로 | 티저 이미지 서명 URL 해석(figure 이미지와 동일 메커니즘 재사용) |

**안 건드림:** 기존 `Paper`/`Analysis`/`Figure`/분석 잡(Inngest)·라이브·스케쥴·팀 관리. NEWS는 독립 추가.

## 보안 / 스코핑

- 모든 라우트 `requireAuth()` + `getActiveTeam` + `teamId` 일치 조회(`findFirst({where:{id, teamId}})`). 다른 팀 자원은 404.
- 쓰기는 `teamId`·`createdBy`를 서버가 세션/활성 팀에서 주입 — 클라 입력 미신뢰(R3/R37).
- 프리사인 객체 키는 서버가 정하고 `news/` 접두만 허용(임의 경로 차단). 티저는 비공개 버킷 + 단기 서명 URL(R36).
- 이미지 확장자 화이트리스트(png/jpg/jpeg/webp)로 업로드 제한.

## 테스트 (TDD — 먼저)

- `lib/__tests__/news.test.ts`: `getPublications`가 활성 팀만·연/월 내림차순(null 월 마지막); `getPublication`이 팀 스코프 밖이면 null(prisma 목).
- `app/api/news/__tests__/news.test.ts`: 미인증/활성 팀 없음 → 403; 생성 시 `teamId`·`createdBy` 서버 주입(클라 위조 무시); `PATCH`/`DELETE`가 다른 팀 자원 → 404; 삭제 시 `removeObject` 호출.
- `app/api/uploads/presign/__tests__`(보강): `kind:"news"` → `news/` 접두·이미지 확장자 허용, 비이미지 415.
- `components/news/__tests__`: 빈 상태 CTA 렌더; 카드가 제목·학회·연/월·저자 표시; 저자 팀원 이름 강조(`highlightAuthors`); 폼 검증(제목·학회 필수, 링크 행 추가/삭제).

## 구현 순서 (각 단계 RED→GREEN)

1. `prisma/schema.prisma` `Publication` 모델 + 마이그레이션(db push/migrate). `prisma generate`.
2. `lib/news.ts`(+강조 유틸) — 테스트 먼저.
3. `app/api/uploads/presign` `news` 분기 — 테스트 먼저.
4. `app/api/news` POST + `[id]` PATCH/DELETE — 테스트 먼저.
5. `components/news/*`(목록·카드·폼·티저 뷰) — 테스트 먼저.
6. `app/(app)/news` 목록·`[id]` 상세 RSC + `loading.tsx` 배선.
7. `components/shell/nav.ts` NEWS 항목 추가.
8. 전체 `tsc`/`vitest`/`lint` 그린.

## 커밋 정책

사용자 지시 시, 위 델타 경로만 명시 스테이징(`git add <경로>`, `-A` 금지 — 작업 무관 변경/동시 실행 위험). conventional commits `feat(news): …`.

## 가정 / 미해결

- `venue`·`year`는 필수, `month`·`teaserImage`·`links`는 선택. 티저 이미지 없으면 카드/상세에 플레이스홀더.
- 한 실적당 티저 이미지 1장. 여러 장 갤러리는 범위 밖.
- 티저 이미지 서빙은 figure 이미지와 동일 경로/메커니즘을 재사용한다(구현 시 figure 서빙 코드를 확인해 맞춘다).
- 저자 강조는 단순 문자열 포함 매칭 — 동명이인/부분일치 오탐은 현 4인 규모에서 무시.
