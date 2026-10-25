# Step 3: desktop-terminal-request

## 읽어야 할 파일

**정본은 루트 `README.md` · `CLAUDE.md` · `PRD.md`이며, 충돌 시 이를 따른다.**

- `docs/agent/ADR.md`(ADR-034), `lib/local-agent/PROTOCOL.md`, `docs/design/AI_BRIDGE_PLATFORM.md`
- `connector/core/runtime.mjs` — `ConnectorSession`, heartbeat 처리
- `connector/desktop/terminal.mjs` — `openProviderTerminal`
- `connector/desktop/main.mjs` — `bridgeMetadata`, `new ConnectorSession(...)`, `connector:terminal` IPC
- `connector/test/runtime.test.mjs`, `connector/test/terminal.test.mjs`
- `connector/desktop/package.json`(버전), `connector/VALIDATION.md`

## 작업

TDD(`node --test`)로 진행한다.

1. `ConnectorSession` 생성자에 선택 인자 `openTerminal?: (provider) => Promise<{ ok: boolean }>`를 추가한다.
   - 주어지면 heartbeat body에 `bridgeCapabilities: ['terminal_v1']`를 넣는다. 주어지지 않으면 기존 body와 완전히 같다(기존 테스트 유지).
   - heartbeat 응답의 `terminalRequests`를 처리한다: 배열 앞 2개만, `id`는 `ID_PATTERN`, `provider`는 `codex`|`claude`만. 이미 처리한 id(최근 50개)는 무시한다. 연결 상태와 lease가 유효할 때만 연다. `openTerminal` 실패·예외는 삼키고 세션을 멈추지 않는다.
2. `main.mjs`: 세션 생성 시 `openTerminal: provider => openProviderTerminal(provider, { resolve: resolveExecutable, directory: join(app.getPath('userData'), 'terminal-launchers'), openPath: path => shell.openPath(path) })`를 넘긴다(IPC 핸들러와 같은 인자). 웹 요청으로 열렸다는 문구를 앱 상태 메시지에 짧게 남긴다.
3. 버전을 `0.1.13`으로 올린다(`connector/desktop/package.json`, `package-lock.json`의 해당 항목만). 버전 표시 테스트가 고정 값을 쓰면 함께 맞춘다.

## Acceptance Criteria

```bash
npm --prefix connector test        # 또는 connector/package.json의 테스트 스크립트
```

테스트가 확인할 것: capability 보고 유무, 유효 요청 1회 열기, 같은 id 재전달 무시, 잘못된 provider·id 무시, 3개 이상 요청 중 2개만 처리, 연결 끊긴 뒤 요청 무시, openTerminal 예외에도 heartbeat 계속.

## 검증 절차

AC 실행 → `connector/VALIDATION.md`에 이번 단위 검증 결과를 짧게 기록 → index.json step 3 갱신.

## 금지사항

- 서버가 준 문자열을 명령·경로·인자로 쓰지 마라. 이유: provider 이름만 신뢰 경계를 넘는다. 실행 파일은 앱이 직접 찾는다.
- 앱 ID·`hapark-connect` 스킴·프로필 경로를 바꾸지 마라. 이유: 기존 설치와 기기 키가 끊긴다.
