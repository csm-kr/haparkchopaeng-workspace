# 스캔 PDF 읽기 검증

2026-10-18, 격리 작업 공간 `hapark-ai-pdf-reading`의 로컬 후보를 기록한다. 제품 소스는 동결했고 최종 전체 하네스·lint·production build를 통과했다. 원본 dirty 작업 공간·운영 DB·실계정 추론·배포를 이 문서 작업에서 실행하지 않았다. [ADR-030](../../docs/agent/ADR.md#adr-030)의 결정과 현재 실행 근거를 구분한다.

## 계약과 경계

- 추가 외부 AI API·API 키·CDN 호출 없이 서버에 동봉한 MuPDF·Tesseract와 영·한 언어 데이터를 사용한다. OCR child에는 고정 PNG만 전달하며 서버 자격증명과 임의 실행 경로를 넘기지 않는다.
- PDF 20MB, 논문 30쪽, 발표 자료 150쪽, 자료당 본문 120,000자다. 페이지 번호·PDF SHA256과 선택적 `method: "ocr"`를 보존한다. 정상 native 본문과 기존 캐시는 계속 읽는다.
- 검사 → 페이지별 OCR → 캐시 확정을 서로 다른 durable step으로 실행한다. 준비기 자체의 중첩 `step.run`과 PDF Buffer checkpoint 저장은 금지한다. 서명·다운로드는 같은 abort signal을 사용한다. 페이지 총 예산 50초에서 경과 시간을 빼 OCR에 최대 40초를 전달하며 child 종료 확인 시간을 별도로 확보한다.
- 각 페이지와 최종 적재에서 팀·멤버십·작업 상태·원본 경로/digest·기존 45초 grant를 확인한다. worker는 grant를 갱신하지 않는다. 분석 준비는 원래 생성 시각부터 10분이며 마지막 대기열 적재와 트랜잭션 잠금 대기 후에도 같은 상한을 적용한다.
- 캐시 CAS는 기존 본문·digest·PDF 경로를 포함한다. 채팅은 정렬된 자료 부모의 `id=id` key 잠금, 선택 asset 잠금, 최종 자료 조회, 작업 version/grant CAS를 동일 트랜잭션에서 묶는다. 새 Device/Membership 잠금이나 DDL을 추가하지 않는다.
- strict 인용·캡션 검증은 인식된 본문과 대조한다. 파싱 가능한 OCR 페이지가 있는 논문만 `sourceHasOcr=true`이며 과거 캐시 파싱 실패는 상태 조회 오류로 전파하지 않는다. Figure native 모듈의 동적 import·렌더 실패는 검증된 본문과 캡션 저장에서 격리한다.

## RED → GREEN 관측

1. native Figure 모듈 자체가 `ERR_DLOPEN_FAILED`로 로드되지 않는 합성 seam에서 실제 GET 분석 상태가 실패했다. 정적 import 제거 후 실제 GET JSON, POST 적재, 캐시 준비, Figure 유무·모듈 실패·정상 renderer 호출·없는 인용 거절을 검증했다.
2. 기존 분석 worker가 공통 준비기를 한 step 안에서 호출하는 경계에서 신규 회귀 1개가 RED였다. 준비기를 외부에서 조율하도록 바꿔 검사·각 OCR 페이지·캐시가 개별 재개되고 중첩되지 않도록 했다.
3. 실제 Inngest `StepError`는 원래 예외의 code/prototype을 보존하지 않았다. 소유 `PaperSourceError`만 고정 코드 envelope로 전달하는 회귀를 RED 후 GREEN으로 만들었다. 이름만 같은 일반 native 예외는 신뢰하지 않는다.
4. 서명 요청의 취소 신호 미전달로 새 5개가 RED, 기존 2개가 PASS였다. 요청별 admin 인스턴스에서 page·SDK init·Request 신호를 조합한 뒤 7개 모두 GREEN이다. 전역 fetch와 기존 무옵션 호출 동작은 유지했다.
5. `sourceHasOcr`가 없던 상태에서 신규 회귀 1개가 RED였다. OCR 캐시 true, native 캐시 false, 손상된 과거 JSON false를 함께 검증했다.
6. 최종 감사의 두 P2는 자료 확인 뒤 최종 select 사이의 논문/발표 PDF 교체 2개, 599초 본문 준비 후 601초 적재·잠금 대기 중 10분 초과 2개로 실제 RED였다. 원래 deadline 재검사와 마지막 자료 일치 검사 후 GREEN이 됐고, 동일 트랜잭션/source key 잠금이 없다는 추가 RED 1개도 수정했다. 독립 읽기 재감사는 두 P2 해소와 추가 P1/P2 없음을 보고했다.

## 현재 확인한 로컬 결과

- 최신 소유 범위: **Vitest 9 suites / 65 PASS**, 수정 6파일 `eslint --no-ignore` exit 0. 정확 명령·전체 로그·6파일 SHA는 [최종 P2 영수증](C:/Users/csm81/AppData/Local/Temp/hapark-pdf-source-p2-final-281n0jjl/receipt.json), [테스트 로그](C:/Users/csm81/AppData/Local/Temp/hapark-pdf-source-p2-final-281n0jjl/targeted.log), [lint 로그](C:/Users/csm81/AppData/Local/Temp/hapark-pdf-source-p2-final-281n0jjl/lint.log)에 있다. 이 경로들은 해당 개발 호스트의 임시 증거다.
- 이 65개에는 원본 변경·취소·만료·팀 범위·오래된 캐시, OCR 페이지의 시간 배분, Content-Length 없는 20MB 초과 스트림 거절, native 모듈 경계와 실제 route 계약이 포함된다. Prisma/Storage/OCR를 대체한 테스트의 PASS를 운영 DB나 실제 OCR 실행 증거로 해석하지 않는다.
- P2 이전의 60 PASS 및 TypeScript exit 0은 [이전 snapshot 영수증](C:/Users/csm81/AppData/Local/Temp/hapark-pdf-source-final-6a87jly0/receipt.json)에 분리 보존한다. **최신 P2 수정 이후의 전체 TypeScript·빌드·전체 Vitest 결과로 재사용하지 않는다.**
- 실제 MuPDF·동봉 Tesseract를 사용하는 합성 영·한 이미지 PDF, 혼합·빈 페이지, 제한/종료 검증은 [source OCR](../../lib/local-ai/__tests__/source-ocr.test.ts), [실제 OCR](../../lib/local-ai/__tests__/pdf-ocr-real.test.ts), [배포 dependency closure](../../lib/local-ai/__tests__/pdf-ocr-bundle.test.ts)에서 별도로 다룬다. 외부 모델 추론·실제 사용자 PDF의 검증은 수행하지 않았다.

## 최종 하네스·배포 대기

부모 최종 하네스 재실행에서 source/OCR 6 suites·31 PASS, 격리 SQLite 포함 전체 144 suites·1,167 PASS를 확인했다. PostgreSQL 전용 16개는 전용 CI에서만 실행한다. Chromium은 12 PASS, 실제 HTTP 서버·데스크톱 런타임의 연결·질문 결과·취소·로그아웃·쿠키 소멸 검증도 PASS다. 신규 SQLite fixture의 파일 크기 타입을 String으로 수정한 뒤 다시 실행한 결과이며, 제품 코드의 기존 검증을 생략하지 않았다. 소유 테스트 DB와 Prisma 클라이언트는 검증기가 정상 복구했다.

이 수치는 `step1-output.json`, `step2-output.json`, `step3-output.json`의 최종 로컬 영수증이다. 전체 16개 skip은 PostgreSQL 전용 경계를 의미하며 실제 PG 통과로 합산하지 않는다. 이후 lint와 production build도 exit 0이었다. 실제 Next `/api/inngest` 함수의 NFT 파일 목록에 OCR 실행 코드와 전이 의존성·두 언어 데이터·MuPDF WASM 67개가 모두 포함되는 것을 확인했다. 전체 추적 파일은 365개, 104,496,594 bytes다. 영수증은 `%TEMP%/hapark-pdf-release-20261018/{quality.json,runtime-trace.json}`이며, 원격 CI와 운영 OCR은 별도 인수 항목으로 남긴다.

- 최종 전체 하네스 수치는 바로 위 재실행 결과를 따른다. 이전 전체 snapshot의 통과 수를 재사용하지 않는다.
- [격리 분석 DB 회귀](../../lib/local-agent/__tests__/analysis.integration.test.ts)에는 실제 grant 만료, OCR 페이지 전 취소, 최신 캐시 CAS 보존이 있다. [채팅 DB 회귀](../../lib/research-chat/__tests__/service.integration.test.ts)에는 준비 완료/version CAS·grant 불변·취소/만료와 **verify 직후 실제 PDF 교체**를 추가했다. 실제 실행은 최종 격리 SQLite 하네스 결과로 확인해야 한다.
- [PostgreSQL 16 회귀](../../lib/local-agent/__tests__/postgres.integration.test.ts)는 전용 loopback DB/CI guard를 유지한 **16개**다. 새 case는 부모 key 잠금 동안 첫 PDF의 FK 삽입이 대기하고 queue CAS 커밋 후에만 진행하는지를 실제 PG에서 확인한다. 이 호스트에서는 guarded suite가 생략됐으며 해당 case의 PG 성공을 아직 주장하지 않는다.
- 정확 소스의 원격 CI, Vercel runtime OCR 파일 포함 여부, Inngest 함수 동기화·단계 재개, 운영 PDF 상태 조회 및 스캔 본문 준비는 별도 릴리스 인수 대상이다. 새 DDL·연결 앱 설치 파일·공개 릴리스를 이 변경의 필수 단계로 추가하지 않는다. **이 기록은 배포 완료 보고가 아니다.**
