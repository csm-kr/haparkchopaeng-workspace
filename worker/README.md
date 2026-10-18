# worker/

논문 본문 준비·로컬 모델 분석 후처리를 요청 경로와 분리하는 Inngest 함수다(ADR-013→016→026). 등록은 `app/api/inngest/route.ts`, 본체는 `analyze-paper.ts`와 `lib/local-ai/`다.

`paper/analyze`는 두 경로를 구분한다.

- 업로드의 `{paperId}`는 PDF 페이지별 텍스트와 SHA256만 준비한다. AI 호출은 없으며 새 업로드는 준비 완료 후 `Paper.analysisStatus=awaiting_ai`로 기다린다. 기존 분석 논문의 `/api/research-chat/sources` 요청도 이 준비 경로를 재사용하되 저장된 분석 결과·상태를 유지한다. 원문은 1~30쪽·본문 12만 자, PDF 입력 20MB까지다. 읽을 수 없는 스캔·초과·손상은 원본을 보존하고 실패로 안내한다.
- 사용자가 PC·실제 모델을 선택한 `{paperId,runId}`는 `Job(type=prepare_local_analysis)`을 읽어 서버 context와 `LocalAgentJob(purpose=paper_analysis)`을 준비한다. CLI는 승인한 PC에서 실행한다. Inngest는 5초 durable sleep과 짧은 상태 조회로 최대 약 10분 대기하며 HTTP 요청/메모리 Promise를 붙잡지 않는다. 완료 결과의 JSON·페이지·원문 인용·Figure 캡션을 검사하고 최신 `Paper.analysisRequestId` CAS로 두 관점·Figure·상태를 저장한 뒤 완료를 알린다.

유효한 45초 grant 중 서버가 이미 `completed`로 접수한 결과는 로그아웃 후에도 검증·렌더·저장을 마칠 수 있다. 새 추론·계속 실행·미접수 결과는 기존 grant 규칙대로 차단하며 워커가 grant를 연장하지 않는다. 최종 분석 저장 시 현재 멤버십도 재검증한다. Gemini나 다른 제공자로 자동 전환하지 않는다.

현재 CLI는 텍스트 전용이다. Figure 이미지는 원문 PDF 페이지를 렌더하고 해석은 본문·캡션 기반 추론으로 표시한다. 외부 저장소 방문·검증은 하지 않는다. 연구 채팅은 별도 `/ai-chat`과 동일 로컬 큐를 사용하고 논문 관점·공유 노트를 자동 변경하지 않는다.

검증은 격리 런처 `npm run test:local-agent` 또는 `npm run test:isolated`를 사용한다. 소스 `3f16685`의 [CI](https://github.com/csm-kr/haparkchopaeng-workspace/actions/runs/39033348260)에서 웹 946개·실제 PostgreSQL 13개·Chromium 8개·HTTP 계약을 통과했다. 운영 SQL은 아직 미적용이다. [검증 HTML](../docs/reports/local-ai-research-chat-2026-10-17.html), [API](../docs/dev/API.md), [스키마·수동 적용](../docs/dev/DB.md#local-ai-schema), [ADR-026](../docs/agent/ADR.md#adr-026)을 따른다.
