# 핸드오프: 하박조팽 리서치 워크스페이스

4인 리서치랩 협업 앱(웹). 한국어 UI. 이 패키지는 개발자가 실제 코드베이스에서 재구축할 수 있도록 디자인을 문서화한다.

## 개요

**하박조팽**(HaBakJoPaeng — 네 멤버 하수현·박진희·조성민·팽진욱)은 **매주 토요일 세미나**를 진행하는 소규모 리서치 그룹을 위한 비공개 워크스페이스다. 이 제품은 그룹이 매주 수행하는 네 가지 일을 하나로 묶는다:

1. **세미나 라이브** — 매주 토요일 발표를 위해 입장하는 라이브 비디오 룸.
2. **논문 분석 관리** — 논문 PDF를 업로드하면 **연구 관점**(논문 이해)과 **재구현 관점**(재현)으로 구조화되며, 섹션별 팀 노트가 함께한다.
3. **자료 관리**(발표 자료) — 발표 자료가 회고용 댓글/반응과 함께 누적된다.
4. **스케쥴 관리** — 어느 토요일에 누가 발표하는지, 순번, 출석 + 벌금 추적, 월별 계획.
5. **팀 관리** — 멤버 초대, 역할 부여, 대기 중인 초대 관리.

이것은 한 그룹을 위한 단일 테넌트 도구이지 다중 조직 SaaS가 아니다. 톤은 따뜻하고 격식 없는 한국어다("리서치는 혼자 하는 게 아니야").

## 디자인 파일에 대하여

`src/`의 파일들은 **HTML/React-via-Babel로 만든 디자인 레퍼런스**다 — 의도한 모습과 동작을 보여주는 클릭 가능한 프로토타입이다. **출시할 프로덕션 코드가 아니다.** 브라우저 내 Babel 설정, `window.*` 전역, 인라인 JSX `<script type="text/babel">` 로딩은 모두 프로토타입을 위한 편의 장치다.

작업은 타깃 코드베이스 환경에서 그곳의 확립된 패턴(실제 번들러, 컴포넌트 라이브러리, 라우터, 실제 상태 관리, 실제 비디오 SDK, 실제 PDF 파이프라인)을 사용해 **이 디자인들을 재현**하는 것이다. 아직 코드베이스가 없다면, 컴포넌트 라이브러리(예: Radix/shadcn)를 곁들인 모던 React + TypeScript + Vite 스택이 여기 있는 것과 깔끔하게 대응된다.

## 충실도 (Fidelity)

**고충실도.** 최종 색상, 타이포그래피, 간격, 레이아웃, 카피, 빈 상태, 인터랙션 상태가 모두 프로토타입에 명세되어 존재한다. UI는 충실하게 재현하되, 프로토타입 메커니즘(브라우저 Babel, 목 `window` 데이터, 가짜 미디어 스트림)은 프로덕션 동등물로 교체한다.

## 프로토타입의 기술 (그리고 무엇으로 교체할지)

| 프로토타입 메커니즘 | 교체 대상 |
|---|---|
| `@babel/standalone`로 브라우저에서 JSX 트랜스파일 | 실제 빌드(Vite/Next) |
| `data.js`의 `window.PAPERS`, `window.TEAM`, `window.SCHEDULE` 등 | API + 타입드 모델 / DB |
| `useDetailState` / `useAnState` / `useMeetState` (로컬 `useState`) | 실제 상태 + 서버 영속화 |
| `<image-slot>` 웹 컴포넌트(드래그앤드롭 플레이스홀더) | 실제 이미지 업로드 / 렌더링된 PDF figure |
| `getUserMedia` 프리뷰 타일, 타인용 정적 아바타 | **LiveKit(SFU)** — 참가자별 입장 토큰으로 같은 룸에 접속해 다자간 비디오 타일·화면공유(ADR-019, Cloudflare Stream Live 대체). 앱은 토큰 발급·권한 체크·룸 정리만 담당 |
| Tweaks 패널(`tweaks-panel.jsx`) | **제거** — 제품 기능이 아니라 디자인 탐색 도구 |

## 앱 구조 & 라우팅

싱글 페이지 앱. `app.jsx`가 `screen` 문자열과 작은 switch 라우터를 보유한다. 화면들:

| 화면 키 | 컴포넌트 | 라우트 의도 |
|---|---|---|
| `auth` | `AuthScreen` (screens-auth.jsx) | 로그인 / 가입 히어로 |
| `dashboard` | `DashboardScreen` (screens-main.jsx) | 홈 |
| `library` | `LibraryScreen` (screens-main.jsx) | 논문 목록 |
| `paper` | `PaperDetailScreen` (screens-detail.jsx) | 한 논문의 분석 |
| `presentations` | `PresentationsScreen` (screens-presentations.jsx) | 발표 자료 목록 |
| `presentation` | `PresentationView` (screens-detail.jsx) | 한 자료 + 댓글 |
| `schedule` | `ScheduleScreen` (screens-schedule.jsx) | 스케쥴 |
| `team` | `TeamScreen` (screens-main.jsx) | 팀 관리 |
| `meeting` | `MeetingScreen` (meeting.jsx) | 세미나 라이브 |
| `ideas` | 아이디어 보드 | 아이디어 |
| `profile` | `ProfileScreen` (screens-main.jsx) | 설정 |

**(화면별이 아니라) 앱 레벨로 끌어올려야 하는 상태:**
- `live: boolean` — 지금 세미나가 라이브인가? 사이드바 `LIVE` 배지, 대시보드 배너, 그리고 미팅 룸 vs. 빈 상태를 좌우한다. `MeetingScreen`에서 라이브를 시작/종료하면 `onSetLive`를 통해 위로 흘러간다.
- `theme`, `collapsed`(사이드바), `uploadOpen`, 현재 `screen` + 파라미터.

## 영속 셸 (shell.jsx)

- **사이드바**: 로고(하박조팽), 내비 목록, 접기 토글, 하단의 멤버 목록(멤버 클릭 → 팀 관리). 내비 항목은 선택적 `count`/`unread` 배지를 가지며, `meeting` 항목은 *`live === true`일 때만* 깜빡이는 **LIVE** 알약을 표시한다.
- **상단바**: 브레드크럼(좌측), 맥락 액션 버튼(우측). 모든 화면이 `<Topbar crumbs={[...]} actions={...} />`로 사용한다.

내비 순서: 홈 · 논문 · 발표 자료 · 아이디어 · 스케쥴 · 팀 관리 · 세미나 라이브.

## 화면들

### 인증 (screens-auth.jsx)
스플릿 히어로. 좌측 = 브랜드 패널: 워드마크 "하박조팽", 태그라인 **"리서치는 혼자 하는 게 아니야."**, 서브 카피, 그리고 4개 항목 기능 목록(세미나 라이브 / 논문 분석 관리 / 자료 관리 / 스케쥴 관리) — 각각 아이콘 타일 + 제목 + 한 줄 설명. 우측 = 로그인/가입 폼. 빠른 "social-btn" 항목은 데모 멤버로 로그인한다.

### 대시보드 / 홈 (screens-main.jsx → DashboardScreen)
- 최상단의 **LIVE 배너** — **`live`일 때만** 렌더링. 미팅으로 연결된다.
- **퀵 카드** 행: 논문, 발표 자료 등 — 각각 `{icon, label, count, desc}`.
- 최근 활동: "최근 발표 자료" 섹션, 최근 논문들.

### 논문 목록 (LibraryScreen)
- 제목 + 단일 필터 칩 "전체"(다른 타입 필터는 의도적으로 제거됨 — 전체만 유지).
- 논문 행들(`.paper-row`): 종류 태그, 제목, 저자, 업로더 아바타, 날짜. 클릭 → `paper`.

### 논문 상세 (screens-detail.jsx → PaperDetailScreen) — **가장 중요한 화면**
헤더: 브레드크럼(발표 자료 → 논문), 제목, 저자/메타. **상단바 액션 = 단일 "원문 PDF" 다운로드 버튼**(arXiv 및 공유 버튼은 제거됨). 탭 바 없음.

헤더 아래에 전체 폭의 **`AnalysisView`**(analyzer.jsx)가 자리한다. 구성:

- **상단에 고정된 관점 토글**: `🔬 연구 분석` ⇄ `🛠️ 재구현 분석`, 그리고 활성 관점을 설명하는 한 줄 힌트.
- **섹션들**(카드). 연구 관점: Problem Setting · Contribution · Input/Output · Comparison · Ablation. 재구현 관점: 자체 세트(데이터/모델/학습/리소스).
- **`Figure 분석`은 두 관점 모두의 하단에 고정** — 관점별이 아니라 공통이다. 각 figure 카드는 **"원문 PDF p.N에서 추출"** 출처 배지, 추출된 figure용 `<image-slot>`, 캡션, 그리고 **설명**(해석) 줄을 표시한다. 프로덕션에서는 자동 또는 사람이 작성한 설명과 함께 PDF에서 추출/렌더링된 실제 figure다.
- **섹션별 "이 섹션에 분석 추가"**: 모든 섹션(Figure 포함)이 자체 노트 추가 기능을 가진다. 클릭하면 인라인 폼(제목 + 본문)이 열리고, 저장하면 해당 섹션 아래에 작성자 표기 노트 카드(작성자 아바타 + 이름 + 제목 + 본문)가 추가된다. 노트는 `{sectionId, lens}`로 스코프된다 — 단 Figure 노트는 관점 공통(`lens: "any"`)이다. 노트는 삭제 가능하다.

`layout` prop으로 레이아웃 변형(`stack` / `grid` / `toc`)이 존재한다; `toc`는 고정된 섹션 점프 사이드바를 추가한다.

### 발표 자료 목록 (screens-presentations.jsx) & PresentationView
자료 목록(개수 "14개"). 상세 = 자료 뷰어 + @멘션과 반응이 있는 댓글 스레드.

### 스케쥴 (screens-schedule.jsx) — **두 번째로 중요**
보드의 단일 컬럼. 핵심 모델: **월별 계획**, `store[`${year}-${month}`] = { weeks, saved }`로 저장.

월별 세 가지 상태:
1. **빈 상태** — 저장된 계획이 없는 달 → 중앙 정렬 빈 상태 "이 달은 아직 일정이 없습니다" + **일정 짜기** 버튼. 다른 달로 이동해도 계획이 **자동 생성되지 않는다**; 빈 달은 계획되기 전까지 비어 있다.
2. **편집 모드** — `일정 짜기`(또는 `수정`)가 해당 월 토요일들의 초안을 만든다(순번은 직전 계획이 끝난 지점부터 이어짐). 각 행은 편집 가능: 확정 **체크박스**, **시간** 입력, **발표자** 선택, **주제** 텍스트 입력. 고정된 편집 바가 "확정 N/M"과 취소 / **저장**을 표시한다.
3. **확정(표시) 모드** — 저장 후 행들은 읽기 전용: 주차, 날짜, 정적 시간, 발표자, 상태 알약(완료 / 이번 주 / 발표예정), 액션 버튼(자료 / 입장 / 미리보기), 주제. 수정 버튼이 편집 모드로 다시 진입한다.

페이지의 다른 보드들: **벌금 설정**(발표자 불참 벌금, 일반 불참 벌금 — 둘 다 편집 가능), **로테이션**(하수현 → 박진희 → 조성민 → 팽진욱), **연도별 멤버 현황** 표(참여 / 불참 / 누적 벌금 / 납부 / 미납, 편집 가능한 벌금 금액으로부터 재계산).

### 팀 관리 (screens-main.jsx → TeamScreen)
- **초대 블록**: 이메일 필드 + 역할 선택(관리자/멤버/게스트) + 초대 보내기, 그리고 초대 링크 복사 링크.
- **멤버 목록**: 아바타, 이름(+자신에게는 "나" 태그), 이메일, 역할 배지, 역할 변경 / 내보내기를 위한 행별 "⋯" 메뉴.
- **대기 중인 초대**: 점선 행에 재전송 / 취소.

### 세미나 라이브 (meeting.jsx)
- **`!live`일 때 빈 상태**: 중앙 정렬 "진행 중인 라이브가 없습니다", **라이브 시작하기**(주요) + 스케줄 보기, 그리고 "다음 세미나" 칩. 라이브 시작은 `onSetLive(true)`를 호출한다.
- **`live`일 때 룸**: 비디오 그리드(자기 타일은 `getUserMedia` 사용; 타인은 아바타 타일), 발표자 스포트라이트, 컨트롤 바(마이크/카메라/공유), 그리고 **종료**(라이브 종료 → `onSetLive(false)`, 트랙 중지, 홈 복귀)와 **나가기**(종료하지 않고 퇴장)가 있는 헤더.

### 설정/프로필 (screens-main.jsx → ProfileScreen)
프로필 필드, 알림 토글, 테마, 법적 링크.

## 인터랙션 & 동작

- **내비게이션**: 어디서나 `onNavigate(screen, params)`; 브레드크럼과 사이드바 모두 호출한다.
- **토스트**: 가벼운 확인을 위한 `onToast(message)`.
- **라이브 라이프사이클**: 빈 상태 → 라이브 시작하기 → 룸; 종료는 전역적으로 끝낸다(배너 + 배지 제거). 이는 앱 레벨 상태이므로 모든 표면이 일관성을 유지한다.
- **스케줄 편집**: 편집 모드에서는 달을 변경할 수 없다(토스트가 경고). 저장하면 순번 포인터가 전진하여 다음 계획 월이 순서를 이어간다.
- **섹션별 노트**: 낙관적 로컬 추가; `CURRENT_USER`로 작성자 표기.
- **업로드 모달**: **PDF 전용**(드래그앤드롭 또는 arXiv URL). 이전의 PPTX/MD 타입과 "아이디어 메모 / 빈 노트" 단축은 의도적으로 제거되었다.

## 상태 관리 (서버 측에서 모델링할 것)

- `papers` + `analyses`(연구/재구현 구조화 필드, 페이지 참조 및 해석이 있는 figure들)
- `{paperId, sectionId, lens, author, title, body}`로 키잉되는 `sectionNotes`
- `presentations` + `comments`(스레드형, @멘션, 반응)
- `{year, month}`로 키잉되는 `schedule` → weeks `[{week, date, time, presenter, topic, confirmed, status, presId}]`; 순번 포인터
- `fines`(presenterFine, absentFine) + 멤버별 출석/납부 장부
- `team` 멤버 + 역할 + 대기 중인 초대
- `liveSession`(단일 boolean/객체: active, presenter, participants)

## 디자인 토큰

모든 토큰은 `src/styles.css`에 CSS 커스텀 프로퍼티(`:root` + `[data-theme="dark"]`)로 존재한다. 정확한 값은 거기서 가져온다 — 주요 계열:

- **색상**: `--accent`(따뜻한 테라코타/오렌지, 브랜드 액센트), `--accent-soft`, `--accent-faint`; 표면 `--bg`, `--bg-subtle`, `--bg-elevated`, `--bg-active`, `--bg-hover`; 텍스트 `--fg`, `--fg-muted`, `--fg-subtle`, `--fg-faint`; `--border`, `--border-strong`; 상태 `--online`, `--busy`. 역할/상태 배지는 `oklch(...)` 틴트를 사용한다(예: 게스트 배지, 벌금 점). 다크 테마 오버라이드 포함.
- **반경(Radius)**: `--r-xs`, `--r-sm`, `--r-md`, `--r-lg`.
- **그림자**: `--shadow-lg`(메뉴/팝오버).
- **타입**: UI는 시스템 산세리프, 날짜/시간/숫자/코드는 `--font-mono`. 제목 `.h1`/`.h2`; 본문 13–14px; 작은/메타 11–12px.
- **간격**: 4px 기반; flex/grid에 `gap` 사용.

## 에셋

- **아이콘**: `<Icon name="…" />` 컴포넌트(인라인 SVG 세트) — 곳곳에서 참조되는 이름들(`video`, `play`, `calendar`, `users`, `sparkles`, `download`, `plus`, `x`, `chevron-*` 등). 사용하는 아이콘 라이브러리에 매핑(Lucide가 거의 전부 커버).
- **아바타**: `<Avatar user={…} />`를 통한 이니셜/색상 타일 생성.
- **Figure**: PDF에서 추출된 figure를 대신하는 `<image-slot>` 플레이스홀더(`src/image-slot.js`).
- 외부 브랜드 에셋 없음; 유일한 브랜드 마크는 텍스트 워드마크 "하박조팽".

## 파일들 (src/ 내)

- `index.html` — 엔트리; React 18.3.1 + Babel standalone를 로드한 뒤 아래 모든 JSX/JS 로드.
- `styles.css` — **모든** 스타일링 + 디자인 토큰.
- `data.js` — 목 데이터 + `window` 전역 + `find*` 헬퍼(형식화할 데이터 모델).
- `app.jsx` — 라우터, 앱 레벨 상태(`live` 포함), 화면 switch.
- `shell.jsx` — 사이드바 + 상단바.
- `screens-auth.jsx` — 로그인/히어로.
- `screens-main.jsx` — 대시보드, 라이브러리, 팀, 프로필.
- `screens-detail.jsx` — 논문 상세, PresentationView, 업로드 모달.
- `analyzer.jsx` — **AnalysisView**(관점, 섹션, figure, 섹션별 노트).
- `screens-presentations.jsx` — 발표 자료 목록.
- `screens-schedule.jsx` — 스케줄(빈/편집/확정 + 벌금 + 순번 + 통계).
- `meeting.jsx` — 세미나 라이브(빈 상태 + 룸).
- `legal.jsx` — 약관/개인정보 페이지.
- `image-slot.js` — figure 플레이스홀더 웹 컴포넌트.
- `tweaks-panel.jsx` — 디자인 탐색 전용; **포팅하지 말 것**.

제품 명세는 `PRD.md`를, 단계별 플로우는 `UX_FLOWS.md`를 참조한다.
