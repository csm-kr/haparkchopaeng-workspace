# 보안 (Security)

> 권한이 걸린 엔드포인트는 [`../dev/API.md`](../dev/API.md), 비밀 관리는 [`../dev/ENV.md`](../dev/ENV.md), 데이터 모델은 [`../dev/DB.md`](../dev/DB.md)를 본다. 이 문서는 **위협 모델·인증/인가·비밀·데이터 보호 규칙**을 정리한다.

## 위협 모델 (단일 테넌트, 4인 비공개)

- **자산:** 논문 PDF·분석, 발표 자료, 라이브 입장 토큰(LiveKit), 멤버 PII(이메일), 벌금 장부, 외부 API 키(Gemini·LiveKit·Supabase).
- **주요 위협:** ① 초대 외 무단 접근(공개 가입 없음) ② LiveKit 입장 토큰 유출 → 무단 입장·화면공유 ③ 비밀 키의 클라이언트 노출 ④ 스토리지 객체 무단 다운로드 ⑤ 작성자 위변조(노트/댓글) ⑥ 권한 상승(멤버→관리자).
- **범위 밖:** 멀티테넌트 격리(테넌트가 1개), 대규모 DDoS(4인 사설).

## 인증 (Authentication)

- **초대 전용.** 공개 회원가입 없음(ADR-007). 합류는 서명된 초대 토큰 검증으로만(`INVITE_TOKEN_SECRET`).
- **세션:** 서버 서명 세션(`AUTH_SECRET`). HTTP-only·Secure·SameSite 쿠키. 미인증 → `401`.
- **초대 토큰:** 만료·1회성 권장. 토큰에 부여 역할을 담되 서버가 재검증.

## 인가 (Authorization)

역할: **관리자 / 멤버 / 게스트**. 모든 권한 체크는 **서버(route handler) 진입부**에서 수행한다. 클라이언트 UI 숨김은 보조일 뿐 신뢰 경계가 아니다.

| 동작 | 관리자 | 멤버 | 게스트 |
|---|:--:|:--:|:--:|
| 논문/자료 열람·노트·댓글 | ✅ | ✅ | ✅(읽기 위주) |
| 업로드·분석 생성 | ✅ | ✅ | △ |
| 라이브 시작/입장 | ✅ | ✅ | △ |
| 노트/댓글 삭제 | 본인+관리자 | 본인 | 본인 |
| 스케줄 저장 | ✅ | ✅ | ❌ |
| 벌금 금액 수정 | ✅ | ❌ | ❌ |
| 초대·역할 변경·내보내기 | ✅ | ❌ | ❌ |

- 권한 부족 → `403`. 게스트(△/❌)는 정책에 따라 좁힌다.

## 신뢰 경계 (CRITICAL)

- **작성자/소유자 ID는 항상 세션에서 취한다.** 클라이언트가 보낸 `authorId`/`uploadedBy`/`presenterId`를 신뢰하지 않는다(→ [`../dev/SEQUENCE_DIAGRAM.md`](../dev/SEQUENCE_DIAGRAM.md) S2).
- **입력 검증:** API 경계에서 zod로 검증, 실패 시 `400`. 업로드 Content-Type은 `application/pdf`만(`415`).
- **순번 포인터·확정 상태** 같은 무결성 값은 서버에서 원자적으로 계산·전이(클라이언트가 보내지 않음).

## 비밀 관리

- **CRITICAL: 모든 키는 `.env`(서버)에서만.** 클라이언트 번들·`NEXT_PUBLIC_*`에 비밀 금지. `.env`는 커밋 금지(→ [`../dev/ENV.md`](../dev/ENV.md)).
- 외부 호출(Gemini 분석·LiveKit 토큰 서명·Supabase)은 **서버 route handler에서만**. 클라이언트는 자체 API 경유.
- 키 유출 시 즉시 회전. 최소 권한 토큰 사용.

## 라이브(LiveKit · ADR-019)

- **CRITICAL: LiveKit 입장 토큰은 참가자별로 서버가 서명·발급하고 본인에게만** 반환한다(`/live/start`=발표자, `/join`=참가자). **화면공유 grant는 발표자 토큰에만**(R7). 신원(identity)은 세션에서 주입 — 클라가 보낸 식별자 미신뢰(R3). 토큰 서명 키(`LIVEKIT_API_SECRET`)는 서버 전용.
- 동시 active 세션은 **팀당 1개** 강제(`409`) — 팀 전역 `live`와 1:1(ADR-001/ADR-020). `/end`만 전체 종료(LiveKit 룸 삭제 best-effort), `/leave`는 본인만.
- 채팅·반응·손들기는 LiveKit **데이터 채널**로 룸 내부에서만(휘발·미저장). 페이로드의 author를 신뢰하지 않고 LiveKit identity로 판별.

## 파일 스토리지

- 원문 PDF·발표 에셋·figure 이미지는 **비공개 버킷**. 다운로드는 **단기 서명 URL**로만 제공(공개 버킷·영구 URL 금지).
- 논문 URL fetch는 서버가 수행(클라이언트가 임의 URL을 서버에 대신 요청하게 하지 않음 — SSRF 주의). 호스트 화이트리스트로 강제하며(`lib/paper-url.ts` `resolvePaperSource`), 현재 허용: `arxiv.org`, `openaccess.thecvf.com`(CVF), `openreview.net`, `aclanthology.org`, `proceedings.mlr.press`, `proceedings.neurips.cc`. https만 허용하고 호스트는 정확 일치(서브도메인 사칭·사설IP·평문 차단). 새 출처는 이 목록에 추가한다.

## 데이터 보호 / 프라이버시

- 멤버 이메일은 PII — 초대·팀 화면 외 불필요한 노출 금지.
- 라이브 녹화 보존 기간·발표 자료 아카이브 여부는 미결(→ [`../agent/ISSUES.md`](../agent/ISSUES.md)).
- 논문 PDF를 Google Gemini 분석에 전송함을 인지(외부 처리). 민감 비공개 자료 업로드 시 팀 합의.

## 체크리스트 (PR/리뷰)

- [ ] 새 엔드포인트에 인증·역할 체크가 진입부에 있는가
- [ ] 작성자/소유자 ID를 세션에서 취하는가(클라 입력 미신뢰)
- [ ] 비밀을 클라이언트에 노출하지 않는가(`NEXT_PUBLIC_` 오용 없음)
- [ ] 업로드 Content-Type·크기 검증(PDF 전용)
- [ ] 다운로드가 서명 URL 경유인가
- [ ] Stream Key가 발표자에게만 가는가
