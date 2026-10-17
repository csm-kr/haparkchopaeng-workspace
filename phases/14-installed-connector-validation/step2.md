# 실제 OS 근거와 공통 repo 반영

`step0.md`와 `step1.md`를 마친 뒤 해당 커밋의 CI를 확인한다. 실패는 실제 원인을 해결하고 같은 검증을 다시 수행한다.

- 제품 repo와 공통 repo의 관련 core·설치 검증을 동기화하고 각각의 CI를 확인한다.
- `connector/VALIDATION.md`, `docs/dev/LOCAL_AGENT_RELEASE.md`에 설치 앱·OS URI·제거의 관측 결과와 미검증 범위를 남긴다.
- 필요하면 보고서에 새 근거를 추가하되 기존 캡처·과거 검증을 덮어쓰지 않는다.
- 자동화 변경의 AC: `python -X utf8 -m pytest scripts/test_execute.py -q`.
- 운영 DB·서명·공증·정식 다운로드·운영 웹은 사람 검토와 실제 근거가 있기 전에는 완료로 기록하지 않는다.
