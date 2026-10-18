# 페이지별 durable 준비와 권한

공유 준비 함수는 inspect step → 페이지별 OCR step → cache 확정 step을 직접 조율한다. 그 함수 자체를 다른 step.run 안에 넣지 않는다. PDF 바이트는 durable checkpoint에 저장하지 않는다. 매 페이지는 현재 팀·자료·멤버십·작업·grant와 PDF digest를 다시 확인하고, 다운로드와 OCR에 실행 시간 예산을 나눈다. 서명 URL 요청에도 같은 abort signal을 전달한다.

업로드 준비, 명시적 논문 분석, 채팅의 논문·발표자료가 같은 경로를 사용한다. 분석은 준비된 캐시를 읽어 기존 strict 인용·캡션 검증을 유지한다. 채팅은 준비 시작/확정의 기존 버전·grant CAS를 보존한다. 취소·만료·자료 변경·다른 팀·이전 캐시가 새 작업을 큐에 넣거나 새 원문을 덮지 못한다. OCR 소유 오류 코드는 step 직렬화를 거쳐도 유지하고 그 밖의 native 오류는 일반 안내로 처리한다.

GET 상태 조회가 native figure renderer를 즉시 import하지 않게 하며, 실제 렌더 후처리의 실패 격리는 유지한다. OCR로 읽은 원문은 상태의 derived sourceHasOcr와 기존 화면 한 줄로 구분한다.

AC는 일회용 SQLite 전체 회귀다. 운영 DB와 .env를 읽거나 변경하지 않는다.
