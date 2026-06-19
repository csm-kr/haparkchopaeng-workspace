# Step 3: ui-components

NEWS UI 컴포넌트를 만든다: 목록 카드 그리드(+빈 상태), 추가/편집 폼(티저 이미지 프리사인 업로드 + 링크 행 편집), 티저 상세 뷰, 저자 강조 렌더. **컴포넌트는 데이터를 props로만 받는다** — DB 조회·서명 URL 해석은 step 4의 RSC가 하고 여기엔 넘어온 값만 그린다.

## 읽어야 할 파일

먼저 아래를 읽고 설계 의도를 파악하라. **정본은 루트 `README.md` · `CLAUDE.md` · `PRD.md`이며, 충돌 시 이를 따른다.**

항상:
- `docs/dev/ARCHITECTURE.md` — 디렉토리 구조(컴포넌트 위치)
- `docs/agent/ADR.md` — ADR-022(NEWS) · ADR-015(읽기 RSC·쓰기는 클라 fetch→API)
- `docs/dev/CODING_CONVENTION.md` — 코드 규칙
- `docs/design/DESIGN_GUIDE.md` · `docs/design/SCREENS.md`(NEWS 화면, step 0) — 톤·빈 상태·카드 스타일
- `docs/agent/RULES.md` — **R26/R30**(정직한 빈 상태·실패는 인라인) · **R36**(프리사인 업로드)
- `docs/superpowers/specs/2026-06-19-news-tab-design.md` — 설계서(화면 절)

이전 step 산출물(꼭 읽어라):
- `lib/news.ts` — `PublicationView`·`PublicationLink`·`AuthorSegment`·`splitAuthors`(저자 강조에 사용)
- `app/api/news/route.ts`·`app/api/news/[id]/route.ts`·`app/api/uploads/presign/route.ts` — 폼이 호출할 엔드포인트·요청 형식

수정/참고 대상 코드(꼭 읽어라):
- `components/presentations/presentation-list.tsx` — 카드 그리드 + 빈 상태 패턴(**이걸 본떠 목록을 쓴다**)
- `components/presentations/create-presentation-button.tsx` — **프리사인 업로드 흐름의 정본**: `POST /api/uploads/presign` → 반환 `uploadUrl`에 `PUT`(파일 바이트) → 객체 키를 본 API에 전달. 그대로 따른다(단 `kind:"news"`, 이미지).
- `components/presentations/delete-presentation-button.tsx` — 삭제 버튼 패턴(`endpoint` + 확인)
- `components/presentations/index.ts` — 배럴 export 패턴
- `components/ui` — `Card`·`Button`·`Input`·`Textarea` 등 공용 UI(직접 만들지 말고 재사용)
- `components/shell/__tests__/team-switcher.test.tsx` 또는 `components/presentations/__tests__/*` — `fetch`/`useRouter` 목 RTL 패턴

## 작업

`components/news/` 디렉토리에 아래를 만든다. 인터랙션이 있는 것만 `"use client"`.

### 1. `components/news/publication-list.tsx`
```ts
export interface PublicationCardData {
  id: string;
  title: string;
  authorSegments: AuthorSegment[]; // step 4 RSC가 splitAuthors로 계산해 전달
  venue: string;
  year: number;
  month: number | null;
  teaserUrl: string | null; // 서명 URL(RSC가 해석) 또는 null
}
export function PublicationList({ items }: { items: PublicationCardData[] }): JSX.Element;
```
- 카드 그리드. 각 카드: 티저 썸네일(`teaserUrl` 없으면 플레이스홀더), 제목, 학회명 + 연/월(`month` 있으면 "YYYY.MM", 없으면 "YYYY"), 저자(아래 강조 렌더). 카드 클릭 → `/news/{id}`.
- `items`가 비면 **빈 상태**: "아직 등록된 실적이 없어요" + "첫 실적 추가하기" CTA(R26). 톤은 DESIGN_GUIDE.

### 2. 저자 강조 렌더 (`publication-list` 내부 또는 작은 컴포넌트)
- `authorSegments`를 순회해 `isMember`면 강조(색/굵게 — 토큰은 DESIGN_GUIDE/기존 멤버 색 패턴 `lib/member-color.ts` 참고), 아니면 일반 텍스트. 쉼표로 join.

### 3. `components/news/publication-form.tsx` (`"use client"`)
추가/편집 공용 폼. 편집이면 초기값을 props로 받는다.
```ts
export interface PublicationFormProps {
  initial?: { id: string; title: string; venue: string; authors: string;
              year: number; month: number | null; links: PublicationLink[]; teaserUrl: string | null };
}
```
- 필드: 제목·학회(필수), 저자(자유 텍스트 한 줄), 연도(필수 number)·월(선택 1–12), 링크 행들(라벨+URL, "arXiv/PDF/코드/프로젝트" 프리셋 라벨로 행 추가·삭제), 티저 이미지(파일 선택 + 미리보기).
- 제출:
  1. 티저 파일이 새로 선택됐으면 `POST /api/uploads/presign {filename, kind:"news"}` → `uploadUrl`에 파일 `PUT` → 객체 키 확보(`create-presentation-button.tsx`와 동일).
  2. 생성: `POST /api/news`(객체 키 포함). 편집: `PATCH /api/news/{id}`.
  3. 성공 → `router.push("/news")`(생성) 또는 `/news/{id}`(편집) + `router.refresh()`.
- 검증 실패·요청 실패는 **인라인 메시지**(R30, 토스트 금지). 제출 중 버튼 비활성.

### 4. `components/news/teaser-view.tsx`
티저 상세 본문(상세 RSC가 데이터·서명 URL을 주입).
```ts
export interface TeaserViewProps {
  publication: { id: string; title: string; authorSegments: AuthorSegment[];
                 venue: string; year: number; month: number | null;
                 links: PublicationLink[]; teaserUrl: string | null };
  canEdit: boolean; // 모든 팀원 true (현 정책) — 편집/삭제 노출
}
```
- 큰 티저 이미지(없으면 플레이스홀더) + 제목 + 학회·연/월 + 저자(강조) + 외부 링크 버튼들(새 탭). `canEdit`면 편집(폼)·삭제 액션 노출.

### 5. `components/news/index.ts` — 배럴 export.

### 6. RTL 테스트 `components/news/__tests__/`
- 빈 `items` → 빈 상태 CTA 렌더.
- 카드: 제목·학회·연/월("2025.03" 및 월 없을 때 "2025")·저자 렌더. 팀원 세그먼트가 강조 마크업으로 나오는지.
- 폼: 제목/학회 빈 값 제출 → 인라인 에러(요청 안 감). 링크 행 추가/삭제. (프리사인·`fetch`·`useRouter` 목.)
- 티저 뷰: 링크 버튼·이미지/플레이스홀더·`canEdit` 분기.

## Acceptance Criteria

```bash
npm run build      # 타입/컴파일 에러 없음
npm test           # Vitest + RTL — news 컴포넌트
```

## 검증 절차

1. AC 실행.
2. 체크리스트:
   - 컴포넌트가 **props로만** 데이터를 받는가(DB·서명 URL 직접 호출 없음)?
   - 빈 상태가 정직한 CTA인가(R26)? 실패가 인라인인가(R30)?
   - 티저 업로드가 **프리사인 흐름**(presign→PUT→키 전달)을 따르는가(R36)? `kind:"news"`?
   - 저자 강조가 `splitAuthors` 결과(`AuthorSegment`)를 쓰는가?
   - 공용 `components/ui`를 재사용했는가(중복 위젯 신설 금지)?
3. `phases/10-news-tab/index.json`의 step 3 업데이트(`completed`+`summary`). summary에 "components/news/*(list+빈상태·card·form[presign 업로드·링크 행]·teaser-view·저자강조)·RTL. 데이터는 props, RSC 배선은 step 4" 명시.

## 금지사항

- **컴포넌트 안에서 prisma·서명 URL·세션을 직접 호출하지 마라. 이유: 읽기는 RSC가 한다(ADR-015) — 컴포넌트는 props만 그린다.**
- **새 라우트(`app/(app)/news/...`)·`nav.ts`를 만들지 마라.** 이유: 배선은 step 4.
- **공개 버킷·영구 이미지 URL을 쓰지 마라. 이유: 비공개 버킷 + 서명 URL만(R36).**
- 기존 테스트를 깨뜨리지 마라.
