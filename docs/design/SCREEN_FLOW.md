# 화면 전환 · 상태 (Screen Flow)

> 화면별 구성은 [`./SCREENS.md`](./SCREENS.md), 사용자 조작 흐름은 [`../user/USER_FLOW.md`](../user/USER_FLOW.md), 시스템 시퀀스는 [`../dev/SEQUENCE_DIAGRAM.md`](../dev/SEQUENCE_DIAGRAM.md)다. 이 문서는 **화면 간 내비게이션 맵과 화면별 조건부 UI 상태**(디자이너 관점)를 다룬다.

## 내비게이션 맵

```
auth ──(로그인)──> [onboarding] ──> app 셸
                                      │
   ┌──────────────┬─────────────┬─────┴───────┬──────────┬──────────┐
 dashboard      library      presentations   schedule    team     meeting   profile
   │ ＋업로드      │ row클릭      │ 항목클릭        │ 액션      │          │          │
   ▼              ▼             ▼               ▼          │          │          │
UploadModal     paper       presentation    (입장)→meeting │          │          │
   │                                                       │          │          │
   └──(분석완료)──> paper                                   └─ 자료 ──> presentation
```

- 모든 전환은 `onNavigate(screen, params)`. params 예: `{paperId}`, `{presId}`.
- 명령 팔레트 `Cmd/Ctrl+K`로 어디서나 검색/이동.

## 앱 레벨 상태가 좌우하는 표면

`live`는 화면이 아니라 **앱 레벨**에 있다(ADR-001). 한 곳에서 바뀌면 세 표면이 동시에 일관되게 반응한다.

| `live` | 사이드바 `meeting` | 대시보드 | meeting 화면 |
|---|---|---|---|
| `false` | LIVE 알약 없음(count 표시) | 배너 없음 | 빈 상태 |
| `true` | 깜빡이는 LIVE 알약 | 최상단 LIVE 배너 | 룸 |

## 화면별 상태 머신

### meeting
```
live=false  ─[라이브 시작하기]→ (생성 중…) ─성공→ live=true (룸)
                                            └─409(이미 진행 중)→ "입장할까요?" → 합류
live=true   ─[종료]→ 확인 다이얼로그 → live=false + 홈 복귀 (전체 종료)
live=true   ─[나가기]→ 본인 퇴장 (live 유지)
룸 안: 연결 끊김 → "다시 연결 중…" 배너 → 자동 재연결 (실패 시 재입장 CTA)
```
- **로딩:** 시작은 즉시 룸 진입, 플레이어 버퍼링은 룸 안에서. **에러:** 동시 시작은 409→입장 안내(파괴 아님).
- **모션:** LIVE 깜빡임(`livepulse`)은 `prefers-reduced-motion`에서 정적 배지로.

### schedule (월 보드)
```
        weeks==null ──[일정 짜기]──> editing(초안)
            ▲                            │
   [수정]   │                     ┌──[취소]──┐
            │                     ▼          │
        confirmed(읽기전용) <──[저장]──── editing
```
- **빈/편집/확정** 3상태. 저장 시 순번 포인터 전진. **편집 중 월 이동 잠김**(토스트). 월 이동은 자동 생성 안 함 — 빈 달은 빈 채로(ADR-006).
- 행 상태→표시: `done`=완료·[자료] / `current`=●이번 주·[입장] / `upcoming`=발표예정·[미리보기].
- **취소 확인:** 초안 변경분이 있으면 [취소]가 "작성 중인 초안이 사라져요" 확인. **저장 에러:** 토스트 + 편집 상태 유지(입력 보존).
- **발표자 휴가(vacation):** 발표자 선택에 상태 배지, 순번 배정 시 건너뛰기 안내. 누가 빠지면 그 주는 수동 재배정.

### paper / AnalysisView
```
currentLens: research | repro      (상단 토글)
addingSec: null | <sectionId>      (한 번에 한 폼)
```
- 섹션 S에서 `+ 추가` → `addingSec=S` 인라인 폼 → [추가](검증) 후 작성자 노트 push, 폼 닫힘.
- 섹션 렌더 필터: `lens === (S==='figures' ? 'any' : currentLens)`. Figure 노트는 관점 공통.

### upload (모달)
```
idle ─(PDF drop | arXiv URL)→ uploading(진행률) → analyzing("읽는 중") → done → navigate('paper')
   ├─ 비-PDF/형식 오류 → idle + 인라인 에러("PDF만 올릴 수 있어요")
   ├─ arXiv URL 오류  → 인라인 에러("arXiv 주소를 확인해주세요")
   └─ 분석 실패        → 논문은 생성됨 → paper로 이동 후 "분석 못 끝냄 + 다시 분석"
```
PDF 전용. PPTX/MD·빈 노트 단축 제거(ADR-003). **업로드 성공 ≠ 분석 성공** — 분리해 처리(논문은 남고 분석만 재시도).

## 조건부 UI 치트시트

| 조건 | UI |
|---|---|
| `live === false` | meeting=빈 상태; 사이드바 LIVE 없음; 홈 배너 없음 |
| `live === true` | meeting=룸; 사이드바 LIVE 알약; 홈 LIVE 배너 |
| schedule `weeks == null` | 빈 상태 + 일정 짜기 |
| schedule `editing` | 편집 가능 행 + 취소/저장 바; 월 내비 잠김 |
| schedule saved & `!editing` | 읽기 전용 행 + 수정 |
| `addingSec === section.id` | 해당 섹션 인라인 추가 폼 |
| figure 섹션 | "PDF 추출" 배지; 노트 관점 공통 |
| role === guest | 앰버 배지 |
| upload | PDF 전용 드롭존 + arXiv URL |

## 빈 상태 원칙

정직한 빈 상태(DESIGN_GUIDE): 라이브 없음·빈 달은 비어 있는 그대로 보이고 **명확한 CTA 하나**만 둔다. 가짜 데이터로 채우지 않는다.

> **빈 상태는 셋 중 하나일 뿐이다.** 모든 데이터 화면은 **로딩(스켈레톤) / 빈 / 에러(다시 시도)**를 모두 정의한다. 빈 상태만 만들고 로딩·에러를 빠뜨리지 마라. 화면별 구체는 [`./SCREENS.md`](./SCREENS.md) §화면별 상태, 패턴은 [`./DESIGN_GUIDE.md`](./DESIGN_GUIDE.md) §UX 패턴.
