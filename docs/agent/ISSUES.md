# 미결 사항 (Open Issues)

> 확정된 결정은 [`./ADR.md`](./ADR.md), 규칙은 [`./RULES.md`](./RULES.md)다. 이 문서는 **아직 결정되지 않았거나 추적 중인 항목**을 모은다. 원천: PRD §8(팀을 위한 열린 질문) + 맥락설계 과정에서 미룬 결정.

표기: 🔴 차단(구현 전 결정 필요) · 🟡 보강(MVP 중 결정) · 🟢 추후.

## PRD §8 유래

### I-1 🟡 Figure 추출 방식
- **질문:** 자동(PDF 렌더링 + 캡션 파싱) vs figure 슬롯 수동 업로드? 설명(해석)은 누가 작성?
- **현재 방향:** 1차는 LLM 보조 추출 + 수동 업로드 폴백(`imageUrl=null` 허용). 자동 렌더링 파이프라인은 추후. 설명은 LLM 초안 → 사람 검수(ADR-011).
- **영향:** [`../dev/DB.md`](../dev/DB.md) `Figure`, [`../dev/ENV.md`](../dev/ENV.md) 분석 파이프라인.

### I-2 ✅ 라이브 방송 모델 (해결 — ADR-019)
- **질문:** 발표자 1인 송출(OBS RTMPS/SRT) vs 상호 비디오 그리드?
- **결정:** **다자간 실시간 화상 컨퍼런스로 확정**(LiveKit SFU, ADR-019). 1인 송출(Cloudflare Stream Live, ADR-002)은 폐기. 모두 같은 룸에 접속(카메라 선택), 발표자만 화면공유 grant.
- **영향:** meeting 화면 UI, [`../dev/SEQUENCE_DIAGRAM.md`](../dev/SEQUENCE_DIAGRAM.md) S3/S4.

### I-3 🟢 녹화 보존 / 아카이브
- **질문:** 녹화본 보존 기간? 종료 시 녹화본을 발표 자료로 자동 아카이브?
- **현재 방향:** 미정·추후. ADR-019(LiveKit 전환)로 기존 Cloudflare 녹화 웹훅은 폐기 — 필요 시 LiveKit Egress로(범위 밖). `LiveSession.recordingUrl`은 미사용 레거시 컬럼.

### I-4 🟡 벌금 = 정보 vs 결제 연동
- **질문:** 장부는 정보 제공용인가, 실제 결제 추적과 연동?
- **현재 방향:** 정보용 장부(가벼운 사회적 장치). 결제 연동 없음 — 필요 시 추후.

### I-5 🔴 알림 채널
- **질문:** 인앱 전용인가, 라이브 시작·@멘션에 이메일/푸시?
- **차단 이유:** API의 댓글/멘션·라이브 시작 알림 트리거 설계에 영향(→ [`../dev/API.md`](../dev/API.md), S6). MVP 범위에서 인앱 only로 시작할지 결정 필요.

### I-6 ✅ 인증 = 초대 전용 + Google OAuth
- 확정: 공개 가입 없음, 초대 링크 전용(ADR-007). **인증 수단 = Google OAuth (Supabase Auth)**, 초대 게이트(ADR-017). 인증 수단 미결 해소.
- 🔁 **개정(ADR-018)**: 멀티팀 전환 — 로그인은 누구나(처음엔 팀 없음), 합류는 **팀 생성** 또는 **초대 토큰** 수락. 로그인 시점 이메일 매칭 게이트는 폐기, 게이트는 팀 합류 시점으로 이동.

### I-19 ✅ 분석 워커 런타임 = 외부 durable 잡 러너
- 확정: 분 단위 분석은 **외부 durable 잡 러너**(ADR-016). 제품 선택은 I-15에서. Edge Function(시간 제한)·인-프로세스는 폐기.

### I-20 🟢 Supabase DB 이전 시점 + RLS
- **질문:** SQLite→Supabase Postgres 이전 시점? Prisma 권한 체크를 유지하므로 RLS는 끄는데(ADR-016), 추후 RLS 병행 여부?
- **현재 방향:** 로컬 SQLite 유지, 운영 Postgres. RLS 미사용(서버 권한 체크로 일원화).

## 맥락설계 과정 유래

### I-7 🟡 게스트 권한 경계
- **질문:** 게스트는 업로드·라이브 시작·노트 작성 중 어디까지 허용?
- **현재 방향:** 읽기 위주 + 제한적(△). 정확한 매트릭스는 [`../security/SECURITY.md`](../security/SECURITY.md) 인가 표에서 확정 필요.

### I-8 🟢 SQLite → Postgres 이전 시점
- 4인 사용엔 SQLite로 충분. 동시성·운영 필요 시 Postgres 이전(ADR-010). 트리거 조건 미정.

### I-9 🟡 분석 비용·재시도 정책
- **질문:** 논문당 분석 토큰 비용 상한? 실패 시 자동 재시도 횟수?
- **현재 방향:** 업로드는 분석 실패와 분리(Paper 저장 후 분석 재시도 가능). 구체 수치 미정([`../dev/ENV.md`](../dev/ENV.md)).

### I-10 🟢 arXiv fetch SSRF 방지
- 서버가 arXiv PDF를 가져올 때 허용 도메인 화이트리스트 필요([`../security/SECURITY.md`](../security/SECURITY.md)). 구현 시 확정.

## UX 유래

### I-11 🟡 확인 vs 되돌리기 기본값
- **질문:** 파괴적 액션을 사전 확인 다이얼로그로 갈지, 실행 후 되돌리기(undo)로 갈지의 기본 정책?
- **현재 방향:** 비가역·고위험(내보내기·라이브 종료)은 확인, 가역(초대 취소·노트 삭제)은 되돌리기 토스트. 경계 사례는 화면별 확정([`../design/SCREENS.md`](../design/SCREENS.md)).

### I-12 🟡 모바일 지원 범위
- **질문:** 모바일은 "확인·입장·댓글"만 보장인가, 풀 편집(스케줄 편성·분석 작성)까지인가?
- **현재 방향:** 데스크톱 우선 + 모바일 핵심 동선만 보장. 풀 편집 모바일 대응은 추후([`../design/DESIGN_GUIDE.md`](../design/DESIGN_GUIDE.md) §반응형).

### I-13 🟢 오프라인/재연결 정책 깊이
- **질문:** 라이브 끊김 자동 재연결 횟수·타임아웃? 작성 중 노트/댓글의 오프라인 보존?
- **현재 방향:** 라이브는 자동 재연결 + 재입장 CTA. 작성 중 텍스트 로컬 보존 권장, 세부 미정.

### I-14 🟢 분석 진행 표시 정밀도
- **질문:** "읽는 중…" 단일 상태 vs 단계별(섹션/figure) 진행 표시?
- **현재 방향:** 1차는 단일 단계. 비용·시간이 길면 단계 표시 검토([`../dev/ENV.md`](../dev/ENV.md) I-9와 연동).

## 아키텍처 유래

### I-15 ✅ 잡 러너 = Inngest
- 확정: 분석·arXiv·녹화 후처리는 **Inngest**로 실행(ADR-016). Next.js/Vercel 친화·재시도·관찰성. `Job` 테이블은 상태 미러. 키: `INNGEST_EVENT_KEY`·`INNGEST_SIGNING_KEY`(jobs-analysis step에서 사용).

### I-16 ✅ 실시간 전송 = Supabase Realtime
- 확정: 인-프로세스 SSE 버스 폐기 → **Supabase Realtime**(broadcast/`postgres_changes`)(ADR-014→016). WebSocket 양방향이 필요한 기능(라이브 채팅)이 생기면 Realtime presence/broadcast로 확장.

### I-17 ✅ 배포 호스트 = Vercel + Supabase
- 확정: **Vercel(앱) + Supabase(DB/Auth/Storage/Realtime)**(ADR-016). SQLite 영속 볼륨 고민 소멸(관리형 Postgres). 백업은 Supabase 자동 백업.

### I-18 🟢 캐시 무효화 전략
- **질문:** 변이 후 `revalidatePath`/`revalidateTag` 범위? Realtime 푸시와 RSC 캐시의 정합?
- **현재 방향:** 변이 핸들러에서 관련 경로/태그 무효화(ADR-015). Realtime 이벤트 수신 시 클라가 router.refresh()로 재검증. 세부 매핑은 구현 시.

## 처리 규칙

- 🔴는 해당 기능 구현 **전에** 결정한다. harness step 설계 시 blocked 처리 대상.
- 결정되면 ADR로 승격하고 여기서 ✅로 표기 후 다음 정리 때 제거.
