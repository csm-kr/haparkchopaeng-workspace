# 상태 모델 (State)

> 결정 근거는 [`./ADR.md`](./ADR.md), 불변 규칙은 [`./RULES.md`](./RULES.md), 영속 데이터는 [`../dev/DB.md`](../dev/DB.md)다. 프로토타입 근거: `src/app.jsx`(리프트된 상태), `src/data.js`(서버 모델 대상). 이 문서는 **무엇을 어디에 두는가**를 명확히 한다.

## 두 층위

| 층위 | 무엇 | 어디 |
|---|---|---|
| **앱 레벨 클라이언트 상태** | UI 일관성을 좌우하는 휘발 상태 | 프로토타입: `app.jsx`의 리프트 `useState` / 프로덕션: 앱 레벨 컨텍스트 + 서버 동기화 |
| **서버 영속 상태** | 도메인 데이터 | DB(Prisma) — [`../dev/DB.md`](../dev/DB.md) |

## 앱 레벨 클라이언트 상태 (화면별로 두지 말 것)

| 상태 | 타입 | 좌우하는 표면 |
|---|---|---|
| `live` | boolean | **사이드바 LIVE 배지 · 홈 배너 · meeting 룸 vs 빈 상태** (ADR-001) |
| `screen` + `screenProps` | string + obj | 현재 화면/파라미터(라우터) |
| `theme` | light/dark | `[data-theme]` 토큰 오버라이드 |
| `collapsed` | boolean | 사이드바 접힘 |
| `uploadOpen` | boolean | 업로드 모달 |
| `cmdOpen` | boolean | 명령 팔레트(Cmd/Ctrl+K) |
| `toasts` | list | 일시 확인 |
| `stage` | auth/onboarding/app | 전체 게이팅 |

### `live`가 앱 레벨인 이유 (CRITICAL)
`live`는 세 표면이 절대 어긋나면 안 되므로 화면(`MeetingScreen`)이 아니라 앱 레벨에 둔다. `MeetingScreen`은 `onSetLive`로 위로 올린다. 프로덕션에선 서버 `LiveSession.active`가 진실의 원천이고, 클라이언트는 **SSE(`/api/live/stream`)로 전이를 받아** 동기화한다(폴링 아님, 동시 1개 — ADR-001/014).

```
프로토타입:  MeetingScreen ──onSetLive──> app.jsx(live) ──props──> Sidebar·Dashboard·Meeting
프로덕션:    /api/live/{start|end} ──> LiveSession.active + 이벤트 발행
                                   ──> SSE 푸시 ──> 모든 클라 배지·배너·룸 동시 갱신
```

## 서버 영속 상태 (도메인)

[`../dev/DB.md`](../dev/DB.md)의 모델과 1:1. 요약:

| 도메인 | 핵심 | 비고 |
|---|---|---|
| `papers`(+`analysisStatus`) + `analyses`(research/repro) + `figures` | 두 관점 구조화 + 페이지 출처 figure. `analysisStatus`(pending/ready/failed)로 분석 상태를 UI에 노출 | ADR-004 |
| `sectionNotes` | `{paperId, sectionId, lens, authorId, title, body}` | figure 노트 `lens:any` (ADR-005) |
| `presentations` + `assets` + `versions` + `comments`(반응·@멘션) | 회고 스레드 | ADR-004 |
| `scheduleMonth` + `scheduleWeeks` + 순번 포인터 | 월별 계획 | row 부재 = 빈 달 (ADR-006) |
| `fineConfig` + `memberLedger` | 벌금·장부 | 누적·미납은 파생 |
| `members` + `invites` | 역할·대기 초대 | 초대 전용 (ADR-007) |
| `liveSession` + `participants` | 단일 active | 앱 `live`와 1:1 (ADR-001) |

## 파생 상태 (저장 금지, 계산)

| 값 | 계산 | 위치 |
|---|---|---|
| 앱 `live` | `LiveSession.active` 존재 | 서버→클라 |
| 주차 `current` | 첫 비-`done` 주차 | 클라 |
| 멤버 누적 벌금 | `missedPresenter*finePresenter + missedAbsent*fineAbsent` | 서버 |
| 미납액 | `누적 - paid` (≤0 → 완납) | 서버 |
| 섹션 노트 필터 | `lens === (S==='figures' ? 'any' : currentLens)` | 클라 |

## UI 상태 3종 (모든 데이터 화면)

도메인 데이터를 부르는 화면은 클라이언트에서 **로딩 / 빈 / 에러**를 추가로 가진다(데이터 자체와 별개의 뷰 상태). 빈 상태만 만들고 로딩·에러를 빠뜨리지 않는다 — [`./RULES.md`](./RULES.md) R26, [`../design/DESIGN_GUIDE.md`](../design/DESIGN_GUIDE.md) §UX 패턴.

## 상태 전이 요약 (RULES와 함께 본다)

- **live:** 시작→active(전역), 종료→비active(전역, 확인), 나가기→본인 Participant만. 동시 시작은 409→입장.
- **schedule:** 빈→편집(초안)→저장(영속+순번 전진)→확정; 편집 중 월 잠금. 취소(변경분 시 확인).
- **analysis:** 업로드→`pending`→(성공)`ready`/(실패)`failed`→재시도. `addingSec` 한 번에 하나; 노트 작성자=세션 사용자.
