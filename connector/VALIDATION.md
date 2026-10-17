# 연결기 검증 기록 — 2026-10-17

## 검증 범위

로컬 Windows x64(build 10.0.26200), 개발 Node 24.15.0, Electron 44.9.0, electron-builder 26.15.3에서 확인했다. 별도로 [Actions 실행 39028900156](https://github.com/csm-kr/haparkchopaeng-workspace/actions/runs/39028900156)에서 Windows x64·macOS 15 arm64·Ubuntu 24.04 x64의 실제 Electron과 OS 암호화 저장소를 검증했다. 인증 파일·로그인 토큰·이메일·조직 정보·CLI 응답 원문은 기록하지 않았다. 설치본, QA JSON/PNG, 환경별 manifest는 Git에서 제외하며 이 문서의 결과만 검토 근거로 남긴다.

| 항목 | 결과 | 근거 |
| --- | --- | --- |
| 독립 코어 테스트 | 43/43 통과 | `npm --prefix connector test` |
| 실제 자식 프로세스 취소 | 통과 | 숨김 Node 자식을 시작하고 abort 완료 뒤 PID 소멸 확인 |
| Codex 메타데이터 | 실제 확인 | 0.163.0, ChatGPT 로그인, 모델 7개, 제공된 7일 한도만 표시 |
| Claude 메타데이터 | 실제 확인 | 2.1.301, 모델 12개, claude.ai/firstParty/Max 구독 OAuth |
| Codex 실제 추론 | 1회 성공 | gpt-6-luna, 고정 2+2 질문, 답변 4 |
| Claude 실제 추론 | 3회 실패 | 마지막 진단에서 assistant.error=rate_limit, RATE_LIMITED로 분류 |
| 격리 Electron UI | 통과 | 실제 renderer·CLI 메타데이터, fixture 작업 claim=null, 추론 0회 |
| Windows 패키징 | NSIS x64 | HTTPS 운영 manifest 포함, 서명 없는 개발 설치본 |
| Windows CI | 네이티브 13조건·NSIS 설치/제거 통과 | 실제 OS 암호화, 번들 Node·코어 9개, URI 등록과 제거 원복 |
| macOS CI | arm64 네이티브 13조건 통과 | 실제 OS 암호화, arm64/x64 DMG 생성. 설치·Finder/URI 실행은 미검증 |
| Ubuntu CI | x64 네이티브 13조건 통과 | 실제 Secret Service 환경, .deb 생성. 설치·Wayland는 미검증, AppImage 빌드·배포 제외 |

코어 회귀는 URI·origin·기기 키·API 오류·엄격한 ACK DTO, JSONL Unicode, 셸 없는 실행, CLI 제한 플래그, OAuth 종류, 실제 기간별 quota, 별도 quota 관측 시각, 재전송 복구, 취소·lease·종료 순서를 검증한다. 테스트는 모델을 호출하지 않는다.

### 3 OS 네이티브 CI에서 확인한 범위

위 실행의 `native-smoke-win`, `native-smoke-mac`, `native-smoke-linux` artifact를 직접 읽었다. 세 결과 모두 `passed=true`, `mode=real-electron-real-os-encryption-mock-api`, `build=unpackaged-ci`다. Electron·renderer·OS 암호화 저장소는 실제이며 `mockKeychain=false`, `basicTextAllowed=false`다. 서버 API만 loopback fixture이고 로그인한 운영 웹이나 실제 CLI 추론을 대체 검증한 것은 아니다. 세 runner의 Codex·Claude는 설치되지 않은 상태로 안내됐다.

각 OS에서 빈 6자리·5자리 제출 차단·오답·정답 연결, 평문 키 없는 암호화 저장, 정상 앱 종료 후 같은 프로필/기기 키 복호화와 번호 없는 재개를 확인했다. 자기 임시 암호문 1비트 손상 후에는 빈 입력·새 기기 키·새 6자리 확인을 요구했고, 원본 바이트가 같은 백업 1개를 유지했다. 13조건 모두 통과했고 Electron 세 기동은 종료 코드 0, 소유 프로세스와 loopback은 정리됐다. `cliInferenceJobsOffered=0`, `browserActionsInvoked=0`, `protocolRegistrationRequested=false`이므로 브라우저 전용 링크 실행이나 모델 동작 검증으로 확대하지 않는다. 재개는 `graceful-app-quit`이며 전원 차단·강제 종료 후 재개를 실증한 것은 아니다.

Ubuntu는 Xvfb·D-Bus·GNOME Secret Service 세션을 준비했다. 앞선 실제 CI는 Electron이 샌드박스 오류/SIGTRAP으로 renderer 전에 종료됐다. 공식 Electron `install.js`로 받은 정확한 `dist/chrome-sandbox`를 root:root/4755로 준비한 뒤 통과했다. CI는 일반 파일·비심볼릭링크·고정 경로·실행 권한·SUID·SHA256 불변·`nosuid` mount 아님을 검사한다. 샌드박스 비활성화나 AppArmor 전역 해제를 사용하지 않았다. 이 준비는 CI의 unpackaged Electron을 위한 것이며, 일반 사용자에게 같은 수동 명령을 요구하는 설치 UX를 검증한 것이 아니다.

현재 Ubuntu artifact의 한글은 runner에 CJK 글꼴이 없어 네모로 보인다. 따라서 동작 13조건 통과와 한국어 화면 가독성은 구분한다. 실제 GUI Ubuntu에는 활성 키링과 한국어 표시가 가능한 글꼴이 필요하며, 다음 CI에서 `fonts-noto-cjk`를 준비해 다시 캡처한다. 일반 Ubuntu 기본 설치에 해당 글꼴이 있다고 가정하지 않는다.

위 CI에서 Windows NSIS x64, macOS DMG arm64/x64, Ubuntu .deb amd64·AppImage x86_64 생성은 통과했다. 이어 설치된 electron-builder 26.15.3의 실제 `AppImageTarget.desktopEntry` 경로를 호출해 `AppRun --no-sandbox %U`를 관측했고 샌드박스 유지 검사가 실패했다. 기본 AppRun에도 user namespace 실패 시 같은 인수를 추가하는 경로가 있다. 이에 AppImage를 빌드·배포 대상에서 제외하고 Linux 대상과 artifact를 .deb만으로 제한했다. 이미 생성된 AppImage는 Git에서 제외한 개발 산출물로 보류하며 다운로드에 등록하지 않는다. 안전한 AppImage 대안을 만드는 일은 이번 범위에 포함하지 않는다.

Ubuntu는 .deb를 우선 검증 대상으로 둔다. CI는 빌드된 실제 .deb를 task-owned 임시 경로에 읽기 추출해 maintainer scripts·.desktop의 샌드박스 비활성화 인수 부재, 공식 postinst의 user namespace 검사와 4755/0755 분기, `x-scheme-handler/hapark-connect`와 설치 경로의 `%U` 전달을 검사한다. 이는 설치 스크립트의 내용 검사이며 설치·URI 실행 성공을 의미하지 않는다. unpackaged CI의 안전한 샌드박스 성공을 설치본 실행 보장으로 확대하지 않는다.

실행 39028900156의 실제 `hapark-connector-0.1.0-linux-amd64.deb`는 **99,366,616 bytes**, SHA256 `a1faa9e4ebd0a6dded634099a315746e5e62cd3d54ce1430407cec0be2d7beb9`다. 해당 아카이브를 설치하지 않고 읽어 `Exec="/opt/하박조팽 연결기/hapark-connector-desktop" %U`, 프로토콜 MIME, postinst의 4755/0755 분기, root:root 소유 0755의 공식 sandbox ELF(15,232 bytes)를 확인했다. 동일 검사부는 실제 아카이브 내용에서 통과하고, 우회 인수를 추가한 launcher·maintainer script와 읽기 오류 fixture에서는 실패했다. 전체 `dpkg-deb` CI step은 다음 실행에서 별도로 판정한다.

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

최종 실행은 2026-10-17 20:09 KST에 완료했다. 작업별 임시 프로필, loopback 서버, offscreen Electron renderer를 사용했다. 사용자의 웹 브라우저·기존 프로필·기본 프로토콜을 조작하지 않았다. 실제 CLI의 메타데이터를 조회했지만 fixture는 어떤 추론 작업도 만들지 않는다.

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

설치 회귀는 기존 동명 설치·merged 프로토콜이 없는 사용자만 허용한다. 검증한 절대 임시 경로에 `/S`로 설치하고 설치 경로를 가리키는 URI 명령, 코어 9개 전체의 이름·SHA256, 설치된 번들 Node를 확인한 뒤 own uninstaller로 제거한다. 브라우저와 GUI 첫 실행은 하지 않는다. 생성되는 `artifacts/windows-installer-qa.json`에 크기·SHA256·런타임 버전·대조한 모듈 목록과 원복 결과를 남긴다.

최종 설치본은 `dist/hapark-connector-0.1.0-win-x64.exe`, **111,583,838 bytes**(약 106.4 MiB), Authenticode **NotSigned**다.

```text
SHA256 9E12B8206ECB8A365C799B978A73B0396E68FC0AA32D184A3DAC82F046D6ABD8
```

2026-10-17 20:11 KST에 시작한 최종 실제 설치 회귀는 PASS다. 기존 프로토콜·동명 설치 없음 → task-owned 임시 경로에 무인 설치 → URI가 설치된 실행 파일을 가리킴 → storage 복구를 포함한 코어 9개 모두 소스와 이름·SHA256 일치 → 번들 Node **24.22.0**·Electron **44.9.0** 실행 → 자체 제거 → merged 프로토콜이 다시 없음·임시 설치 경로 제거를 확인했다. GUI·브라우저·실제 모델 호출은 0회다. 이전 NSIS 구성에서 설치 직후 URI가 없던 실패를 재현한 뒤 customInstall/customUnInstall 보강으로 통과시켰다.

UI 회귀가 만든 이전 임시 프로필 7개를 추가로 삭제하려던 명령은 자동 승인 검토가 정책으로 거절해 그대로 두었다. 이 프로필은 Git 범위 밖의 task-owned Temp 폴더이며 가짜 서버용 암호화 기기 키만 포함한다. 소유 Electron·CLI 메타데이터·fixture 프로세스와 포트 3000 listener는 남기지 않았다.

## 남은 검증

macOS arm64의 CI Keychain 사용과 Ubuntu의 CI Secret Service 사용은 통과했다. macOS x64에서의 네이티브 실행, 두 OS의 실제 패키지 설치·앱 이동/업데이트·제거·Finder/데스크톱 런처·브라우저 URI 연결·재부팅 후 실행은 아직 검증하지 않았다. Ubuntu Wayland의 펫·항상 위 표시, 한국어 글꼴을 준비한 화면 캡처도 남아 있다. AppImage는 빌드·배포 대상에서 제외했다. 운영 사이트와 서명된 설치본의 첫 실행 콜백, 공개 다운로드 게시·OS 서명/notarization은 미검증이다. Windows UI 회귀는 개발 Electron에서 수행했고 NSIS 설치 회귀는 실제 패키지를 별도로 검증한다. 지속 실행 시 CPU·메모리·배터리 영향은 측정하지 않았다.

3 OS CI의 공통 네이티브 회귀는 `node connector/scripts/ci-desktop-smoke.mjs`이며, Linux는 workflow의 샌드박스·키링·가상 디스플레이 준비 후 실행한다. Windows CI는 패키징 뒤 `qa:install`도 통과했다. `qa:desktop`은 Windows의 실제 WM_CLOSE 및 로그인한 CLI 메타데이터를 확인하는 별도 로컬 회귀다. 공통 CI에 없는 실제 CLI·설치·브라우저 흐름까지 검증했다고 주장하지 않는다.

## 첫 실제 3 OS CI에서 발견한 패키징 차이

### 암호문 손상 뒤 다시 연결

새 네이티브 회귀에서 최초 페어링 직후 강제 종료한 프로필이 재실행 시 복호화 오류로 막히는 현상을 확인했다. Chromium OS 키의 Local State flush 여부는 원인 가설이며 확정하지 않았다. OS 보안 저장소가 활성 상태일 때 읽을 수 없는 암호문을 고유 `devices.enc.json.unreadable-UUID.enc.bak`으로 보존하고 새 기기 키·새 6자리 확인으로 복구하도록 구현했다. 정상 키·다른 앱의 정상 레코드는 유지하고, 비활성·접근 권한·파일 읽기 오류는 복구로 간주하지 않는다. 읽기·저장·제거·백업은 같은 큐에 들어간다.

저장소 회귀는 7/7, 전체 코어는 43/43이며 독립 읽기 감사에서도 새 blocker가 없었다. 실제 Windows OS safeStorage로 정상 종료 후 재개, 자기 임시 프로필의 암호문 1비트 손상, 다음 기동에서 빈 6자리 입력, 다른 새 번호(716204)로 새 신원 페어링을 통과했다. 자동으로 이전 신원을 승인하지 않았고, 고유 기기 키는 2개, 원본 손상 바이트와 같은 암호문 백업은 1개를 유지했다. 모델 작업·브라우저 호출은 0회이며 근거는 `artifacts/ci-desktop-smoke-windows/result.json`이다. 정상 종료 재개와 암호문 손상 복구를 검증한 것이며 강제 종료 원인 가설을 실증한 것으로 확대하지 않는다.

### 첫 CI의 패키징 보정

2026-10-17의 [Actions 실행 39026669946](https://github.com/csm-kr/haparkchopaeng-workspace/actions/runs/39026669946)에서 코어 37개는 세 OS 모두 통과했다. macOS arm64/x64 DMG도 생성됐다. 네이티브 사용자 UI와 OS 보안 저장소의 실기기 검증 범위는 위의 제한을 그대로 따른다.

- [Ubuntu job 117378896196](https://github.com/csm-kr/haparkchopaeng-workspace/actions/runs/39026669946/job/117378896196): AppImage 생성 뒤 .deb builder가 project homepage와 author.email 또는 명시적 maintainer 누락으로 실패했다. 설치된 electron-builder 26.15.3의 실제 `FpmTarget.computeFpmMetaInfoOptions` 호출에서도 동일 오류를 로컬 재현했다. `homepage=https://hapark.vercel.app`, `linux.maintainer=Hapark maintainers` 보강 후 같은 builder 경로가 URL과 maintainer를 반환해 통과했다. 개인 이메일을 추가하지 않았다. 이후 [Ubuntu job 117385267461](https://github.com/csm-kr/haparkchopaeng-workspace/actions/runs/39028900156/job/117385267461)에서 실제 .deb 생성·artifact 게시까지 통과했다.
- [Windows job 117378896415](https://github.com/csm-kr/haparkchopaeng-workspace/actions/runs/39026669946/job/117378896415): NSIS 생성은 성공했고 설치 회귀의 PowerShell에서 `Get-FileHash`를 찾지 못해 설치 전에 실패했다. SHA256을 .NET 파일 스트림으로 계산해 셸 모듈 의존을 없앴다. `Get-FileHash`를 사용하면 `CommandNotFoundException`이 나도록 한 환경에서 실제 설치·프로토콜·번들 Node·코어 해시·제거 원복을 전부 다시 통과했다. 해시는 앞선 독립 계산값과 같고 추론·GUI·브라우저 호출은 0회다. 이후 [Windows job 117385267654](https://github.com/csm-kr/haparkchopaeng-workspace/actions/runs/39028900156/job/117385267654)에서도 실제 설치·코어 9개·URI 등록·제거 원복을 통과했다.
