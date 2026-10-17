# Step 4: integrated-quality

이전 산출 코드 전체와 검증 결과를 읽고 독립 리뷰 findings를 수정한다. 전체 기존 테스트를 일회용 SQLite DB에서 실행하고 lint/build를 통과한다. 서버와 앱의 DTO/인증/취소/네트워크 복구를 실제 경계에서 확인한다.

AC:
`node scripts/local-agent-verify.mjs all`
`node node_modules/next/dist/bin/next lint`
`node node_modules/next/dist/bin/next build`

기존 실패를 숨기기 위해 테스트를 삭제하거나 공유 운영 데이터를 재시드하지 마라. 검증하지 않은 실 OS 동작을 완료로 보고하지 마라.
