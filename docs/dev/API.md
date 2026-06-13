# API 설계 (API)

> 데이터 모델은 [`./DB.md`](./DB.md), 호출 순서·외부 연동은 [`./SEQUENCE_DIAGRAM.md`](./SEQUENCE_DIAGRAM.md), 코드 규칙은 [`./CODING_CONVENTION.md`](./CODING_CONVENTION.md)를 본다.

## 원칙

- **CRITICAL: 모든 서버/외부 로직은 Next.js App Router의 route handler(`app/api/**/route.ts`) 또는 Server Action에서만 처리한다.** 클라이언트 컴포넌트에서 DB·Cloudflare·파일 스토리지를 직접 호출하지 않는다(CLAUDE.md 규칙).
- **단일 테넌트:** 워크스페이스 ID를 경로에 노출하지 않는다. 모든 요청은 암묵적으로 그 하나의 워크스페이스에 속한다.
- **인증 필수:** 모든 엔드포인트는 세션(초대 기반 로그인)을 요구한다. 미인증 → `401`. 권한 부족 → `403`. 자세한 권한 표는 [`../security/SECURITY.md`](../security/SECURITY.md).
- **응답 포맷:** `{ data }` 또는 `{ error: { code, message } }`. 목록은 `{ data: [...] }`.

## 엔드포인트 표

표기: 🔒=인증 필요(전부), 👑=관리자 전용, ✍️=작성자/관리자.

### 인증 · 멤버
| 메서드 | 경로 | 설명 | 권한 |
|---|---|---|---|
| POST | `/api/auth/login` | 세션 발급 | — |
| POST | `/api/auth/logout` | 세션 종료 | 🔒 |
| GET | `/api/me` | 현재 사용자 | 🔒 |
| PATCH | `/api/me` | 프로필·알림·테마 수정 | 🔒 |
| GET | `/api/members` | 멤버 목록 | 🔒 |

### 팀 · 초대
| 메서드 | 경로 | 설명 | 권한 |
|---|---|---|---|
| POST | `/api/invites` | 초대 생성(이메일+역할) | 👑 |
| GET | `/api/invites` | 대기 중인 초대 목록 | 👑 |
| POST | `/api/invites/:id/resend` | 재전송 | 👑 |
| DELETE | `/api/invites/:id` | 취소 | 👑 |
| POST | `/api/invites/accept` | 토큰으로 합류 | — (토큰 검증) |
| PATCH | `/api/members/:id/role` | 역할 변경 | 👑 |
| DELETE | `/api/members/:id` | 내보내기 | 👑 |

### 논문 · 분석
| 메서드 | 경로 | 설명 | 권한 |
|---|---|---|---|
| GET | `/api/papers` | 논문 목록(필터 "전체"만) | 🔒 |
| POST | `/api/papers` | PDF 업로드 또는 arXiv URL로 생성 | 🔒 |
| GET | `/api/papers/:id` | 논문 + 분석 + figure | 🔒 |
| GET | `/api/papers/:id/pdf` | 원문 PDF 다운로드(서명 URL) | 🔒 |
| GET | `/api/papers/:id/analysis?lens=research\|repro` | 관점별 분석 | 🔒 |
| GET | `/api/papers/:id/notes` | 섹션 노트 목록 | 🔒 |
| POST | `/api/papers/:id/notes` | 섹션 노트 추가 `{sectionId, lens, title, body}` | 🔒 |
| DELETE | `/api/notes/:id` | 노트 삭제 | ✍️ |
| POST | `/api/papers/:id/reanalyze` | 분석 재시도(실패/대기 시) | 🔒 |

- **CRITICAL: 업로드는 `application/pdf`만 허용.** 그 외 Content-Type → `415`. arXiv URL은 서버가 PDF를 가져온다.
- **CRITICAL: 업로드 성공과 분석 성공을 분리한다.** `POST /api/papers`는 분석이 실패해도 `Paper`를 저장하고 `analysisStatus: pending|failed`로 응답한다. UI는 논문을 열고 분석 섹션만 재시도 상태로 보인다(→ [`./ENV.md`](./ENV.md), [`../design/SCREENS.md`](../design/SCREENS.md)). 원문 PDF 다운로드는 분석 상태와 무관하게 동작.
- **노트 작성자**는 서버가 세션에서 강제 주입한다. 클라이언트가 보낸 `authorId`는 신뢰하지 않는다.
- `lens`는 `sectionId === "figures"`일 때 서버가 `any`로 강제한다(ADR-005).

### 발표 자료 · 댓글
| 메서드 | 경로 | 설명 | 권한 |
|---|---|---|---|
| GET | `/api/presentations` | 자료 목록(개수) | 🔒 |
| POST | `/api/presentations` | 자료 생성 | 🔒 |
| GET | `/api/presentations/:id` | 자료 + 에셋 + 버전 + 댓글 | 🔒 |
| POST | `/api/presentations/:id/comments` | 댓글 작성 `{body, slide?}` | 🔒 |
| POST | `/api/comments/:id/reactions` | 반응 토글 `{emoji}` | 🔒 |
| DELETE | `/api/comments/:id` | 댓글 삭제 | ✍️ |

- `@멘션`은 본문 파싱으로 추출 → 알림 트리거(→ [`../agent/ISSUES.md`](../agent/ISSUES.md) 알림 채널 미결).

### 스케줄 · 책임
| 메서드 | 경로 | 설명 | 권한 |
|---|---|---|---|
| GET | `/api/schedule/:year/:month` | 해당 월(없으면 `null` = 빈 달) + `version` | 🔒 |
| POST | `/api/schedule/:year/:month/draft` | 초안 생성(서버가 토요일·순번 계산) | 🔒 |
| PUT | `/api/schedule/:year/:month` | 저장(영속화 + 순번 포인터 전진) — `If-Match: <version>` | 🔒 |
| GET | `/api/fines/:year` | 벌금 설정 + 멤버 장부 | 🔒 |
| PUT | `/api/fines/:year` | 벌금 금액 수정 | 👑 |

- **CRITICAL: GET이 월을 자동 생성하지 않는다.** 없으면 `data: null`을 반환할 뿐, row를 만들지 않는다(ADR-006).
- **순번 포인터 전진은 PUT(저장) 시 서버에서 원자적으로** 처리한다. 클라이언트가 포인터를 보내지 않는다.
- **CRITICAL: 동시 편집 충돌은 낙관적 락으로.** PUT은 `If-Match`로 보낸 `version`이 현재와 다르면 `409` "다른 사람이 먼저 저장했어요"(→ [`./DB.md`](./DB.md) `ScheduleMonth.version`).
- 누적 벌금·미납은 서버에서 파생 계산해 응답에 포함(저장 안 함).

### 라이브 세미나 (Cloudflare Stream Live)
| 메서드 | 경로 | 설명 | 권한 |
|---|---|---|---|
| GET | `/api/live` | 현재 세션(없으면 `null`) | 🔒 |
| (구독) | **Supabase Realtime 채널** | live.started/ended·@멘션 — 클라가 직접 구독 | 🔒 |
| POST | `/api/live/start` | Cloudflare Live Input 생성 → 세션 시작 | 🔒 |
| POST | `/api/live/:id/join` | 참가 등록 + 시청용 HLS/재생 정보 | 🔒 |
| POST | `/api/live/:id/leave` | 본인 퇴장 | 🔒 |
| POST | `/api/live/:id/end` | 세션 종료(전체) + 녹화 처리 | ✍️(발표자/관리자) |

- **`/start` 응답**(발표자 전용): `{ rtmps: {url, streamKey}, srt: {...}, playback: {hls} }`. **Stream Key는 발표자 본인에게만** 노출(→ SECURITY).
- **`/join` 응답**(시청자): 재생용 `{ playback: { hls } }`만. 송출 자격증명 절대 미포함.
- **CRITICAL: 동시 active 세션 1개.** `/start`는 이미 active 세션이 있으면 `409`. 앱 전역 `live`와 1:1(ADR-001).
- **`/end`만 전역 종료.** `/leave`는 본인 `Participant`만 닫는다.
- **CRITICAL: 전이 전파는 Supabase Realtime으로.** `/start`·`/end` 핸들러가 Realtime 채널에 broadcast(또는 `LiveSession` 변경→`postgres_changes`)하고, 클라이언트는 폴링 없이 그 채널을 구독해 배지·배너·룸을 동시 갱신한다(ADR-014→016).

### 업로드 / 스토리지
| 메서드 | 경로 | 설명 | 권한 |
|---|---|---|---|
| POST | `/api/uploads/presign` | 프리사인 업로드 URL 발급(PDF만) | 🔒 |

- **프리사인 직접 업로드:** 큰 PDF는 클라이언트→스토리지로 직접 올리고(서버는 서명만), 완료 후 `POST /api/papers`에 객체 키를 넘긴다. 서버를 통한 대용량 스트리밍을 피한다.

### 내부 / 웹훅 (인증은 서명 검증)
| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | `/api/webhooks/cloudflare` | 녹화 완료 등 Stream Live 이벤트 수신(HMAC 검증) |

- 녹화 완료 시 발표 자료 아카이브 여부 결정(미결 → [`../agent/ISSUES.md`](../agent/ISSUES.md) I-3). 세션 인증이 아니라 **서명 검증**으로 보호.

## 외부 연동

- **Cloudflare Stream Live:** Live Input 생성/조회/삭제, 녹화 조회. 앱은 방송 생성·권한 체크·플레이어 노출만 담당(인코딩/HLS/CDN은 위임, ADR-002). 자격증명은 서버 환경변수. **녹화 완료는 웹훅**으로 수신.
- **파일 스토리지:** 원문 PDF·발표 에셋·figure 이미지. 업로드는 **프리사인 직접 업로드**, 다운로드는 **서명 URL**(직접 공개 버킷 금지 → SECURITY).
- **arXiv:** **워커**가 `arxiv.org/pdf/{id}` PDF를 가져와 스토리지에 저장(요청 경로 아님, ADR-013). SSRF 화이트리스트.
- **Anthropic:** 논문 분석. **워커에서만** 호출(분 단위, ADR-013 → [`./ENV.md`](./ENV.md)).

## 상태 코드 → UX 매핑

서버 코드는 일관되게, **클라이언트는 따뜻한 한국어로 번역**한다(원문 노출 금지 → [`../design/DESIGN_GUIDE.md`](../design/DESIGN_GUIDE.md) §마이크로카피).

| 코드 | 사용처 | 사용자에게 보이는 카피(예) |
|---|---|---|
| 400 | 검증 실패(zod) | 인라인: "내용을 확인해주세요" |
| 401 | 미인증/세션 만료 | 부드러운 재로그인 유도(작성 내용 보존 시도) |
| 403 | 권한 부족 | "이 작업은 관리자만 할 수 있어요" |
| 409 | 충돌(이미 라이브 중, 편집 중 월 충돌 등) | 라이브: "이미 OOO님이 시작했어요. 입장할까요?" |
| 415 | PDF 외 업로드 | "PDF만 올릴 수 있어요" |
| 5xx | 서버/외부 오류 | "잠시 후 다시 시도해주세요" + 다시 시도 |

- 분석 실패는 HTTP 에러가 아니라 `Paper.analysisStatus`로 표현 — 논문은 정상 응답(위 reanalyze 참조).
