# Step 3: data-layer

`docs/dev/DB.md`의 Prisma 스키마를 `prisma/schema.prisma`에 구현하고, 프로토타입 목 데이터를 `prisma/seed.ts`로 이식한 뒤 SQLite에 마이그레이션·시드한다. 이 step은 영속 레이어만 — API·화면·워커 로직은 만들지 않는다.

## 읽어야 할 파일

먼저 아래 문서를 읽고 설계 의도를 파악하라. **정본은 루트 `README.md` · `CLAUDE.md` · `PRD.md`이며, 충돌 시 이를 따른다.**

항상:
- `docs/dev/ARCHITECTURE.md` — 스택·배포(상시 서버 + SQLite 파일)
- `docs/agent/ADR.md` — ADR-006(스케줄 자동생성 금지)·ADR-007(초대전용)·ADR-010(Prisma/SQLite)·ADR-013(Job). **고치지 말 것.**
- `docs/dev/CODING_CONVENTION.md`

이 step(데이터):
- `docs/dev/DB.md` — **스키마의 정본.** 모든 모델·필드·제약(@unique·@@index·onDelete)·CRITICAL 주석을 그대로 구현. `analysisStatus`·`Job`·`ScheduleMonth.version` 포함.
- `docs/dev/ENV.md` — `DATABASE_URL`(개발 `file:./dev.db`), 시드 안내
- `docs/agent/RULES.md` — R15(스케줄 자동생성 금지)·R35(낙관적 락)

이전 step 산출물:
- `prisma/schema.prisma` — datasource/generator만 있는 상태. 여기에 모델 추가.
- `lib/prisma.ts` — PrismaClient 싱글톤(시드·앱이 사용)
- `types/` — 도메인 DTO(스키마와 필드명·유니온 값 일치 유지). 시드 데이터의 형태 참고.

시드 데이터의 **값**은 프로토타입 `src/data.js`(`window.TEAM/PAPERS/PRESENTATIONS/SCHEDULE/SEMINAR_STATS/ANALYSIS/PRES_EXTRA/COMMENTS` 등)에서 가져온다. (`src/`는 빌드 대상이 아니나 시드 값 출처로 읽는다.)

## 작업

### 1. 스키마 — `prisma/schema.prisma`
DB.md의 모델을 **그대로** 구현한다: `Workspace`, `Member`, `Invite`, `Paper`(+`analysisStatus`), `Analysis`(+`@@unique([paperId, lens])`), `Figure`, `SectionNote`, `Presentation`, `PresentationAsset`, `PresentationVersion`, `Comment`, `Reaction`, `ScheduleMonth`(+`version`, `@@unique([year,month])`), `ScheduleWeek`, `FineConfig`, `MemberLedger`, `LiveSession`, `Participant`, `Job`.
- **SQLite 제약 준수:** `enum` 미지원 → 역할·관점·상태는 `String`(허용값은 주석). 배열은 `Json`. `Json` 타입 사용.
- DB.md의 CRITICAL 주석(단일 Workspace·초대 토큰·PDF 전용·두 관점·figure 공통·작성자 표기·스케줄 자동생성 금지·동시 라이브 1개)을 스키마 주석으로 남긴다.

### 2. 시드 — `prisma/seed.ts`
- `lib/prisma.ts`의 클라이언트로 멤버 4인(하수현·박진희·조성민·팽진욱)·`ACCESS` 역할·`PENDING_INVITES`·논문 5건·`ANALYSIS`(p1~p4)·발표 자료 3건+`PRES_EXTRA`·`COMMENTS`/`PRES_COMMENTS`·6월 `SCHEDULE`·`SEMINAR_STATS`(2026 FineConfig+장부)·단일 `Workspace`를 삽입한다.
- 멱등하게: 재실행 시 깨지지 않도록 `upsert` 또는 사전 삭제 후 삽입.
- `package.json`에 `prisma.seed`("tsx prisma/seed.ts" 등) 설정. 필요 시 `tsx`를 devDependency로 추가.

### 3. 로컬 DB 준비
- `DATABASE_URL`이 필요하다. 루트에 로컬 `.env`(gitignore됨)를 만들어 **`DATABASE_URL="file:./dev.db"`만** 넣는다(실제 비밀 키는 넣지 마라). `.env.example`은 그대로 둔다.
- 마이그레이션을 비대화형으로 생성·적용: `npx prisma migrate dev --name init`. 이어서 시드.

## Acceptance Criteria

```bash
npx prisma migrate dev --name init   # 비대화형, dev.db 생성 + 마이그레이션 적용
npx prisma db seed                   # 시드 삽입(멱등)
npm run build                        # 타입/컴파일 에러 없음 (Prisma client 재생성 포함)
npm test                             # vitest run — 기존 테스트 유지 + (가능하면) 시드 카운트/관계 검증
npm run lint
```
- `prisma migrate dev`는 `--name init`로 프롬프트 없이 통과해야 한다(비대화형).

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트:
   - `docs/dev/DB.md`의 모델·제약·CRITICAL이 빠짐없이 반영됐는가? `analysisStatus`·`Job`·`version`이 있는가?
   - SQLite 제약(enum/배열 미지원)을 String/Json으로 처리했는가?
   - **`ScheduleMonth`를 미리 만들지 않았는가**(시드는 6월만, 빈 달은 row 없음 — ADR-006)?
   - 동시 active `LiveSession`을 시드로 만들지 않았는가(기본 라이브 없음 — ADR-001)?
3. 결과에 따라 `phases/0-mvp/index.json`의 step3을 업데이트:
   - 성공 → `"completed"` + `"summary"`
   - 3회 실패 → `"error"` + `"error_message"`
   - 사용자 개입 필요(예: 마이그레이션 수동 확인) → `"blocked"` + `"blocked_reason"` 후 중단

## 금지사항

- **`prisma migrate dev`를 대화형으로 두지 마라**(`--name init` 필수). 이유: 비대화형 실행이 프롬프트에서 멈춘다.
- **API route·화면·워커 구현을 만들지 마라.** 이유: 레이어 분리(API=step4+, 워커=후속).
- **빈 달의 `ScheduleMonth`나 active `LiveSession`을 시드하지 마라.** 이유: 빈 상태가 진짜 표현이다(ADR-006/001).
- **`.env`에 실제 비밀 키(ANTHROPIC_API_KEY 등)를 넣지 마라.** 이유: 커밋 위험·불필요. `DATABASE_URL`만.
- **`.env.example`을 변경하지 마라.**
- **프로토타입 `src/`를 빌드/린트 대상에 넣지 마라.** 시드 값만 읽는다.
- **`test`를 워치 모드로 두지 마라**(`vitest run`).
- 기존 테스트를 깨뜨리지 마라.
