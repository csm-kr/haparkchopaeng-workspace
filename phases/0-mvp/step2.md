# Step 2: domain-types

도메인 모델의 **공유 TypeScript 타입**을 `types/`에 정의한다. 유한 집합은 유니온 리터럴로, 엔티티는 DTO 인터페이스로. DB 스키마·API 계약과 정합하되, 이 step은 타입만 — Prisma 스키마·API·화면은 만들지 않는다.

## 읽어야 할 파일

먼저 아래 문서를 읽고 설계 의도를 파악하라. **정본은 루트 `README.md` · `CLAUDE.md` · `PRD.md`이며, 충돌 시 이를 따른다.**

항상:
- `docs/dev/ARCHITECTURE.md` — 스택·디렉토리(`types/`)
- `docs/agent/ADR.md` — 결정 근거(ADR-004 두 관점·ADR-005 노트 스코프·ADR-013 잡). **고치지 말 것.**
- `docs/dev/CODING_CONVENTION.md` — §타입 규칙(유니온 리터럴 `Lens`/`Role`/`WeekStatus`, `any` 금지, API 경계 DTO 분리)

이 step(데이터):
- `docs/dev/DB.md` — 모델 필드·파생값(이 타입들의 출처). `analysisStatus`·`Job`·`ScheduleMonth.version` 포함.
- `docs/agent/STATE.md` — 도메인 상태 목록·파생값

이전 step 산출물:
- `lib/prisma.ts`, `prisma/schema.prisma` — Prisma 생성 타입은 별개다. 여기 정의하는 건 **API 경계 DTO**(직렬화·클라이언트 공유용).

## 작업

`types/` 아래에 모듈을 만든다(예: `types/domain.ts` 또는 도메인별 파일 + `types/index.ts` 배럴). **모든 타입은 export.**

### 1. 유니온 리터럴 (유한 집합)
```ts
export type Lens = 'research' | 'repro';
export type NoteLens = Lens | 'any';              // figure 노트는 'any' (ADR-005)
export type Role = '관리자' | '멤버' | '게스트';   // (ADR-007)
export type Presence = 'online' | 'away' | 'busy' | 'offline';
export type Availability = 'active' | 'vacation';
export type WeekStatus = 'done' | 'upcoming';      // 'current'는 파생(저장 안 함)
export type AnalysisStatus = 'pending' | 'ready' | 'failed';
export type JobType = 'analyze_paper' | 'fetch_arxiv' | 'process_recording';
export type JobStatus = 'queued' | 'running' | 'done' | 'failed';
export type InviteStatus = 'pending' | 'accepted' | 'revoked';
```

### 2. 엔티티 DTO (DB.md 모델 대응)
DB.md의 각 모델에 대응하는 인터페이스를 정의한다(시그니처 수준, 필드명·옵셔널은 DB.md를 따른다): `Member`, `Invite`, `Paper`(+`analysisStatus`), `Analysis`(`lens`+`payload`), `Figure`, `SectionNote`, `Presentation`, `PresentationAsset`, `PresentationVersion`, `Comment`(+`reactions`), `Reaction`, `ScheduleMonth`(+`version`), `ScheduleWeek`, `FineConfig`, `MemberLedger`, `LiveSession`, `Participant`, `Job`.
- `payload`(Analysis)의 구조는 DB.md의 연구(problem/contributions/io/comparison/ablation)·재구현(data/model/loss/metrics/training/gpu) 필드를 반영하는 타입으로 정의한다(`src/data.js`의 `window.ANALYSIS` 형태 참고 — 값이 아니라 **모양**만).
- 파생값(누적 벌금·미납·`current` 주차·앱 `live`)은 **저장 필드로 넣지 말 것**. 필요하면 별도 계산 결과 타입으로.

### 3. 공유 보조 타입
- API 응답 봉투: `type ApiOk<T> = { data: T }`, `type ApiErr = { error: { code: string; message: string } }`(API.md 응답 포맷).

## Acceptance Criteria

```bash
npm run build   # tsc/next build — 타입 에러 없음 (strict)
npm test        # vitest run — 타입 수준 검증(예: 유니온 값 할당 테스트 또는 expectTypeOf) 통과
npm run lint    # ESLint 에러 없음
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트:
   - `docs/dev/DB.md` 모델과 필드가 일치하는가? `analysisStatus`·`Job`·`version`이 반영됐는가?
   - 유한 집합이 유니온 리터럴인가? `any`를 쓰지 않았는가?(CODING_CONVENTION)
   - 파생값을 저장 필드로 넣지 않았는가?
3. 결과에 따라 `phases/0-mvp/index.json`의 step2를 업데이트:
   - 성공 → `"completed"` + `"summary"`
   - 3회 실패 → `"error"` + `"error_message"`
   - 사용자 개입 필요 → `"blocked"` + `"blocked_reason"` 후 중단

## 금지사항

- **Prisma 스키마에 모델을 추가하거나 마이그레이션하지 마라.** 이유: 그건 step3(data-layer). 이 step은 공유 타입만.
- **API route·화면·로직을 만들지 마라.** 이유: 레이어 분리.
- **`any`를 쓰지 마라.** 이유: strict 위반. 불가피하면 `unknown` + 좁히기.
- **파생값(누적 벌금·미납·current·live)을 엔티티 저장 필드로 정의하지 마라.** 이유: 계산값이다(DB.md).
- **프로토타입 `src/`를 빌드/린트 대상에 넣지 마라.** 모양만 참고.
- **`test`를 워치 모드로 두지 마라**(`vitest run`).
- 기존 테스트를 깨뜨리지 마라.
