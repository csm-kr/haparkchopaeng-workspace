# Step 0: docs-news

NEWS 탭(팀 출판 실적 쇼케이스)을 **정본 docs에 명문화**한다. 이 step은 **문서 전용** — 코드는 한 줄도 건드리지 않는다. 이후 step들이 이 문서를 근거로 구현한다.

NEWS는 기존 "논문(Paper)" 기능과 **성격이 다르다**: Paper는 *남의 논문을 업로드해 두 관점(연구·재구현)으로 분석*하는 협업 도구다. NEWS는 *우리 팀이 쓴(발표한) 논문 = 우리 실적*을 모아 보여주는 내부 쇼케이스다.

## 읽어야 할 파일

먼저 아래를 읽고 설계 의도를 파악하라. **정본은 루트 `README.md` · `CLAUDE.md` · `PRD.md`이며, 충돌 시 이를 따른다.**

항상:
- `docs/dev/ARCHITECTURE.md` — 스택·디렉토리 구조
- `docs/agent/ADR.md` — 결정 근거(특히 ADR-016 RLS 미사용 앱레벨 권한, ADR-018/020 멀티팀·팀 스코핑, ADR-003 업로드 PDF 전용, ADR-004 두 관점)
- `docs/dev/CODING_CONVENTION.md` — 코드 규칙

이 step의 근거 설계서(반드시 읽어라):
- `docs/superpowers/specs/2026-06-19-news-tab-design.md` — **이 task 전체의 설계서.** 모델·화면·API·범위가 모두 여기 있다.

문서 형식 참고(수정 대상):
- `docs/agent/ADR.md` — 기존 ADR 작성 형식(`### ADR-NNN: 제목` + 맥락/결정/근거)
- `docs/dev/DB.md` — 스키마 섹션 형식, 특히 **"CRITICAL — 팀 스코핑 운영 반영은 검토된 수동 단계"** 블록
- `docs/dev/API.md` — 엔드포인트 표기 형식
- `docs/design/SCREENS.md` — 화면 명세 형식

## 작업

### 1. `docs/agent/ADR.md` — ADR-022 추가

기존 마지막 ADR(ADR-021) 뒤에 `### ADR-022: NEWS 팀 출판 실적 쇼케이스` 를 추가한다. 다음 결정을 담는다:

- **새 `Publication` 모델을 도입한다.** 기존 `Paper`를 재사용하지 않는다 — `Paper`는 분석 대상(analyses/figures/notes 동반)이고 `schema.prisma`에 "kind 같은 타입 필드 두지 말 것"이 명시돼 의미가 충돌한다.
- **팀 내부 전용.** 외부 공개 라우트·인증 우회·SEO 없음. 기존 앱 셸 안에서 로그인 + 활성 팀 스코프로만 접근.
- **저자는 자유 텍스트 한 줄**(외부 공저자 포함). 렌더 시 `Member.name`과 일치하는 팀원 이름만 강조. Member 연결·멤버별 집계는 하지 않는다(YAGNI).
- **티저 이미지**는 클라→스토리지 프리사인 직접 업로드, 비공개 버킷 + 단기 서명 URL 서빙(R36). figure 이미지와 동일 메커니즘.
- **모든 팀원이 추가·편집·삭제** 가능(논문·발표 자료와 같은 협업 모델).
- **팀 스코핑**(ADR-020): `teamId`로 스코핑, 쓰기 시 서버가 활성 팀에서 주입.
- 제외: 초록/본문 텍스트, 출판 상태 배지, 댓글/반응/버전, PDF 업로드·분석(그건 Paper 소관).

### 2. `docs/dev/DB.md` — Publication 모델 추가

- 스키마 섹션에 `Publication` 모델 시그니처를 추가한다(아래 구조). ERD(개념)에도 한 줄 추가한다.

```prisma
model Publication {
  id          String   @id @default(cuid())
  teamId      String   @default("") // 활성 팀 스코핑(ADR-020/R37)
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

- **CRITICAL로 명시할 것:** `Publication`은 **신규 테이블이라 백필 대상 기존 행이 없다.** 다만 기존 규칙대로 실제 `prisma db push`(공유 운영 DB 반영)는 **harness step이 아니라 사람이 검토 후 수동 실행**한다. harness step은 스키마·코드·테스트까지만 만든다(기존 ADR-020 블록과 동일 정신).

### 3. `docs/dev/API.md` — NEWS 엔드포인트 추가

기존 형식에 맞춰 추가한다:
- `POST /api/news` — 실적 생성(`requireAuth`+활성 팀, `teamId`·`createdBy` 서버 주입).
- `PATCH /api/news/:id` — 수정(팀 스코프, 다른 팀이면 404).
- `DELETE /api/news/:id` — 삭제(팀 스코프) + 티저 객체 best-effort 정리.
- `POST /api/uploads/presign` — `kind:"news"` 추가: `news/` 접두 + 이미지 확장자(png/jpg/jpeg/webp)만 허용.

### 4. `docs/design/SCREENS.md` — NEWS 화면 추가

- **NEWS 목록 `/news`**: 카드 그리드(티저 썸네일 + 제목 + 학회명·연/월 + 저자[팀원 강조]). 연/월 내림차순. 빈 상태("아직 등록된 실적이 없어요" + "첫 실적 추가하기" CTA). Topbar 액션 "실적 추가"(모든 팀원).
- **티저 상세 `/news/:id`**: 큰 티저 이미지 + 제목 + 학회명·연/월 + 저자(강조) + 외부 링크 버튼들 + 편집/삭제(모든 팀원).
- 사이드바 내비에 "NEWS"가 "논문" 다음에 위치함을 한 줄 명시(실제 `nav.ts` 수정은 step 4).

## Acceptance Criteria

```bash
npm run build      # 문서 변경은 빌드에 영향 없음 — 회귀가 없는지만 확인(green 유지)
```

## 검증 절차

1. AC 실행(build green).
2. 체크리스트:
   - ADR-022가 기존 ADR 형식을 따르고 **새 모델·팀 내부 전용·db push 수동** 결정을 담았는가?
   - DB.md에 `Publication` 시그니처 + "db push 수동" CRITICAL이 들어갔는가?
   - API.md/SCREENS.md가 기존 형식과 일관되는가?
   - **코드 파일을 전혀 수정하지 않았는가**(이 step은 문서 전용)?
3. `phases/10-news-tab/index.json`의 step 0 업데이트(`completed`+`summary`). summary에 "ADR-022 + DB/API/SCREENS에 NEWS 명세 추가, 코드 변경 없음, db push는 수동 후속" 명시.

## 금지사항

- **코드(`.ts`/`.tsx`/`.prisma`/`.json` 설정)를 수정하지 마라. 이유: 이 step은 정본 문서만 확정한다 — 구현은 step 1 이후가 한다.**
- **기존 ADR을 개정·삭제하지 마라(추가만).** 이유: 과거 결정은 의도된 기록이다.
- **`docs/superpowers/specs/` 의 설계서를 고치지 마라.** 이유: 이미 승인된 입력이다 — 정본 docs로 옮겨 적기만 한다.
- 기존 테스트를 깨뜨리지 마라.
