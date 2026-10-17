# 로컬 AI 연구 보조: 범위와 실행 계약

사용자는 기존 API 논문 요약을 연결한 Codex·Claude Code로 대체하고 별도 채팅 탭을 요청했다. ADR-011의 실행 제공자와 ADR-025의 기존 Gemini 유지 범위를 이 요청에 맞게 개정한다. 논문 상세의 연구/재구현 두 관점과 공통 Figure는 유지한다.

## 구현 범위

1. PDF 업로드는 원문을 저장하고 외부 Inngest 잡으로 페이지별 텍스트를 준비한다. 연결·실제 모델을 사용자가 선택한 뒤 로컬 분석을 요청한다. 기존 API 자동 추론은 중단한다.
2. 서버가 검증한 원문만 로컬 DB 큐에 넣는다. 연결기는 기존 제한 CLI 실행을 그대로 사용한다. JSON 결과는 스키마·페이지 검증과 최신 실행 CAS를 통과한 뒤 두 관점으로 저장한다.
3. `/ai-chat`은 개인 대화 이력, 같은 팀 논문 1~3개, 실제 모델 선택, 요약·비교·재현 계획·세미나 질문, 부분 응답·취소·실패·재연결을 제공한다. 실행 권한과 이전 로그인 대화 조회 권한을 구분한다.
4. 도구가 없는 텍스트 실행이다. 그림 픽셀·외부 검색을 수행한 것처럼 표시하지 않는다. Figure 설명은 본문·캡션 근거임을 밝히고 원문 페이지로 확인한다. 팀 노트나 분석을 채팅이 자동 덮어쓰지 않는다.

## 공개 검증 경계

- PDF 원문 추출: 실제 합성 PDF의 페이지 참조·텍스트, 스캔/손상/길이 한도.
- 분석 요청/결과: 인증·활성 팀·실제 모델, 즉시 접수, API 호출 0, 중복 요청·이전 결과 거절, 스키마 실패, 성공 저장·취소·45초 권한.
- 대화 REST: 타인/다른 팀 차단, 영속 이력, 서버 context, 동일 요청 멱등성, 대화당 동시 실행 1개, 취소·새 세션 권한.
- 사용자 화면: 무선택·연결·원문 준비·대화 전송/부분 응답/취소/복구·작은 화면.

각 경계에서 실패 테스트를 먼저 실행하고 통과 구현을 이어 간다. 테스트 실행은 임시 SQLite/CI PostgreSQL에 한정한다. 운영 SQL은 기존 수동 적용 절차를 따른다.

## 역할

- root: 정본 schema, 원문/구조화 분석/외부 잡/업로드·분석 진입, 통합 검증·보고서.
- backend_audit: 큐 공통 입장 검증·서버 준비 context·개인 대화 서비스/API와 회귀.
- ui_baseline: UI 설계, 채팅 탭·RSC·클라이언트·접근성·회귀.
- connector_audit: 공통 연결기 소비자 검증 후 독립 통합 리뷰.

앞 단계 산출물은 `phases/12-local-agent-connection`, `lib/local-agent`, `connector`, `components/local-agent`다. 공통 CLI 코어와 OS 설치 검증 근거를 재사용하되 새 기능의 검증 결과로 혼동하지 않는다.

## Acceptance Criteria

아래 명령을 순서대로 실행한다. 첫 명령은 외부 환경 변수를 제거하고 임시 SQLite를 만들며 종료 시 기존 Prisma client를 복원한다. 검증 중 다른 build·Prisma 생성·로컬 서버를 동시에 실행하지 않는다.

```text
node scripts/local-agent-verify.mjs all
node node_modules/next/dist/bin/next lint
node node_modules/next/dist/bin/next build
```

`python scripts/execute.py 13-local-ai-research-chat --verify --step 0`으로 실제 exit code와 출력을 기록한다. PostgreSQL 동시성 테스트는 이 명령에서 명시적으로 건너뛰고 다음 단계의 격리 PostgreSQL 16 CI에서 실행한다. 실제 CLI가 논문 전체를 분석한 성공이나 운영 DB 적용으로 해석하지 않는다.

별도 수동 검증의 [실제 Codex 기록](../../docs/reports/evidence/local-analysis-codex-20261017.json)은 자체 제작 2쪽 PDF만 사용했다. 최초 두 응답은 strict 형식 검증에서 거절됐다. 실제 validator에서 파생한 출력 스키마를 모델에 전달하도록 수정한 다음 한 응답은 두 관점·페이지별 원문 인용 검증을 통과했다. 총 3회 중 성공 1회이며 자동 재시도·원격 API fallback·운영 DB·외부 이벤트는 0이다. 이 결과는 실제 출판 논문의 정확도·Claude 구조화 분석·운영 브라우저→연결기 전체 흐름의 검증을 대신하지 않는다.
