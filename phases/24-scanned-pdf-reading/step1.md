# 스캔 원문과 오프라인 OCR

기존 20MB·논문 30쪽·발표자료 150쪽·본문 12만 자 상한과 페이지 번호·PDF digest를 유지한다. 짧은 정상 텍스트는 읽을 수 있어야 한다. native text가 빈약한 페이지를 검사하고, 필요한 페이지만 MuPDF로 제한된 픽셀 수로 렌더한 뒤 고정 버전 Tesseract의 영·한 언어 데이터로 인식한다.

OCR은 고정 서버 소유 child에서 수행한다. stdin은 PNG, stdout은 bounded text/confidence JSON이며 서버 비밀과 Node 사용자 설정을 전달하지 않는다. CDN·외부 AI API·임의 URL/로컬 경로·CLI 도구 실행을 추가하지 않는다. 시간 초과·취소 때 원래 child handle로 종료를 확인하고 소유 임시 디렉터리를 정리한다. native 오류·경로는 사용자에게 노출하지 않는다.

이미지 전용 영·한 PDF·혼합 PDF·짧은 native text·빈 PDF·digest 불일치·페이지/크기/시간 상한·실제 child 종료·오프라인 배포 파일을 TDD로 검증한다. OCR의 source metadata는 기존 캐시와 하위 호환되며 인용 검증을 우회하지 않는다.

AC는 index.json의 source/OCR 네 suite와 실제 worker dependency closure 검사다. 테스트 fixture는 합성 자료만 사용한다.
