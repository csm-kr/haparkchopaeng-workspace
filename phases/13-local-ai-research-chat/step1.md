# Step 1: 웹 흐름과 배포 후보 독립 검토

이전 산출물은 [step0.md](step0.md), [API 계약](../../docs/dev/API.md), [운영 적용 순서](../../docs/dev/LOCAL_AGENT_RELEASE.md), [추가 SQL](../../docs/dev/sql/20261017-local-ai-research-chat.sql), `lib/local-ai`, `lib/research-chat`, `components/research-chat`다.

## 검토 범위

- 변경한 논문 분석 버튼과 AI 채팅을 기존 디자인 토큰·연결 상태·작은 사용량 링에 맞춘다. 기본 모델을 자동 선택하지 않는다.
- 실제 Chromium에서 기존 연결 흐름 4개와 새 채팅 3개·분석 1개를 검증한다. 새 답변은 고정 fixture이며 실제 CLI 추론 성공으로 표시하지 않는다.
- 전용 CI PostgreSQL 16의 실제 동시성 검증과 연결기 SQL → 연구 채팅 SQL 적용 후 drift 0을 확인한다. 운영 DB에는 연결하지 않는다.
- 기존 연결기 3 OS native·설치 빌드의 경계와 이번 웹 변경의 증거를 구분한다. 코드 서명·macOS 공증·공개 다운로드·실제 사용자 설치·운영 웹 연결은 별도 완료 조건이다.
- 독립 에이전트가 권한, 동일 요청 멱등성, 취소·실패 복구, 문서와 구현의 일치를 검토한다.

## Acceptance Criteria

```text
node --test scripts/local-agent-verify.test.mjs scripts/local-agent-pg-guard.test.mjs
python -m pytest scripts/test_execute.py -q
```

최종 소스 커밋의 GitHub Actions 전체 검증이 끝난 뒤 해당 `gh run watch <run-id> --repo csm-kr/haparkchopaeng-workspace --exit-status`를 `index.json`의 checks에 추가하고 `python scripts/execute.py 13-local-ai-research-chat --verify --step 1`로 결과를 기록한다. 실패한 run을 최종 통과로 인용하지 않는다.

## 운영 경계

두 검토 SQL은 ADR-020·022·025에 따른 수동 검토·적용 대상이다. 이 단계에서 운영 reset·db push·seed·정식 설치 파일 배포를 실행하지 않는다. 이유: 개발 후보 검증과 운영 데이터 변경은 별도 절차이며, 현재 설치 파일은 서명되지 않은 검증본이다.

완료는 PR 배포 후보 검증 범위를 의미한다. 운영 배포와 전체 goal 완료는 별도 기록한다.
