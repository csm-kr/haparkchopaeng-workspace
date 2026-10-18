# Step 1: session-authority

관련 코드: `types/local-agent.ts`, `lib/local-agent/PROTOCOL.md`, `lib/auth.ts`, `lib/local-agent/**`, `app/api/local-agent/**`, `prisma/schema.prisma`.

활성 팀·멤버·웹 로그인 세션에 묶인 기기 권한을 구현한다. 웹만 45초 권한을 갱신하며 앱 heartbeat는 연장할 수 없다. 로그아웃·팀 전환은 즉시 회수하고, 쿠키 유실은 lease 만료로 중단한다. 새 세션은 반드시 새 번호를 확인한다. 6자리 번호는 웹에만 표시하고 앱은 빈 입력으로 시작한다. 만료·잘못된 번호 5회·한 번 소비·동시 요청·뒤늦은 ACK를 검증한다.

논문 질문은 서버에서 논문 팀 소유와 CLI가 실제 광고한 모델을 검증하고 durable DB 큐에 적재해 즉시 202 응답한다. claim/result/cancel을 매번 권한 검사한다. 비밀·원본 인증 파일은 전송하지 않는다.

AC: `node scripts/local-agent-verify.mjs unit`

운영 DB에 schema를 자동 적용하지 마라. 구독 한도를 남은 토큰 수로 표시하지 마라.
