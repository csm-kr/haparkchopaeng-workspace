# Step 4: web-cli-panel

## 읽어야 할 파일

**정본은 루트 `README.md` · `CLAUDE.md` · `PRD.md`이며, 충돌 시 이를 따른다.**

- `docs/design/DESIGN_GUIDE.md`, `docs/design/AI_CONNECTION_CONTROLS.md`, `docs/agent/ADR.md`(ADR-034), `docs/agent/RULES.md`(R26 로딩·빈·에러)
- `components/local-agent/connection-modal.tsx` — `ConnectedControls`
- `components/local-agent/client.ts`, `components/local-agent/provider.tsx`
- `components/local-agent/__tests__/connection-controls.test.tsx`, `tests/e2e/local-agent.spec.ts`
- step 1·2의 API: `POST /api/local-agent/devices/:id/terminal`, `GET /api/local-agent/jobs?active=1`

## 작업

TDD(Vitest + RTL)로 진행한다.

1. `client.ts`: `openTerminal(deviceId, provider): Promise<LocalAgentTerminalRequest>`, `activeJobs(): Promise<LocalAgentActiveJobView[]>`. 기존 test double들에 메서드를 추가한다.
2. 연결 창 `ConnectedControls`
   - 선택한 도구 탭 안에 `{도구} 터미널 열기` 버튼. `device.bridgeCapabilities`에 `terminal_v1`이 있고 해당 도구가 설치돼 있을 때만 보인다. 누르면 "연결된 PC({기기명})에서 터미널을 여는 중이에요. 몇 초 안에 열려요."를 상태로 알린다. 409 `CONNECTOR_UPDATE_REQUIRED`·`PROVIDER_NOT_INSTALLED`는 각각 안내 문구로 보인다.
   - capability가 없는 연결된 앱에는 버튼 대신 "터미널 열기는 AI 브릿지 0.1.13부터 쓸 수 있어요." 한 줄을 보인다.
   - 탭 아래 "실행 중인 작업" 영역: 창이 열려 있는 동안 5초마다와 포커스 복귀 시 `activeJobs()`를 조회한다. 로딩·빈("지금 실행 중인 작업이 없어요.")·에러(다시 시도) 상태를 갖는다(R26). 행: 종류·도구·모델·상태, `href`가 있으면 "열기" 링크, `canCancel`이면 "멈추기"(`cancelJob`) 버튼.
3. 작성 중인 대화·모델 선택을 바꾸지 않는다(기존 연결 창 규칙).

## Acceptance Criteria

```bash
NODE_OPTIONS=--no-experimental-webstorage npx vitest run components/local-agent
NODE_OPTIONS=--no-experimental-webstorage npm run test:e2e -- tests/e2e/local-agent.spec.ts
npx tsc --noEmit
npm run lint
```

## 검증 절차

AC 실행 → 360px·1440px에서 연결 창이 가로로 넘치지 않는지 E2E로 확인 → index.json step 4 갱신.

## 금지사항

- 연결 창을 연 것만으로 터미널 요청을 보내지 마라. 이유: 사용자가 누른 경우에만 PC에 창이 떠야 한다.
- 다른 PC 목록에서 터미널 대상을 고르게 하지 마라. 이유: 현재 연결 기기만 실행 대상이다(AI_CONNECTION_CONTROLS).
