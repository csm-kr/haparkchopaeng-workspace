# Phase 20 검토 기록

검토 범위는 이번 목표 작업 기반과 기존 UI 공통 쓰기에 한정한다. 작업 시작 이전의 다른 변경은 보존했다. 운영 DB·웹·설치 파일을 배포하지 않았다.

## 발견 후 수정한 문제

1. 이전 tick의 실패 처리가 조건 변경 후 새 revision을 실패 상태로 덮을 수 있었다. 오류 저장에 revision/version CAS를 추가했다. Inngest 이벤트·실패 처리·재조정에도 revision을 결속하고 이전 이벤트의 새 추론을 막았다. `race-red.log`, `event-red.log`와 workflow 회귀 테스트로 확인한다.
2. 개인 작업의 대화를 바꾸는 순간 이전 작업이 effect 정리 전에 한 프레임 표시됐다. 현재 화면 범위를 render 시점에 대조하고 늦은 응답을 generation으로 폐기한다. `scope-red.log`, `task-scope.test.tsx`에 재현·회귀를 남겼다.
3. 텍스트 슬라이드 초안이 준비됐다는 사실만으로 발표 자료 등록 완료를 표시하지 않도록 분리했다. 등록은 정확한 검토 입력과 버전을 받아 한 번 커밋하고, 별도 DB 조회가 일치할 때만 확인 완료다.

## 정본 대조

- 서버/API 경계: 클라이언트는 private DTO와 편집 입력만 다룬다. 쓰기 scope는 세션·활성 팀에서 주입하고 자료·도구·권한·원문은 서버가 재검증한다.
- 장기 작업: 생성 요청은 202 후 반환한다. PDF 준비·여러 모델 단계는 Inngest가 실행하며 CLI는 기존 claim/result를 사용한다.
- 권한: 기존 45초 grant를 자동 연장하지 않는다. 이력 조회, 접수 완료 결과의 개인 검증, 새 행동·공유 저장을 구분한다.
- 도메인: 기존 두 관점과 공통 Figure·작성자를 유지한다. 일정 row나 라이브 세션을 생성하지 않는다. 세미나 원문 관계는 팀 확인 후 연결하고 조회 시에도 원문 팀을 대조한다.
- 실행: 읽은 페이지 인용, strict JSON, 읽기/추론/시간 예산, 한 번의 형식 복구, 무진전 제한, 취소·조건 변경·재개를 적용한다.
- 공유 저장: task 잠금, 고유 operation, 최신 원문 잠금·검토 내용·공유 객체의 원자 커밋, 별도 재조회로 중복과 허위 완료를 막는다.
- 호환: capability 없는 구형 브릿지는 일반 채팅/분석을 유지하고 agent_step은 거절한다. 웹 기능 플래그 기본값은 0이다. 새 웹 이전에 additive SQL 적용이 필요하다.

## 검증 기록

각 단계의 실제 명령·종료 코드·출력은 `stepN-output.json`, 상태는 `index.json`이 정본이다. 다음 검증을 완료했다.

| 검증 | 실제 결과 |
| --- | --- |
| 전체 앱 Vitest, 일회용 SQLite | 926 통과, PostgreSQL 전용 15개 건너뜀 |
| 목표 작업·연결·채팅 단위/통합 subset | 227 통과, 위 전체 앱 검사와 중복 포함 |
| 브릿지 Node 테스트 | 211 통과 |
| 격리 Chromium E2E | 15 통과. 노트·세미나 390px/1280px 흐름 포함 |
| 실제 HTTP + 브릿지 runtime 계약 | 1 통과. pairing·결과·취소·로그아웃·cookie loss |
| 일회용 검증기 guard | 5 통과 |
| 기존 PostgreSQL guard, 실제 DB 미접속 | 10 통과 |
| Python 하네스 | 60 통과 |
| Next lint / production build | 통과 |

첫 production build는 webpack FileSystemInfo/WasmHash 내부 오류로 실패했다. 기존 `.next`를 작업공간의 `node_modules/.cache/hapark-build-before-20261018224255`에 보관한 뒤 새 캐시에서 빌드가 통과했다. 실패 발췌는 `build-cache-failure.txt`에 기록했다. 소스 변경이나 기존 캐시 삭제로 우회하지 않았다.

## 범위와 남은 검증

- 새 SQL은 Prisma의 오프라인 스키마 차이로 생성했다. 이번 호스트에서 새 SQL을 실제 PostgreSQL에 적용한 검증은 아직 하지 않았다. 기존 PG guard 검사와 SQLite 테스트를 PostgreSQL 동시성 검증으로 간주하지 않는다.
- 모델 결정은 격리 workflow의 제어된 응답으로 검사했다. 새 목표 작업의 실제 Codex/Claude 추론 품질과 실제 PC 설치본·Inngest 운영 연동은 이번 검증에 포함되지 않는다.
- 렌더된 E2E 화면은 390px·1280px에서 확인했지만 새로운 전용 PT 제작·Grilling 화면은 아직 없다. 현재 진입점은 AI 채팅이며 텍스트 슬라이드 초안만 다룬다.
- 논문 Figure 배치, 대화형 기획·수정, HTML/PDF/PPTX 제작·내보내기는 [PT 제작 설계](../../docs/design/PAPER_PT_WORKSPACE.md)의 후속 범위다. 사용자의 추가 요구를 기록했으며 이 phase의 완료를 전체 요구 완료로 보고하지 않는다.
