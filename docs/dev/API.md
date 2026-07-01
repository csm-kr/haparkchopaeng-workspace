# API 설계 (API)

> 데이터 모델은 [`./DB.md`](./DB.md), 호출 순서·외부 연동은 [`./SEQUENCE_DIAGRAM.md`](./SEQUENCE_DIAGRAM.md), 코드 규칙은 [`./CODING_CONVENTION.md`](./CODING_CONVENTION.md)를 본다.

## 원칙

- **CRITICAL: 모든 서버/외부 로직은 Next.js App Router의 route handler(`app/api/**/route.ts`) 또는 Server Action에서만 처리한다.** 클라이언트 컴포넌트에서 DB·LiveKit·파일 스토리지를 직접 호출하지 않는다(CLAUDE.md 규칙).
- **CRITICAL: 활성 팀(쿠키)으로 암묵 스코핑(ADR-020, R37).** 경로에 `teamId`를 노출하지 않는다 — 서버가 세션의 **활성 팀**(쿠키, 반드시 검증된 멤버십)으로 조회를 필터하고 변이의 `teamId`를 주입한다(클라가 보낸 `teamId` 미신뢰, R3). 다른 팀 엔티티 접근은 `403`(R19).
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
| POST | `/api/teams/active` | 활성 팀 전환 `{slug}` → 쿠키 설정 + revalidate | 🔒 |

- **CRITICAL: 활성 팀 전환은 검증된 멤버십만(ADR-020, R37).** `POST /api/teams/active`(또는 동등한 Server Action)는 `slug`가 **내 멤버십**일 때만 쿠키(`active_team`)를 설정한다 — 아니면 `403`. 미설정/무효 쿠키는 가장 최근 합류 팀(`resolveEntryTeam`)으로 폴백. 전환 후 화면을 revalidate한다.

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
| DELETE | `/api/papers/:id` | 논문 삭제(분석·figure·노트·원문 PDF 정리) | ✍️ |

- **CRITICAL: 업로드는 `application/pdf`만 허용.** 그 외 Content-Type → `415`. arXiv URL은 서버가 PDF를 가져온다.
- **CRITICAL: 비용 가드(POST /api/papers).** ① **30쪽 초과 PDF 거부** → `413`(읽을 수 없는 PDF는 `400`). 파일 경로는 초과 시 업로드된 객체를 정리한다. ② **인당 주간 업로드 한도**(이번 주=월요일 00:00 KST 이후, 매주 리셋, 기본 운영 20편 — `PAPER_WEEKLY_LIMIT`로 조정, 0 이하=무제한) 초과 → `429`. 두 경로(파일·arXiv) 모두 적용. (reanalyze는 새 Paper를 만들지 않아 한도에 들지 않는다. 관리자 예외는 추후.)
- **CRITICAL: 업로드 성공과 분석 성공을 분리한다.** `POST /api/papers`는 분석이 실패해도 `Paper`를 저장하고 `analysisStatus: pending|failed`로 응답한다. UI는 논문을 열고 분석 섹션만 재시도 상태로 보인다(→ [`./ENV.md`](./ENV.md), [`../design/SCREENS.md`](../design/SCREENS.md)). 원문 PDF 다운로드는 분석 상태와 무관하게 동작.
- **노트 작성자**는 서버가 세션에서 강제 주입한다. 클라이언트가 보낸 `authorId`는 신뢰하지 않는다.
- `lens`는 `sectionId === "figures"`일 때 서버가 `any`로 강제한다(ADR-005).
- **CRITICAL: 활성 팀 스코핑(ADR-020, R37).** 목록은 활성 팀의 논문만 반환하고, `POST /api/papers`는 활성 팀 `teamId`를 주입한다. `:id` 접근은 그 논문이 활성 팀 소유일 때만 — 아니면 `403`.

### 발표 자료 · 댓글
| 메서드 | 경로 | 설명 | 권한 |
|---|---|---|---|
| GET | `/api/presentations` | 자료 목록(개수) | 🔒 |
| POST | `/api/presentations` | 자료 생성 | 🔒 |
| GET | `/api/presentations/:id` | 자료 + 에셋 + 버전 + 댓글 | 🔒 |
| POST | `/api/presentations/:id/comments` | 댓글 작성 `{body, slide?}` | 🔒 |
| POST | `/api/comments/:id/reactions` | 반응 토글 `{emoji}` | 🔒 |
| DELETE | `/api/comments/:id` | 댓글 삭제 | ✍️ |
| DELETE | `/api/presentations/:id` | 발표 자료 삭제(에셋·버전·댓글 정리) | ✍️ |

- `@멘션`은 본문 파싱으로 추출 → 알림 트리거(→ [`../agent/ISSUES.md`](../agent/ISSUES.md) 알림 채널 미결).
- **CRITICAL: 활성 팀 스코핑(ADR-020, R37).** 목록·`:id`는 활성 팀의 발표 자료만, `POST`는 활성 팀 `teamId` 주입. 다른 팀 자료/댓글 접근은 `403`.

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
- **CRITICAL: 활성 팀 스코핑(ADR-020, R37).** 스케줄·벌금은 활성 팀(`teamId`)으로 조회·저장한다 — `(teamId, year, month)`·`(teamId, year)`가 팀별 독립이므로 같은 달/연도라도 팀마다 별개다. 다른 팀의 월·벌금 접근은 `403`.

### 라이브 세미나 (LiveKit · ADR-019)
| 메서드 | 경로 | 설명 | 권한 |
|---|---|---|---|
| GET | `/api/live` | 현재 세션(없으면 `null`) | 🔒 |
| (구독) | **Supabase Realtime 채널** | live.started/ended·@멘션 — 클라가 직접 구독 | 🔒 |
| POST | `/api/live/start` | 세션 시작 + 발표자 LiveKit 토큰 발급(publish + 화면공유) | 🔒 |
| POST | `/api/live/:id/join` | 참가 등록 + 참가자 LiveKit 토큰 발급(카메라/마이크 publish) | 🔒 |
| POST | `/api/live/:id/leave` | 본인 퇴장 | 🔒 |
| POST | `/api/live/:id/end` | 세션 종료(전체) + LiveKit 룸 정리 | ✍️(발표자/관리자) |

- **`/start` 응답**(발표자): `{ session, token, url }`. 토큰 grant에 화면공유 포함. **토큰은 발표자 본인에게만**.
- **`/join` 응답**(참가자): `{ token, url }`. 카메라/마이크 publish 가능, 화면공유 grant 없음.
- **CRITICAL: 토큰 신원은 세션에서.** identity=`Member.id`, 클라가 보낸 식별자 미신뢰(R3). 토큰을 다른 사람에게 돌려주지 않는다(R7).
- **CRITICAL: 동시 active 세션은 팀당 1개(ADR-020이 ADR-019 "전역 1개" 개정).** `/start`는 **활성 팀**에 이미 active 세션이 있으면 `409`. `getActiveSession(teamId)`로 조회하고 `LiveSession.teamId`를 주입하며 LiveKit 룸 이름에 팀을 포함한다. 팀 전역 `live`와 1:1(ADR-001). 다른 팀 세션 `:id` 접근은 `403`.
- **`/end`만 전역 종료.** `/leave`는 본인 `Participant`만 닫는다(LiveKit 연결 종료는 클라이언트). 종료 시 LiveKit 룸 삭제는 best-effort.
- **채팅·반응·손들기**는 HTTP 엔드포인트가 아니라 **LiveKit 데이터 채널**로 룸 내부 전송한다(휘발·미저장).
- **CRITICAL: 미설정(키 부재) 시 `/start`·`/join`은 `503`**("아직 연결 안 됨", R30). build/test는 키 없이 통과(R2).
- **전이 전파는 Supabase Realtime으로**(R33) — `/start`·`/end` 핸들러가 broadcast하고 클라는 폴링 없이 구독해 배지·배너·룸을 동시 갱신한다(ADR-014→016).

### NEWS (팀 출판 실적 · ADR-022)
| 메서드 | 경로 | 설명 | 권한 |
|---|---|---|---|
| POST | `/api/news` | 실적 생성(`teamId`·`createdBy` 서버 주입) | 🔒 |
| PATCH | `/api/news/:id` | 실적 수정(팀 스코프) | 🔒 |
| DELETE | `/api/news/:id` | 실적 삭제(팀 스코프) + 티저 객체 best-effort 정리 | 🔒 |

- **CRITICAL: 활성 팀 스코핑(ADR-020, R37).** `POST`는 활성 팀 `teamId`·세션 `createdBy`를 주입한다(클라가 보낸 값 미신뢰, R3). `PATCH`/`DELETE`는 활성 팀 소유 실적일 때만 — 다른 팀이면 `404`(존재 숨김, R19).
- **읽기는 RSC 서버 조회(ADR-015).** 목록 `/news`·상세 `/news/:id` 화면은 `lib/news.ts`(`getPublications`/`getPublication`)로 Prisma를 직접 조회하며 활성 팀으로 필터한다 — 별도 GET route handler를 두지 않는다.
- **모든 팀원이 추가·편집·삭제** 가능(역할 게이트 없음 — 논문·발표 자료와 같은 협업 모델, ADR-022).
- **티저 이미지는 프리사인 직접 업로드(R36).** 아래 `kind:"news"` 프리사인으로 객체 키를 받아 스토리지에 직접 올리고 `POST`/`PATCH`에 그 키를 넘긴다. 서빙은 비공개 버킷 + 단기 서명 URL(figure 이미지와 동일 메커니즘).
- **저자는 자유 텍스트.** 서버는 검증만 하고 저장은 원문 그대로 — 팀원 이름 강조는 렌더 시 `Member.name` 매칭으로 처리(별도 저장 없음).

### 업로드 / 스토리지
| 메서드 | 경로 | 설명 | 권한 |
|---|---|---|---|
| POST | `/api/uploads/presign` | 프리사인 업로드 URL 발급(`kind`별: 논문 PDF / NEWS 이미지) | 🔒 |

- **프리사인 직접 업로드:** 큰 PDF는 클라이언트→스토리지로 직접 올리고(서버는 서명만), 완료 후 `POST /api/papers`에 객체 키를 넘긴다. 서버를 통한 대용량 스트리밍을 피한다.
- **CRITICAL: `kind`별 제약.** `kind:"paper"`(기본)는 `application/pdf`만 허용한다. `kind:"news"`는 이미지(png/jpg/jpeg/webp)만 허용하고 객체 키에 **`news/` 접두를 서버가 강제**한다(클라가 임의 경로를 지정하지 못하게). 허용 밖 확장자/타입은 `415`.

### 내부 / 웹훅 (인증은 서명 검증)
| 메서드 | 경로 | 설명 |
|---|---|---|
| — | (현재 없음) | 녹화 웹훅 폐기 — LiveKit 전환(ADR-019). 녹화는 미결(ISSUES) |

## 외부 연동

- **LiveKit(SFU):** 앱은 입장 토큰 발급·권한 체크·룸 정리만 담당하고, 영상·음성·화면공유 트랙 라우팅은 LiveKit에 위임(ADR-019). 토큰 서명 키(`LIVEKIT_API_SECRET`)는 서버 환경변수. 화면공유 grant는 발표자에게만.
- **파일 스토리지:** 원문 PDF·발표 에셋·figure 이미지. 업로드는 **프리사인 직접 업로드**, 다운로드는 **서명 URL**(직접 공개 버킷 금지 → SECURITY).
- **arXiv:** **워커**가 `arxiv.org/pdf/{id}` PDF를 가져와 스토리지에 저장(요청 경로 아님, ADR-013). SSRF 화이트리스트.
- **Gemini(`@google/genai`):** 논문 분석. **Inngest 잡에서만** 호출(분 단위, ADR-013→016 → [`./ENV.md`](./ENV.md)).

## 상태 코드 → UX 매핑

서버 코드는 일관되게, **클라이언트는 따뜻한 한국어로 번역**한다(원문 노출 금지 → [`../design/DESIGN_GUIDE.md`](../design/DESIGN_GUIDE.md) §마이크로카피).

| 코드 | 사용처 | 사용자에게 보이는 카피(예) |
|---|---|---|
| 400 | 검증 실패(zod) | 인라인: "내용을 확인해주세요" |
| 401 | 미인증/세션 만료 | 부드러운 재로그인 유도(작성 내용 보존 시도) |
| 403 | 권한 부족 | "이 작업은 관리자만 할 수 있어요" |
| 409 | 충돌(이미 라이브 중, 편집 중 월 충돌 등) | 라이브: "이미 OOO님이 시작했어요. 입장할까요?" |
| 413 | 30쪽 초과 PDF | "30쪽 이하 PDF만 올릴 수 있어요. (지금 N쪽)" |
| 415 | PDF 외 업로드 | "PDF만 올릴 수 있어요" |
| 429 | 주간 업로드 한도 초과 | "이번 주 분석 한도(20편)를 다 썼어요. 다음 주에 다시 올려주세요." |
| 5xx | 서버/외부 오류 | "잠시 후 다시 시도해주세요" + 다시 시도 |

- 분석 실패는 HTTP 에러가 아니라 `Paper.analysisStatus`로 표현 — 논문은 정상 응답(위 reanalyze 참조).
