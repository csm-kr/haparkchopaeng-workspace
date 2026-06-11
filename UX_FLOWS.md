# UX 플로우 & UI 로직

개발자가 필요로 하는 단계별 플로우, 상태, 조건부 UI 로직. `README.md`(컴포넌트/토큰 세부)와 `src/` 파일(정확한 마크업)과 함께 본다.

## 내비게이션 모델

- 앱이 `screen` + 선택적 `params`(예: `{ paperId }`, `{ presId }`)를 보유한다.
- `onNavigate(screen, params)`가 모든 화면, 사이드바, 브레드크럼에 전달된다.
- 화면 간 공유되는 앱 레벨 상태: **`live`**(boolean), `theme`, 사이드바 `collapsed`, `uploadOpen`.
- `onToast(msg)`가 일시적 확인을 표시한다.

---

## 플로우 1 — 라이브 세미나 라이프사이클 (앱 전역)

```
[임의의 화면]
  사이드바 "세미나 라이브" 항목 → onNavigate('meeting')

MeetingScreen, live === false:
  ┌ 빈 상태 ─────────────────────────────────┐
  │ 아이콘 · "진행 중인 라이브가 없습니다"       │
  │ [라이브 시작하기]  [스케줄 보기]            │
  │ 다음 세미나: 토요일 10:00 · 발표 OOO        │
  └──────────────────────────────────────────┘
  라이브 시작하기 → onSetLive(true) + 토스트 → 룸

MeetingScreen, live === true:
  비디오 그리드 + 발표자 스포트라이트 + 컨트롤
  헤더: [종료]  [나가기]
    종료  → 미디어 트랙 중지 · onSetLive(false) · onNavigate('dashboard') · 토스트
    나가기 → 본인만 퇴장 (다른 사람에게는 live가 true로 유지)
```

**`live === true`의 부수 효과:**
- 사이드바 `meeting` 내비 항목이 깜빡이는 **LIVE** 알약을 렌더링한다(해당 카운트 배지를 억제).
- 대시보드가 최상단에 **LIVE 배너**를 렌더링한다(`live === false`일 때 숨김).

> 왜 앱 레벨인가: 배지, 배너, 룸이 항상 일치해야 한다. `live`를 `MeetingScreen` 안에 두지 말 것.

> **프로덕션 스트리밍 = Cloudflare Stream Live.** 영상 인프라(RTMP 서버 / 인코딩 / HLS / CDN / 녹화)를 직접 만들지 않고, 앱은 **방송 생성 · 권한 체크 · 플레이어 노출**만 담당한다. 라이브 시작 시 Cloudflare Live Input을 생성하고 RTMPS/SRT 송출 정보(URL + Stream Key)를 발표자에게 보여주며, 시청자에게는 권한 확인 후 HLS/Cloudflare Player로 재생한다. 이 모델은 컨퍼런스(상호 비디오 그리드)가 아니라 **1인 송출 + 다수 시청 방송**에 가깝다 — 현재 프로토타입의 비디오 그리드는 이 방향으로 재해석한다(열린 질문 참조).

---

## 플로우 2 — 논문 분석 (핵심 표면)

```
라이브러리(논문) → .paper-row 클릭 → onNavigate('paper', {paperId})

PaperDetailScreen:
  상단바: 브레드크럼 [발표 자료 → <제목>] · 액션: [⬇ 원문 PDF]   (이것 하나만)
  헤더: 제목 · 저자/메타
  AnalysisView (전체 폭):

    ┌ 관점 바 (상단 고정) ─────────────────────────────────┐
    │ ( 🔬 연구 분석 | 🛠️ 재구현 분석 )   <한 줄 힌트>       │
    └──────────────────────────────────────────────────────┘

    sections = [ ...lensSections, FIG_SECTION ]   // figure는 항상 마지막, 두 관점 공통

    각 섹션마다:
      ┌ 카드 ────────────────────────────────────────┐
      │ 아이콘 · <제목> · 배지(분석 | "PDF 추출")       │
      │ <렌더링된 섹션 본문>                           │
      │ ── 노트 (있거나 추가 중일 때) ──               │
      │   [작성자 표기 노트 카드들]                     │
      │   [addingSec === id일 때 인라인 추가 폼]        │
      │ [+ 이 섹션에 분석 추가]   ← 섹션별              │
      └───────────────────────────────────────────────┘
```

### 섹션 세트
- **연구 관점:** Problem Setting · Contribution · Input/Output · Comparison · Ablation
- **재구현 관점:** 자체 세트(데이터 / 모델 / 학습 / 리소스)
- **FIG_SECTION(`Figure 분석`)**은 **두 관점 모두**에 추가됨.

### Figure 카드
- 출처 배지: **"원문 PDF p.{page}에서 추출"**.
- 추출된 figure용 `<image-slot>`(프로덕션: 렌더링된 PDF figure).
- 캡션 + "설명" 배지가 붙은 **설명**(해석) 줄.

### 섹션별 노트 추가 (상태 머신)
```
addingSec: string | null   // 어느 섹션의 폼이 열려 있는지 (한 번에 하나)
extras: [{ id, sectionId, lens, title, body, author }]

[+ 이 섹션에 분석 추가] (섹션 S에서)
   → openAdd(S):  addingSec = S; title/body 초기화
   → 인라인 폼 (제목 입력 + 본문 textarea + 취소/추가)
   취소  → closeAdd()  (addingSec = null)
   추가  → validate(title && body), 아니면 토스트
          push { sectionId:S, lens: S==='figures' ? 'any' : currentLens, author: CURRENT_USER }
          closeAdd(); 토스트

섹션 S의 렌더 필터:
   extras.where(sectionId === S && lens === (S==='figures' ? 'any' : currentLens))
```
- Figure 노트는 **관점 공통**(`lens:'any'`) — 어느 관점에서도 figure 아래에 보인다.
- 노트는 작성자 아바타 + 이름 + 제목 + 본문, 그리고 삭제(×)를 표시한다.

### 레이아웃 변형 (AnalysisView의 `layout` prop)
- `stack`(기본), `grid`, 또는 `toc`. `toc`는 `.content` 스크롤러를 `#an-<sectionId>`로 부드럽게 스크롤하는 고정 좌측 섹션 점프 목록을 추가한다.

---

## 플로우 3 — 스케줄: 빈 상태 → 편집 → 확정

```
store[`${year}-${month}`] = { weeks, saved:true } | undefined
weeks = editing ? draft : (saved ? saved.weeks : null)
```

```
ScheduleScreen, 월 보드:

  weeks == null (계획 없음):
    ┌ 빈 상태 ───────────────────────────────┐
    │ "이 달은 아직 일정이 없습니다"           │
    │ [+ 일정 짜기]                           │
    └────────────────────────────────────────┘
    일정 짜기 → draft = draftMonth(year, month, rotEnd); editing = true

  editing (초안):
    각 토요일 행 (편집 가능):
      [✓ 확정] [주차·날짜] [⏰ 시간 입력] [발표자 선택]
      [주제 텍스트 입력 ...........................]
    고정 편집 바:
      "확정 N/M · 주제·발표자를 채우고 저장하세요"   [취소] [저장]
    취소 → editing=false; draft=null
    저장 → store[key] = {weeks:draft, saved:true}
           rotEnd = (rotEnd + draft.length) % TEAM.length   // 순번 전진
           editing=false; 토스트

  saved & !editing (확정 / 읽기 전용):
    각 행:
      [주차·날짜] [⏰ 정적 시간] [발표자 아바타+이름]
      [상태 알약: 완료 | ●이번 주 | 발표예정] [액션 버튼]
      [주제 | "주제 미정"]
    보드 헤더에 [⚙ 수정] → editExisting(): draft = copy(saved.weeks); editing=true
```

**규칙**
- **월 이동은 자동 생성하지 않는다.** 빈 달은 비어 있는 채로 유지된다.
- `editing` 중에는 달을 변경할 수 없다(토스트: "편집 중에는 달을 옮길 수 없어요").
- `draftMonth(year, month, startIdx)`는 해당 월의 토요일들을 계산하고 `startIdx`부터 시작하는 순번으로 발표자를 배정하며, 주제는 빈 값, `confirmed:false`로 둔다.
- `currentIdx` = 첫 번째 비-`done` 주차 → "이번 주" 알약 + 입장 액션을 받는다.

**행 상태 → 액션**
| 상태 | 알약 | 액션 |
|---|---|---|
| done | 완료 | [자료] → presentation (presId 있을 때) |
| current (not done) | ●이번 주 | [입장] → meeting |
| upcoming | 발표예정 | [미리보기] (presId 있을 때) / "준비 전" |

**기타 스케줄 보드**
- **벌금 설정**: `finePresenter`, `fineAbsent` — 보기/편집 토글; 저장된 금액이 통계 표에 실시간 반영.
- **로테이션**: 하수현 → 박진희 → 조성민 → 팽진욱.
- **연도별 멤버 현황**: 멤버별 → 참여, 발표자 불참, 일반 불참, 누적 벌금 = `missedPresenter*finePresenter + missedAbsent*fineAbsent`, 납부, 미납(`owed - paid` 또는 "완납").

---

## 플로우 4 — 팀 관리

```
사이드바 멤버 행 (또는 내비 팀 관리) → onNavigate('team')

TeamScreen:
  ┌ 초대 ─────────────────────────────────────────────┐
  │ [이메일 입력] [역할 선택 관리자/멤버/게스트] [초대 보내기] │
  │ 🔗 초대 링크 복사                                   │
  └───────────────────────────────────────────────────┘

  현재 멤버:
    행: 아바타 · 이름 (+ 자신에게 "나") · 이메일 · [역할 배지] · [⋯ 메뉴]
      ⋯ 메뉴: 역할 변경(관리자/멤버/게스트) · 내보내기(위험)

  초대 대기 (pending, 점선 행):
    행: ✉ 아바타 · 이메일 · "초대됨" · [재전송] [취소]
```

역할 배지 스타일: 관리자 = 액센트 틴트; 멤버 = 중립; 게스트 = 앰버 틴트(CSS에 라이트/다크 변형).

---

## 플로우 5 — 업로드 (PDF 전용)

```
[＋ 업로드] (대시보드 / 라이브러리) → UploadModal

idle 단계:
  드롭 존: "PDF를 여기로 끌어다 놓으세요" · 타입: [PDF]만
  "또는 arXiv URL로": [url 입력] [가져오기]
  (PPTX/MD 타입과 아이디어 메모 / 빈 노트 단축: 제거됨)

startUpload(filename):
  idle → uploading (진행률) → analyzing → done → 논문으로 이동
```

---

## 플로우 6 — 발표 자료 (자료)

```
내비 발표 자료 → PresentationsScreen (목록, 개수 "14개")
  자료 클릭 → onNavigate('presentation', {presId})

PresentationView:
  자료 뷰어 + 댓글 스레드
  댓글: 아바타 · 이름 · 시간 · 텍스트(@멘션 링크화) · 반응
  작성: textarea (Cmd/Ctrl+Enter로 전송) · 첨부/이모지/멘션 · 보내기
```

---

## 조건부 UI 치트시트

| 조건 | UI |
|---|---|
| `live === false` | meeting = 빈 상태; 사이드바 LIVE 알약 없음; 홈 배너 없음 |
| `live === true` | meeting = 룸; 사이드바 LIVE 알약; 홈 LIVE 배너 |
| 스케줄 월 `weeks == null` | 빈 상태 + 일정 짜기 |
| 스케줄 `editing` | 편집 가능 행 + 취소/저장 바; 월 내비 잠김 |
| 스케줄 saved & `!editing` | 읽기 전용 행 + 수정 |
| `addingSec === section.id` | 해당 섹션의 인라인 추가 폼 열림 |
| figure 섹션 | "PDF 추출" 배지; figure 노트는 관점 공통 |
| role === guest | 앰버 배지 |
| 업로드 | PDF 전용 드롭존 + arXiv URL |
