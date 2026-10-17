# 연결기 검증 기록 — 2026-10-17

## 검증 범위

Windows x64(build 10.0.26200), 개발 Node 24.15.0, Electron 44.9.0, electron-builder 26.15.3에서 확인했다. 인증 파일·로그인 토큰·이메일·조직 정보·CLI 응답 원문은 기록하지 않았다. 설치본, QA JSON/PNG, 환경별 manifest는 Git에서 제외하며 이 문서의 결과만 검토 근거로 남긴다.

| 항목 | 결과 | 근거 |
| --- | --- | --- |
| 독립 코어 테스트 | 37/37 통과 | `npm --prefix connector test` |
| 실제 자식 프로세스 취소 | 통과 | 숨김 Node 자식을 시작하고 abort 완료 뒤 PID 소멸 확인 |
| Codex 메타데이터 | 실제 확인 | 0.163.0, ChatGPT 로그인, 모델 7개, 제공된 7일 한도만 표시 |
| Claude 메타데이터 | 실제 확인 | 2.1.301, 모델 12개, claude.ai/firstParty/Max 구독 OAuth |
| Codex 실제 추론 | 1회 성공 | gpt-6-luna, 고정 2+2 질문, 답변 4 |
| Claude 실제 추론 | 3회 실패 | 마지막 진단에서 assistant.error=rate_limit, RATE_LIMITED로 분류 |
| 격리 Electron UI | 통과 | 실제 renderer·CLI 메타데이터, fixture 작업 claim=null, 추론 0회 |
| Windows 패키징 | NSIS x64 | HTTPS 운영 manifest 포함, 서명 없는 개발 설치본 |
| macOS·Ubuntu | 실기기 미검증 | 경로·프로토콜·빌드 설정과 테스트 fixture만 구현 |

코어 회귀는 URI·origin·기기 키·API 오류·엄격한 ACK DTO, JSONL Unicode, 셸 없는 실행, CLI 제한 플래그, OAuth 종류, 실제 기간별 quota, 별도 quota 관측 시각, 재전송 복구, 취소·lease·종료 순서를 검증한다. 테스트는 모델을 호출하지 않는다.

## 실제 CLI 확인

메타데이터만 조회하는 재현 명령은 다음과 같다.

```powershell
npm --prefix connector run smoke
```

Codex는 stdio app-server의 initialize, model/list, account/read, account/rateLimits/read를 사용했다. 이 계정은 primary가 실제 10080분 창이고 secondary가 없었다. primary를 임의로 5시간으로 표시하지 않는다.

Claude는 auth status의 loggedIn/authMethod/apiProvider/subscriptionType만 분류하고 stream-json initialize에서 모델 목록을 받았다. 구독 OAuth가 아닌 API 키나 외부 provider는 자동 과금으로 전환하지 않고 로그인 안내로 멈춘다. 모델 목록은 카탈로그이며 개별 모델의 남은 사용 권한을 보장하지 않는다. 실제 rate_limit_event가 없으면 quota를 만들지 않는다.

승인된 작은 추론 검증에서 사용한 명령이다. **실행 기록이며 자동 재실행 지침이 아니다.** 새 호출은 구독 한도를 소비한다.

```powershell
npm --prefix connector run smoke -- --provider=codex --infer
npm --prefix connector run smoke -- --provider=claude --infer --diagnose
```

Codex는 gpt-6-luna에 `What is 2 + 2? Reply with only the number.`와 빈 논문 맥락을 보내 4를 받았다. 실제 호출은 1회다.

Claude는 haiku에 같은 질문만 보냈다. 초기 2회 실패 후 승인된 마지막 진단 1회에서 `assistant.error=rate_limit`, `result.subtype=success`, `result.is_error=true`, exit=1, 응답 텍스트 없음이 확인됐다. 최종 오류는 `RATE_LIMITED`이고 사용자 안내는 **구독 사용 한도에 도달했어요.**다. HTTP 상태와 API error type은 CLI가 제공하지 않아 null로 남겼다. 도구 제한 옵션이나 API 키 로그인 불일치가 원인이라고 추정하지 않는다. 추가 추론은 중지했다.

허용된 필드만 다시 적은 요약은 `artifacts/cli-smoke-summary.json`이다. 원문 응답·인증 정보 로그는 저장하지 않았다.

## 실제 Electron UI 회귀

```powershell
npm --prefix connector run qa:desktop
```

최종 실행은 2026-10-17 19:44 KST에 완료했다. 작업별 임시 프로필, loopback 서버, offscreen Electron renderer를 사용했다. 사용자의 웹 브라우저·기존 프로필·기본 프로토콜을 조작하지 않았다. 실제 CLI의 메타데이터를 조회했지만 fixture는 어떤 추론 작업도 만들지 않는다.

- 다크 배경 rgb(22,21,26), 빈 6자리 입력, 5자리 버튼 비활성, 잘못된 6자리 오류, 올바른 번호 연결.
- 자동 시작·펫 기본 꺼짐, Node renderer 노출 없음, 가로 overflow 없음, 사용자 포커스 이동 없음.
- 실제 제공된 기간만 작은 링으로 표시, hover 상세 표시·이탈 시 닫기, 기본 모델 자동 선택 없음.
- 실제 Windows safeStorage 암호화 파일에 평문 기기 키 필드가 없음을 확인.
- 앱을 완전히 종료하고 같은 프로필로 다시 실행해 암호화된 동일 기기 키 재사용, 새 코드 없이 서버 승인 연결 복원.
- 401이면 재연결 안내, 새 연결 요청은 다시 빈 번호 입력란, 오답 5회 후 새 웹 번호 요청.
- 해당 앱 PID의 네이티브 WM_CLOSE로 실제 닫기 동작 확인. 권한 없는 열린 앱은 종료하고, 연결 중 창을 닫으면 현재 웹 권한 동안만 유지.
- 기본 옵션에서 숨김 상태 + 401이면 프로세스 자체 종료. 네트워크가 끊겨도 웹 lease가 만료되면 자체 종료. 강제 정리로 통과 처리하지 않고 PID 소멸을 기다림.

최종 `desktop-recovery.json`: strictRejected=0, 서로 다른 기기 키=1, UI 추론=0. 자체 종료와 복구 조건 10개를 통과했다. 회귀 종료 후 fixture와 소유 프로세스를 정리했다.

| 파일 | 화면/근거 |
| --- | --- |
| `artifacts/desktop-pairing.png` | 빈 6자리 번호·다크·기본 옵션 꺼짐 |
| `artifacts/desktop-wrong-code.png` | 잘못된 번호 안내 |
| `artifacts/desktop-connected.png` | 실제 CLI 메타데이터·작은 링 |
| `artifacts/desktop-quota-hover.png` | 제공된 7일 한도·간결한 초기화 시각 |
| `artifacts/desktop-reopened.png` | 종료 뒤 암호화 기기 키로 재실행 |
| `artifacts/desktop-session-expired.png` | 세션 만료 재연결 |
| `artifacts/desktop-code-exhausted.png` | 5회 오답 후 새 번호 |
| `artifacts/desktop-qa.json`, `desktop-flow.json`, `desktop-recovery.json` | 기계 판독 회귀 결과 |

## 설치본과 설치 회귀

```powershell
$env:CONNECTOR_APP_ORIGIN='https://hapark.vercel.app'
$env:CSC_IDENTITY_AUTO_DISCOVERY='false'
npm --prefix connector/desktop run package:win
npm --prefix connector run qa:install
```

`dist/win-unpacked/resources/app.asar`의 manifest에서 production origin=https://hapark.vercel.app, development=false를 직접 확인했다. Windows NSIS는 설치 때도 전용 링크를 등록하도록 customInstall을 사용하며, 제거 시 현재 등록이 자기 설치 경로를 가리킬 때만 지운다.

설치 회귀는 기존 동명 설치·merged 프로토콜이 없는 사용자만 허용한다. 검증한 절대 임시 경로에 `/S`로 설치하고 설치 경로를 가리키는 URI 명령, 최신 lifecycle 코어, 설치된 번들 Node를 확인한 뒤 own uninstaller로 제거한다. 브라우저와 GUI 첫 실행은 하지 않는다. 생성되는 `artifacts/windows-installer-qa.json`에 크기·SHA256·런타임 버전과 원복 결과를 남긴다.

최종 설치본은 `dist/hapark-connector-0.1.0-win-x64.exe`, **111,583,460 bytes**(약 106.4 MiB), Authenticode **NotSigned**다.

```text
SHA256 7B62D8F6C5530C68A279603CFAA100F9B09C63679611C64EA0D0159D562DA5D3
```

2026-10-17 19:52 KST에 시작한 실제 설치 회귀는 PASS다. 기존 프로토콜·동명 설치 없음 → task-owned 임시 경로에 무인 설치 → URI가 설치된 실행 파일을 가리킴 → lifecycle 코어와 소스 일치 → 번들 Node **24.22.0**·Electron **44.9.0** 실행 → 자체 제거 → merged 프로토콜이 다시 없음·임시 설치 경로 제거를 확인했다. GUI·브라우저·실제 모델 호출은 0회다. 이전 NSIS 구성에서 설치 직후 URI가 없던 실패를 재현한 뒤 customInstall/customUnInstall 보강으로 통과시켰다.

UI 회귀가 만든 이전 임시 프로필 7개를 추가로 삭제하려던 명령은 자동 승인 검토가 정책으로 거절해 그대로 두었다. 이 프로필은 Git 범위 밖의 task-owned Temp 폴더이며 가짜 서버용 암호화 기기 키만 포함한다. 소유 Electron·CLI 메타데이터·fixture 프로세스와 포트 3000 listener는 남기지 않았다.

## 남은 검증

macOS arm64/x64의 실제 설치·Keychain·Finder 실행, Ubuntu GUI에서 Secret Service/keyring·프로토콜·Wayland 펫 동작, 운영 사이트와 서명된 설치본의 첫 실행 콜백, 공개 다운로드 게시·OS 서명/notarization은 아직 검증하지 않았다. Windows UI 회귀는 개발 Electron에서 수행했고 NSIS 설치 회귀는 실제 패키지를 별도로 검증한다. 지속 실행 시 CPU·메모리·배터리 영향은 측정하지 않았다.

3 OS CI에는 코어 테스트와 각 OS 패키징을 사용할 수 있다. Windows CI는 `qa:install`도 실행할 수 있다. `qa:desktop`은 현재 Windows의 실제 WM_CLOSE 및 로그인한 CLI 메타데이터를 확인하는 회귀이므로 무인 3 OS 공통 UI 검증으로 주장하지 않는다.
