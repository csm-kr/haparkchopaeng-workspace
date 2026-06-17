# 모두의 세미나 — 발표자료 라이브 직접 공유 설계

- 날짜: 2026-06-17
- 상태: 승인됨 (구현 진행)
- 관련: `2026-06-16-live-room-leave-confirm-fullscreen-design`(화면공유 전체화면·얼굴 스트립·주석), LiveKit 다자간(ADR-019)

## 배경 / 목표

지금 라이브에서 자료를 보여주려면 **OS 화면공유로 PDF 창을 띄우는 수밖에** 없다(`MeetRoom`의 `FilesPanel`은 "연결된 자료 없음 → /presentations 링크"만 둠, R21). 발표자가 **업로드한 발표자료(Presentation의 PDF)를 OS 화면공유 없이 라이브 무대에 바로 띄우고**, 페이지를 모두에게 동기화하며, 그 위에 기존 얼굴 스트립 + 색연필(펜/레이저) 주석을 그대로 얹는다.

화면공유(웹/창) 시 얼굴+색연필은 이미 `ScreenShareStage`에 있으므로(전체화면 포함) **재사용**한다. 이번 작업은 "발표자료를 무대 소스로 쓰는 길"을 새로 여는 것.

## 방식 선택

- **택함: 페이지별 서버 렌더 이미지 + 데이터 채널 페이지 동기화.** PDF 페이지를 서버(mupdf, `figure-render.ts` 패턴 재사용)에서 PNG로 렌더해 `<img>`로 띄우고, "현재 페이지 번호"만 LiveKit 데이터 채널로 전파한다.
- **버림: 캔버스 captureStream → 화면공유 트랙 publish.** 정적 슬라이드를 영상으로 재인코딩(흐림·대역폭), 트랙 생명주기 복잡, 클라 PDF 렌더 라이브러리 필요. 이점 없음.
- **동기화는 participant attributes 대신 데이터 채널.** 토큰 grant에 `canUpdateOwnMetadata`가 없어 `setAttributes`는 서버/토큰 변경이 필요하다. 데이터 채널은 `canPublishData`로 이미 가능하고 채팅·주석과 일관(ADR-019). 늦게 입장한 사람은 **발표자가 `ParticipantConnected` 때 현재 상태를 재전송**해 따라온다.

## 범위

**In**
- 서버 렌더: `lib/pdf-page-render.ts`(`countPdfPages`, `renderPdfPageToPng`) — mupdf로 페이지 수/페이지 PNG.
- 라우트: `GET /api/presentations/:id/pages`(→ `{count}`), `GET /api/presentations/:id/pages/:n`(→ PNG). 세션+활성 팀 스코프(R37), PDF 자산 보유 자료만.
- 스토리지: `downloadObject(path)` 추가(스토리지 객체 → Buffer, mupdf 입력용).
- 조회: `getShareablePresentations(teamId)` — PDF 자산 보유 발표자료 `{id,title}[]`.
- 프로토콜: `LiveMessage`에 `present` kind 추가(`presentationId|null`, `page`, `pageCount`). 인코드/디코드+검증.
- 무대: `room-stage.tsx`를 일반화 — 공유 무대 셸(얼굴 스트립+주석+전체화면)을 **화면공유/발표자료 공통**으로 쓰고, 발표자료일 때 페이지 이미지+페이지 네비를 띄움. 우선순위: 발표자료 공유 > 화면공유 > 그리드.
- 컨트롤/패널: `MeetControls`에 발표자 전용 "발표자료 공유/중지" 버튼, `FilesPanel`을 `PresentationsPanel`로 — 공유 가능한 자료 목록(발표자는 공유/중지, 시청자는 현재 발표 표시).
- 배선: `meeting/page.tsx`(RSC) → `getShareablePresentations` → `LiveRoom` → `MeetRoom`.

**Out (이번 범위 아님)**
- PPTX/note 무대 공유 — mupdf가 PPTX를 못 연다. 지금처럼 다운로드만(PDF 자산만 대상).
- 텍스트 슬라이드(title/body) 공유 — 업로드한 실제 PDF를 띄우는 게 요청 취지.
- 시청자 그리기·시청자 독립 페이지 열람 — 발표자 주도 + 전원 동기화(주석은 발표자만, 현행 R7 유지).
- 발표자료 공유와 OS 화면공유 동시 무대 표시(공유가 우선).
- 발표 상태/주석 영속화 — 휘발(ADR-019).

## 아키텍처 (델타)

| 파일 | 변경 |
|---|---|
| `lib/storage.ts` | `downloadObject(path): Promise<Buffer>` 추가(admin `.download`) |
| `lib/pdf-page-render.ts` | **신규** — `countPdfPages(pdf)`, `renderPdfPageToPng(pdf, pageIndex)`(SCALE 150/72, 인덱스 클램프) |
| `app/api/presentations/[id]/pages/route.ts` | **신규** — GET `{count}` |
| `app/api/presentations/[id]/pages/[n]/route.ts` | **신규** — GET PNG(`Cache-Control: private, max-age`) |
| `lib/presentations.ts` | `getShareablePresentations(teamId)` 추가 |
| `lib/live-messages.ts` | `present` kind + 인코드/디코드/검증 |
| `components/live/types.ts` | `PresentState`, `SharablePresentation` 타입 |
| `components/live/room-stage.tsx` | 공유 셸 일반화 + 발표자료 무대(페이지 이미지·네비), 우선순위 분기 |
| `components/live/meet-controls.tsx` | 발표자 전용 발표자료 공유/중지 버튼 |
| `components/live/meet-room.tsx` | present 상태/액션 소유, 데이터 채널 송수신, 페이지 변경 시 주석 비움, 재전송(ParticipantConnected), 패널/컨트롤 배선 |
| `components/live/live-room.tsx` | `shareablePresentations` prop 통과 |
| `app/(app)/meeting/page.tsx` | `getShareablePresentations` 조회·주입 |

**안 건드림:** LiveKit 토큰/grant(`livekit.ts`)·라이브 세션 라우트(`/start`·`/join`·`/leave`·`/end`)·`annotation-overlay.tsx`(좌표 정규화가 이미지 박스에도 그대로 맞음)·DB 스키마(세션↔자료 연결은 데이터 채널 상태로 충분, 영속 불필요).

## 데이터 흐름

1. **목록:** `meeting/page.tsx`가 활성 팀의 `getShareablePresentations(teamId)`를 `LiveRoom→MeetRoom→PresentationsPanel`로 주입.
2. **공유 시작(발표자):** 패널/버튼에서 자료 선택 → `MeetRoom`이 `GET /pages`로 `count` 취득 → 데이터 채널에 `{kind:"present", presentationId, page:1, pageCount:count}` publish + 낙관적 로컬 반영.
3. **수신:** `present` 메시지는 **발표자 identity일 때만** 신뢰(R3). `presentationId`가 있으면 발표 상태로, `null`이면 해제. 페이지가 바뀌면 잔여 주석을 비운다.
4. **무대 렌더:** 발표 상태가 있으면 `RoomStage`가 공유 셸에 `<img src="/api/presentations/:id/pages/:page">`를 띄우고(얼굴 스트립·주석·전체화면 동일), 화면공유 트랙이 있으면 그 영상, 둘 다 없으면 그리드.
5. **페이지 이동(발표자):** 무대의 이전/다음 → `{kind:"present", ..., page:n}` 재전파. 시청자는 따라가고 페이지 번호만 표시.
6. **늦은 입장:** 발표자가 `RoomEvent.ParticipantConnected` 수신 시 현재 발표 상태를 재전송 → 새 참가자가 즉시 따라옴.
7. **공유 종료:** 발표자가 중지 → `presentationId:null` 전파 → 무대는 화면공유/그리드로 복귀.

## 서버 렌더

`figure-render.ts`와 동일: `mupdf.Document.openDocument(pdf, "application/pdf")` → `loadPage(i).toPixmap(Matrix.scale(SCALE,SCALE), DeviceRGB, false).asPNG()`. `SCALE=150/72`.

- `countPdfPages(pdf)`: `openDocument().countPages()`. 못 열면 0.
- `renderPdfPageToPng(pdf, pageIndex)`: 인덱스를 `[0, count-1]`로 클램프(off-by-one 방어) 후 페이지 PNG.
- 라우트는 PDF 자산을 `downloadObject(asset.url)`로 받아 위 함수에 넘긴다.
- 페이지 라우트 응답: `image/png` + `Cache-Control: private, max-age=3600`(인증 자료라 공유 캐시 금지). 페이지는 사실상 불변이라 브라우저 캐시로 재요청 절감.

## 보안 / 스코핑

- 두 라우트 모두 `requireAuth()` + `getActiveTeam` + `prisma.presentation.findFirst({where:{id, teamId}})` — 다른 팀 자료면 404(존재 숨김, R19/R37). 자산 라우트와 동일 정신이되 팀 스코프를 명시적으로 건다.
- `present` 메시지는 발표자 identity만 신뢰(R3) — 시청자가 위조해도 무대가 바뀌지 않음. 그리기는 기존대로 발표자만(R7).

## 테스트 (TDD — 먼저)

- `lib/__tests__/live-messages.test.ts`(보강): `present` 왕복; `presentationId:null`(중지) 허용; `page`/`pageCount` 비-숫자·음수는 null/클램프; 알 수 없는 필드 방어.
- `lib/__tests__/pdf-page-render.test.ts`(신규, mupdf 목 — figure-render 테스트 패턴): `countPdfPages`가 페이지 수 반환·못 열면 0; `renderPdfPageToPng`가 PNG 바이트 반환·인덱스 범위 밖 클램프(0/마지막).
- `app/api/presentations/[id]/pages/__tests__/pages.test.ts`(신규): 미인증/다른 팀 → 404; PDF 자산 없으면 404; count 반환; 페이지 라우트가 `image/png` 반환·n 클램프; render 라이브러리는 목.
- `lib/__tests__/presentations.test.ts` 또는 컴포넌트 테스트(보강): `getShareablePresentations`가 PDF 자산 보유분만·활성 팀 스코프(prisma 목).
- `components/live/__tests__/room-stage.test.tsx`(보강): 발표 상태 있으면 페이지 이미지 무대(우선순위 발표자료>화면공유>그리드); 발표자엔 페이지 네비, 시청자엔 번호 표시·네비 없음.
- `components/live/__tests__/meet-room.test.tsx`(보강): 발표자 identity의 `present` 수신 → 무대 전환; 비-발표자 위조 `present`는 무시(R3); 페이지 변경 시 주석 비움; 공유 시작 시 `/pages` 호출·publish.

## 구현 순서 (각 단계 RED→GREEN)

1. `lib/live-messages.ts` — `present` kind(테스트 먼저). 기존 왕복 그린 유지.
2. `lib/storage.ts`(`downloadObject`) + `lib/pdf-page-render.ts`(테스트 먼저).
3. `pages` 라우트 2종(테스트 먼저).
4. `lib/presentations.ts` `getShareablePresentations`(테스트 먼저).
5. `components/live/types.ts` 타입 + `room-stage.tsx` 무대 일반화(테스트 먼저, 화면공유 회귀 그린 유지).
6. `meet-controls.tsx` 버튼 + `meet-room.tsx` 상태/송수신/재전송/배선(테스트 먼저).
7. `live-room.tsx`·`meeting/page.tsx` 배선.
8. 전체 `tsc`/`vitest`/`lint` 그린.

## 커밋 정책

사용자 지시 시, 위 델타 경로만 명시 스테이징(`git add <경로>`, 절대 `-A` 금지 — 작업 무관 미커밋 변경 존재). conventional commits `feat(live): …`.

## 가정 / 미해결

- PDF 자산만 무대 공유(PPTX 다운로드 유지). 한 발표자료에 PDF 자산이 여러 개면 첫 PDF를 쓴다(현 `PdfSlideViewer`와 동일 가정).
- 페이지 이미지 캐시는 브라우저(`Cache-Control`)에 의존. 스토리지 영속 캐시는 추후 최적화(현 트래픽 규모에서 불필요).
- mupdf를 요청 시 라우트에서 실행(Inngest 잡 아님) — 콜드스타트 비용 있으나 페이지 단위라 가볍고 캐시로 상쇄. 동작 불가 시 페이지 라우트만 5xx, 라이브 자체는 정상.
- 발표 상태는 휘발 — 새로고침/재접속 시 발표자 재공유 또는 재전송으로 복구.
