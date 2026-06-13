# 시퀀스 다이어그램 (Sequence)

> 엔드포인트는 [`./API.md`](./API.md), 모델은 [`./DB.md`](./DB.md), 화면 전환은 [`../design/SCREEN_FLOW.md`](../design/SCREEN_FLOW.md)를 본다. 이 문서는 주요 동작의 **컴포넌트 간 호출 순서**를 다룬다. 다이어그램은 Mermaid로, 텍스트로도 읽히게 작성한다.

참여자: `Client`(클라이언트 컴포넌트) · `API`(route handler/Server Action) · `DB`(Prisma) · `Storage`(파일) · `CF`(Cloudflare Stream Live).

---

## S1. 논문 업로드 → 분석 생성

참여자에 `W`(백그라운드 워커), `CL`(Claude/Anthropic) 추가.

```mermaid
sequenceDiagram
  participant U as Client
  participant A as API (/api/papers)
  participant S as Storage
  participant D as DB
  participant W as Worker
  participant CL as Claude
  Note over U,S: (사전) 프리사인 업로드: Client → Storage 직접 (서버는 서명만)
  U->>A: POST { objectKey | arXiv URL }
  A->>A: Content-Type/형식 검증 (PDF만, 아니면 415)
  A->>D: Paper 생성(analysisStatus=pending)
  A->>D: Job 적재(type=analyze_paper, {paperId})
  A-->>U: { data: paper, analysisStatus: "pending" }  (201)  ← 즉시
  U->>U: navigate('paper') · 분석 섹션 스켈레톤("읽는 중")
  Note over W: 외부 durable 잡 러너가 Job 실행(멱등·재시도)
  opt arXiv
    W->>S: arxiv PDF fetch → 저장
  end
  W->>CL: PDF document + 구조화 출력 스키마 (스트리밍)
  alt 성공
    CL-->>W: research/repro payload + figure 해석
    W->>D: Analysis/Figure 저장, analysisStatus=ready
  else 실패(refusal/timeout 등)
    W->>D: analysisStatus=failed, Job.lastError
    Note over U: "분석 못 끝냄" + [다시 분석] (POST /reanalyze → Job 재적재)
  end
  U->>A: (Realtime 또는 재조회) ready 전환 수신
```

- ※ **CRITICAL: 분석은 요청 경로가 아니라 워커에서.** Claude 호출은 분 단위 → HTTP 타임아웃을 넘으므로 API는 잡만 적재하고 즉시 응답한다(ADR-013, [`./ARCHITECTURE.md`](./ARCHITECTURE.md)).
- ※ **업로드 성공 ≠ 분석 성공.** 분석이 실패해도 `Paper`·원문 PDF는 살아 있고 분석만 재시도(UX: [`../design/SCREENS.md`](../design/SCREENS.md)).
- ※ 분석 자동화 수준은 미결 → [`../agent/ISSUES.md`](../agent/ISSUES.md). figure 이미지가 없으면 `imageUrl=null` + 수동 업로드 허용.

## S2. 섹션 노트 추가 (작성자 표기·스코프)

```mermaid
sequenceDiagram
  participant U as Client (AnalysisView)
  participant A as API (/api/papers/:id/notes)
  participant D as DB
  U->>U: [+ 이 섹션에 분석 추가] → 인라인 폼
  U->>A: POST {sectionId, lens, title, body}
  A->>A: 세션에서 authorId 주입 (클라 authorId 무시)
  A->>A: sectionId==='figures' 이면 lens='any' 강제
  A->>D: SectionNote 생성
  A-->>U: { data: note }
  U->>U: 해당 섹션 아래 작성자 표기 카드 렌더
```

- ※ CRITICAL: 작성자는 **서버가 세션에서 강제**. 위변조 방지(→ [`../security/SECURITY.md`](../security/SECURITY.md)).

## S3. 라이브 시작 (발표자) — Cloudflare

```mermaid
sequenceDiagram
  participant P as Client (발표자)
  participant A as API (/api/live/start)
  participant D as DB
  participant C as CF (Stream Live)
  P->>A: POST /api/live/start
  A->>D: active LiveSession 존재? (있으면 409)
  A->>C: Live Input 생성
  C-->>A: { liveInputId, rtmps{url,key}, srt, playback{hls} }
  A->>D: LiveSession 생성(active=true, cloudflareLiveInputId)
  A-->>P: { rtmps, srt, playback }  ※ Stream Key는 발표자에게만
  Note over P: OBS 등으로 RTMPS/SRT 송출
  A->>A: Supabase Realtime 채널에 live.started broadcast → 구독자에게 푸시 (S4.5)
```

## S4. 라이브 입장(시청자) vs 나가기 vs 종료

```mermaid
sequenceDiagram
  participant V as Client (시청자)
  participant A as API
  participant D as DB
  participant C as CF
  V->>A: POST /api/live/:id/join
  A->>D: Participant upsert
  A-->>V: { playback{hls} }  ※ 송출 자격증명 없음
  V->>C: HLS 재생

  alt 나가기 (본인만)
    V->>A: POST /api/live/:id/leave
    A->>D: Participant.leftAt 기록 (세션은 active 유지)
  else 종료 (발표자/관리자)
    V->>A: POST /api/live/:id/end
    A->>C: Live Input 정리
    A->>D: LiveSession active=false, endedAt
    A->>A: Supabase Realtime에 live.ended broadcast
    A-->>V: ok
  end
```

## S4.5 라이브 전이 실시간 전파 (Supabase Realtime) — CRITICAL

`live`는 모두에게 즉시 일관돼야 한다(ADR-001). 폴링이 아니라 Realtime 푸시(ADR-014→016).

```mermaid
sequenceDiagram
  participant C1 as 모든 클라이언트
  participant R as Supabase Realtime
  participant A as Vercel route handler (/live/start·end)
  C1->>R: 채널 구독 (live)
  A->>R: live.started | live.ended | mention broadcast
  R-->>C1: 이벤트 푸시
  C1->>C1: 사이드바 LIVE 배지 · 홈 배너 · meeting 룸 동시 갱신
```
- 서버리스/다중 리전에서도 성립(인-프로세스 버스 가정 금지). `LiveSession` 변경을 `postgres_changes`로 구독하는 방식도 가능. @멘션 알림 채널은 미결(ISSUES I-5).

## S4.6 녹화 완료 웹훅 (Cloudflare → 앱)

```mermaid
sequenceDiagram
  participant C as Cloudflare Stream
  participant A as API (/api/webhooks/cloudflare)
  participant D as DB
  C->>A: POST 녹화 완료 (HMAC 서명)
  A->>A: 서명 검증 (세션 인증 아님)
  A->>D: LiveSession.recordingUrl 기록
  Note over A,D: 발표 자료로 아카이브할지 결정 (미결 ISSUES I-3)
```

- ※ `/leave`는 세션을 끝내지 않는다. `/end`만 전역 종료(ADR-001).

## S5. 스케줄 빈 달 → 초안 → 저장(순번 전진)

```mermaid
sequenceDiagram
  participant U as Client (ScheduleScreen)
  participant A as API
  participant D as DB
  U->>A: GET /api/schedule/2026/7
  A->>D: ScheduleMonth(2026,7)?
  D-->>A: 없음
  A-->>U: { data: null }  ※ row 생성 안 함 → 빈 상태 렌더
  U->>A: POST /api/schedule/2026/7/draft
  A->>D: 직전 저장월의 rotationPointerAfter 조회
  A->>A: 7월 토요일 계산 + 순번 배정(draft, confirmed=false)
  A-->>U: { data: draftWeeks } (DB 저장 안 함 = 초안)
  U->>U: 편집(시간/발표자/주제/확정 체크)
  U->>A: PUT /api/schedule/2026/7 {weeks}
  A->>D: ScheduleMonth+Weeks 영속화(saved=true)
  A->>D: rotationPointerAfter = (start + weeks.length) % 4
  A-->>U: { data: savedMonth } → 확정(읽기전용) 렌더
```

- ※ CRITICAL: GET은 절대 월을 만들지 않는다. 초안(POST /draft)도 저장하지 않는다 — PUT만 영속화(ADR-006).

## S6. 발표 자료 회고 댓글 + @멘션

```mermaid
sequenceDiagram
  participant U as Client (PresentationView)
  participant A as API
  participant D as DB
  participant N as 알림(미결)
  U->>A: POST /api/presentations/:id/comments {body, slide?}
  A->>A: 본문에서 @멘션 파싱
  A->>D: Comment 생성
  A-->>U: { data: comment }
  A--)N: 멘션 대상에게 알림 (채널 미결: 인앱/이메일/푸시 → ISSUES)
```

## S7. 멤버 초대 → 합류

```mermaid
sequenceDiagram
  participant Adm as 관리자
  participant A as API
  participant D as DB
  participant New as 신규 멤버
  Adm->>A: POST /api/invites {email, role} (👑)
  A->>D: Invite(status=pending) 생성
  A-->>Adm: 초대 링크(토큰)
  New->>A: POST /api/invites/accept {token}
  A->>A: 토큰 검증 (공개 가입 없음)
  A->>D: Member 생성, Invite.status=accepted
  A-->>New: 세션 발급 → 온보딩
```
