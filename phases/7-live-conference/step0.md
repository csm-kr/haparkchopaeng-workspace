# Step 0: docs-adr-019

라이브를 **Cloudflare Stream 단방향 방송 → LiveKit 다자간 화상**으로 전환하는 결정을 문서에 먼저 박는다. 이 step은 **문서만 수정**한다(코드 변경 없음). 이후 step들은 execute.py가 이 문서를 가드레일로 주입해 읽는다.

## 읽어야 할 파일

먼저 아래 문서를 읽고 아키텍처와 설계 의도를 파악하라. **정본은 루트 `README.md` · `CLAUDE.md` · `PRD.md`이며, 충돌 시 이를 따른다.**

항상:
- `docs/dev/ARCHITECTURE.md` — 스택·디렉토리 구조
- `docs/agent/ADR.md` — 결정 근거 (의도된 결정이다. 코드를 보고 "고치지" 말 것)
- `docs/dev/CODING_CONVENTION.md` — 코드 규칙

이 step에서 수정할 문서:
- `docs/agent/ADR.md` (ADR-019 추가)
- `docs/agent/RULES.md` (R7·R8 개정)
- `docs/dev/API.md` (라이브 세미나 섹션·웹훅·외부 연동)
- `docs/dev/ARCHITECTURE.md` (프로덕션 스택 표·교체표·토폴로지·외부 경계)
- `docs/agent/STATE.md` (live 전이 주석)
- `docs/dev/ENV.md` (LiveKit 변수)
- `.env.example` (LiveKit 키)

## 작업

### 1. `docs/agent/ADR.md` — 맨 끝에 ADR-019 추가 (append)

ADR-018 블록 다음(파일 끝)에 아래를 그대로 추가한다:

```markdown

### ADR-019: 라이브는 LiveKit 다자간 화상 컨퍼런스 (ADR-002 대체)

> **이 ADR은 ADR-002(라이브 비디오 = Cloudflare Stream Live, 1인 송출 + 다수 HLS 시청)를 대체한다.** ADR-001(`live` 앱 레벨·단일 세션)·R6(동시 1개)·R33(전이는 Supabase Realtime)·ADR-015(읽기 RSC·쓰기 라우트)·R2(키는 서버·키 없이 build/test 통과)는 그대로 유지한다.

**결정**: 세미나 라이브를 **1인 송출 단방향 방송에서 다자간 실시간 화상 컨퍼런스로 전환**한다. 영상·음성·화면공유 트랙은 **LiveKit(SFU)**가 나른다(Cloudflare Stream Live 폐기). 참가자는 모두 같은 LiveKit 룸에 접속하며(카메라는 선택 — 끄면 아바타 타일), 발표자는 화면공유 권한을 추가로 가진다.

- **영상/음성/화면공유**: LiveKit. 룸 이름은 `LiveSession.id`에서 파생(`live-{id}`). 참가자 신원(identity) = `Member.id`(아바타·이름 매핑용).
- **입장 토큰**: 서버가 참가자별 LiveKit AccessToken을 발급한다(`/start`는 발표자, `/join`은 시청자). **화면공유 grant(`canPublishSources`의 screen_share)는 발표자 토큰에만** 넣는다(R7 개정). 토큰은 본인에게만 응답하고, 신원은 세션에서 주입한다 — 클라가 보낸 식별자 미신뢰(R3).
- **채팅·반응·손들기**: 별도 서버/인프라 없이 **LiveKit 데이터 채널**로 룸 내부에서 주고받는다(휘발·미저장 — 4인 세미나에 충분). 메시지 작성자는 LiveKit 참가자 identity로 판별하고, 페이로드의 author는 신뢰하지 않는다.
- **송출 타이머**: 서버 `LiveSession.startedAt` 기준으로 클라이언트가 경과 시간을 표시한다.
- **앱 전역 `live` 전이**(사이드바 LIVE 배지·홈 배너): 변경 없이 **Supabase Realtime**(`live.started`/`live.ended`)을 유지한다(R33). 룸 내부 presence는 LiveKit, 앱 전역 on/off는 Supabase — 역할이 다르다.

**이유**: PRD가 가정한 "1인 송출 + 다수 시청"(ADR-002)은 실제 기대("서로 얼굴 보이는 화상 세미나")와 어긋났다. 4인 그룹엔 SFU 한 대로 충분하고, 영상 인프라는 여전히 빌린다(R8 정신 유지 — 위탁 대상만 Cloudflare→LiveKit). 채팅 등은 룸에 이미 붙은 데이터 채널로 처리해 이중 presence/시그널링을 피한다.

**트레이드오프**:
- 외부 벤더가 Cloudflare Stream → LiveKit으로 교체된다(비용·약관). 새 키 `LIVEKIT_URL`/`LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET`이 필요 — 키가 없으면 `/start`·`/join`이 `503`으로 친절히 안내(R30)하고, build/test는 키 없이 통과한다(R2).
- 단방향 HLS의 "녹화 자동" 이점을 잃는다 — 녹화는 LiveKit Egress로 가능하나 **이번 범위 밖**(미결 → ISSUES). 기존 `recordingUrl`·Cloudflare 웹훅 경로는 폐기한다.
- `LiveSession.cloudflareLiveInputId` 컬럼은 미사용으로 남긴다(무해한 레거시, 후속 마이그레이션에서 제거) — 이번 phase는 스키마 변경·`prisma db push` 없음.
- 라이브는 **여전히 단일 전역 세션**이며 팀 스코핑하지 않는다(ADR-018 범위 유지 — 팀 분리는 다음 phase).
```

### 2. `docs/agent/RULES.md` — R7·R8 개정

R7 줄을 교체:
- old: `- **R7. Stream Key는 발표자에게만.** 시청자 응답엔 재생 HLS만. ([`../security/SECURITY.md`](../security/SECURITY.md))`
- new: `- **R7. LiveKit 토큰은 참가자별 서버 발급 · 본인에게만.** 모든 참가자는 자기 카메라/마이크를 publish할 수 있으나 **화면공유 grant는 발표자 토큰에만** 넣는다. 신원(identity)은 세션에서 주입(R3) — 클라가 보낸 식별자 미신뢰. (ADR-019, [`../security/SECURITY.md`](../security/SECURITY.md))`

R8 줄을 교체:
- old: `- **R8. 영상 인프라를 직접 만들지 마라.** Cloudflare Stream Live에 위임. (ADR-002)`
- new: `- **R8. 영상 인프라를 직접 만들지 마라.** 다자간 화상은 **LiveKit(SFU)**에 위임. (ADR-019, ADR-002 대체)`

### 3. `docs/dev/API.md` — 라이브 섹션 교체

`### 라이브 세미나 (Cloudflare Stream Live)` 헤더부터 그 아래 마지막 불릿(`…배지·배너·룸을 동시 갱신한다(ADR-014→016).`)까지 전체를 아래로 교체한다:

```markdown
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
- **CRITICAL: 동시 active 세션 1개.** `/start`는 이미 active 세션이 있으면 `409`. 앱 전역 `live`와 1:1(ADR-001).
- **`/end`만 전역 종료.** `/leave`는 본인 `Participant`만 닫는다(LiveKit 연결 종료는 클라이언트). 종료 시 LiveKit 룸 삭제는 best-effort.
- **채팅·반응·손들기**는 HTTP 엔드포인트가 아니라 **LiveKit 데이터 채널**로 룸 내부 전송한다(휘발·미저장).
- **CRITICAL: 미설정(키 부재) 시 `/start`·`/join`은 `503`**("아직 연결 안 됨", R30). build/test는 키 없이 통과(R2).
- **전이 전파는 Supabase Realtime으로**(R33) — `/start`·`/end` 핸들러가 broadcast하고 클라는 폴링 없이 구독해 배지·배너·룸을 동시 갱신한다(ADR-014→016).
```

그리고 `### 내부 / 웹훅 (인증은 서명 검증)` 섹션의 표 한 행과 그 아래 불릿:
- old 행: `| POST | `/api/webhooks/cloudflare` | 녹화 완료 등 Stream Live 이벤트 수신(HMAC 검증) |`
- old 불릿: `- 녹화 완료 시 발표 자료 아카이브 여부 결정(미결 → [`../agent/ISSUES.md`](../agent/ISSUES.md) I-3). 세션 인증이 아니라 **서명 검증**으로 보호.`
- → 둘 다 제거하고, 행 자리에 `| — | (현재 없음) | 녹화 웹훅 폐기 — LiveKit 전환(ADR-019). 녹화는 미결(ISSUES) |` 한 행만 남긴다.

그리고 `## 외부 연동`의 Cloudflare 불릿:
- old: `- **Cloudflare Stream Live:** Live Input 생성/조회/삭제, 녹화 조회. 앱은 방송 생성·권한 체크·플레이어 노출만 담당(인코딩/HLS/CDN은 위임, ADR-002). 자격증명은 서버 환경변수. **녹화 완료는 웹훅**으로 수신.`
- new: `- **LiveKit(SFU):** 앱은 입장 토큰 발급·권한 체크·룸 정리만 담당하고, 영상·음성·화면공유 트랙 라우팅은 LiveKit에 위임(ADR-019). 토큰 서명 키(`LIVEKIT_API_SECRET`)는 서버 환경변수. 화면공유 grant는 발표자에게만.`

### 4. `docs/dev/ARCHITECTURE.md` — 4곳 교체

프로덕션 스택 표:
- old: `| 라이브 | **Cloudflare Stream Live** (MVP 포함) | 영상 인프라 위임(ADR-002) |`
- new: `| 라이브 | **LiveKit(SFU)** | 다자간 화상 위임(ADR-019, ADR-002 대체) |`

교체표:
- old: `| `getUserMedia` 프리뷰 + 정적 아바타 | Cloudflare Stream Live |`
- new: `| `getUserMedia` 프리뷰 + 정적 아바타 | **LiveKit(SFU)** — 실제 다자간 참가자 비디오 타일·화면공유 |`

배포 토폴로지 다이어그램 줄:
- old: `[Vercel route handler]      ──webhook──< [Cloudflare Stream Live]  (Live Input·HLS·녹화)`
- new: `[브라우저] ──WebRTC──> [LiveKit SFU]  (다자간 영상·음성·화면공유 트랙; 채팅·반응은 데이터 채널)`

외부 서비스 경계 불릿:
- old: `- **Cloudflare Stream Live:** 앱은 Live Input 생성·권한 체크·플레이어 노출만(ADR-002). **녹화 완료는 Cloudflare 웹훅**으로 Vercel route handler가 수신(HMAC 검증) → 발표 자료 아카이브 여부(미결 I-3). 송출 자격증명은 발표자에게만([`../security/SECURITY.md`](../security/SECURITY.md)).`
- new: `- **LiveKit(SFU):** 앱은 입장 토큰 발급·권한 체크·룸 정리만(ADR-019). 영상·음성·화면공유 트랙과 룸 presence는 LiveKit이 담당하고, 채팅·반응·손들기는 LiveKit 데이터 채널로 룸 내부 전송한다. 화면공유 grant는 발표자 토큰에만([`../security/SECURITY.md`](../security/SECURITY.md)). 녹화(Egress)는 미결(ISSUES).`

### 5. `docs/agent/STATE.md` — live 전이 주석 추가

`## 앱 레벨 클라이언트 상태` 안의 ` ```프로토타입: … 모든 구독 클라 배지·배너·룸 동시 갱신``` ` 코드블록 **바로 다음 줄**에 아래를 삽입한다:

```markdown
> 룸 내부 참가자 타일·화면공유·채팅·반응·손들기는 **LiveKit(SFU·데이터 채널, ADR-019)**가 담당한다. 앱 전역 `live` on/off만 Supabase Realtime — 역할이 다르다.
```

### 6. `docs/dev/ENV.md` — Cloudflare 행 2개를 LiveKit 행으로 교체

- old:
  ```
  | `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_STREAM_API_TOKEN` | 라이브(Stream Live) | **비밀.** ADR-002 |
  | `CLOUDFLARE_WEBHOOK_SECRET` | 녹화 완료 등 Stream Live 웹훅 HMAC 검증 | **비밀.** 세션 인증 아님 — 서명 검증(S4.6) |
  ```
- new:
  ```
  | `LIVEKIT_URL` | 라이브 다자간 화상(LiveKit) WebSocket URL | 예: `wss://xxx.livekit.cloud`. ADR-019 |
  | `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | LiveKit 입장 토큰 서명 | **비밀. 서버 전용.** ADR-019 |
  ```

### 7. `.env.example` — Cloudflare 키 제거, LiveKit 키 추가

파일을 읽고, `CLOUDFLARE_`로 시작하는 모든 줄(있다면 그 위 주석 포함)을 제거한다. 그 자리에 아래를 추가한다:

```
# 라이브 다자간 화상 (LiveKit · ADR-019) — 서버 전용 비밀. 없으면 /start·/join 503, build/test는 통과.
LIVEKIT_URL=
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
```

> `.env`(실제 값, gitignore됨)는 건드리지 마라. 운영 키 주입은 사람이 별도로 한다.

## Acceptance Criteria

```bash
npm run build                                      # 문서 변경은 빌드를 깨지 않는다
grep -q "ADR-019" docs/agent/ADR.md                # ADR-019 존재
grep -q "LIVEKIT_URL" docs/dev/ENV.md              # ENV에 LiveKit 변수
grep -q "LIVEKIT_URL" .env.example                 # .env.example에 LiveKit 키
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트:
   - ADR-019가 ADR-002를 **대체**한다고 명시했고, ADR-001/R6/R33/ADR-015/R2 유지를 적었는가?
   - RULES R7/R8이 LiveKit 기준으로 갱신됐는가?
   - API.md·ARCHITECTURE.md·STATE.md·ENV.md에서 Cloudflare Stream 언급이 라이브 맥락에서 LiveKit으로 바뀌었는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가?
3. `phases/7-live-conference/index.json`의 step 0을 업데이트:
   - 성공 → `"status": "completed"`, `"summary": "ADR-019(ADR-002 대체)·RULES R7/R8·API/ARCHITECTURE/STATE/ENV/.env.example를 LiveKit 다자간 화상으로 갱신. 코드 변경 없음."`
   - 실패 → `"status": "error"`, `"error_message": "..."`

## 금지사항

- **코드를 수정하지 마라(`app/`·`lib/`·`components/`·`prisma/`).** 이유: 이 step은 문서 전용이며, 코드 전환은 step 1~4가 한다.
- **`.env`(실제 키 파일)를 수정하지 마라.** 이유: gitignore된 운영 비밀이고, 키 주입은 사람 몫이다.
- **ADR-001·R6·R33을 "고치지" 마라.** 이유: 이것들은 LiveKit 전환에도 유지되는 의도된 결정이다. ADR-019는 ADR-002만 대체한다.
- 기존 테스트를 깨뜨리지 마라.
