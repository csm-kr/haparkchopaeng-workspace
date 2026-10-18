# 자유 대화 운영 배포

사용자가 이전 세션에서 구현한 자료 없는 자유 대화까지 운영에 배포하도록 요청했다. 기존 `16-free-ai-chat`의 사용자 경험을 재사용하며 현재 main의 연결 번호 만료·Bri·트레이·라이브 세션 보정을 보존한다. 원본 작업 공간은 읽기 전용으로 유지하고 독립 worktree와 독립 의존성에서 선별 접합한다.

## 범위

- 자료 없이 개인 대화를 시작하고 완료된 이전 턴을 후속 질문의 서버 문맥에 포함한다.
- 질문마다 `@`로 현재 팀의 논문·발표 자료를 선택/변경한다. 과거 질문의 자료 스냅샷을 보존하며 기존 paperIds 배열도 읽는다.
- 자료 준비는 Inngest durable job에서 처리하고 준비·대기·실행·취소·권한 만료를 구분한다.
- 기존 연결기 0.1.2의 자료 없는 대화를 유지한다. 실제 모델의 지원 추론 강도를 읽어 전달하는 최소 코어 업데이트를 별도 preview로 검증·게시한다.
- 처음에는 실제 모델을 선택하되 같은 팀·기기의 대화 대상을 기억한다. 모델의 로그인·한도·목록 변경으로 사용할 수 없게 되면 전송을 차단하고 사용자가 명시적으로 다시 선택하게 한다. 다른 모델·CLI로 자동 전환하지 않는다.
- DB schema는 main을 보존한다. 자유 대화는 기존 Json/context/status 계약을 확장하며 DDL을 추가하지 않는다.

## 분담과 보존

- backend_audit: research-chat 서비스/자료/준비/worker/API/타입 및 본문 추출 옵션과 회귀.
- connector_audit: local-agent 서비스/검증/타입과 CLI adapter/effort 회귀.
- ui_baseline: 채팅·자료 선택·사이드바 연결 설정 및 화면 회귀.
- root: 정본 문서, 통합 하네스, 릴리즈, 운영 웹/Inngest 동기화, Aside와 실제 대화 검증.

`phases/18-ai-bridge-update`의 별도 미게시 후보, 원본 Git index, 삭제된 CLAUDE.md와 관련 없는 사용자 변경을 수정하지 않는다. 새 기능 테스트를 먼저 접합해 실패를 확인하고 구현을 접합한다. 실제 계정 추론은 명시적인 소량 운영 확인에 한정하고 fixture 검증과 구분한다.

## Acceptance Criteria

아래 명령은 별도 worktree에서만 순차 실행한다. 임시 SQLite 검증 중 build/Prisma 생성/다른 검증을 병렬 실행하지 않는다.

```text
node scripts/local-agent-verify.mjs all
node --test connector/test/*.test.mjs
node node_modules/next/dist/bin/next lint
node node_modules/next/dist/bin/next build
node scripts/local-agent-verify.mjs e2e
node scripts/local-agent-verify.mjs wire
```

`python scripts/execute.py 19-free-ai-chat-release --verify --step 0`으로 실제 exit code를 기록한다. 정확한 소스의 웹/PG16/Windows/macOS ARM/macOS Intel/Ubuntu CI와 preview 게시 보호 검증을 따른다. 운영 완료는 코드 통과와 구분해서 source SHA·Vercel READY·도메인·Inngest 함수 등록·공개 설치 파일·Aside 실제 UI와 대화 결과로 기록한다. 실패한 검증을 삭제하거나 기존 버전의 근거로 새 결과를 주장하지 않는다.
