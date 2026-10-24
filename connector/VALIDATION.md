# 연결기 검증 기록 — 2026-10-17

> 기존 절은 각 실행 당시의 검증 기록을 보존한다. 최신 실제 결과는 맨 아래 **phase14 Intel Mac 실제 설치 CI — 394d47e8** 절을 따른다. `730ad8d`·초기 Ubuntu 영수증과 이전 설치 미검증 표기는 당시 범위로 보존한다.

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

## phase14 Ubuntu 설치본 검증 — 추가 기록

[실행 39038318920의 Ubuntu job 117412530581](https://github.com/csm-kr/haparkchopaeng-workspace/actions/runs/39038318920/job/117412530581)에서 Ubuntu 24.04 x64의 실제 `.deb` 설치·OS 전용 링크·제거 **8개 조건이 모두 통과**했다. 제품 소스 `ec594c2`를 검증한 CI merge 소스는 영수증의 `7d06c8bf571da8b1020bc99bf8d1c3c94bc2f302`다. 격리 X11 데스크톱의 `mode=installed-unsigned-package-and-os-uri`, `passed=true`, `phase=completed` 결과이며 운영 배포 기록이 아니다.

패키지는 `hapark-connector-desktop` 버전 `0.1.0`, 아키텍처 `amd64`다. 이 실행에서 설치한 `.deb`의 SHA256은 `3a792f591ddf3eb99383859bb12f5b1a54ad437f55ec33ffdfef37917ba6289f`다. 이전 실행이나 Windows 설치본의 해시와 구분한다. 근거는 해당 job의 installed-package 영수증 `result.json`이며 검토용 로컬 사본은 `phase14-job-117412530581.json`이다.

| 조건 | 실제 확인 결과 |
| --- | --- |
| 1. 설치 전 소유 경계 | 동명 패키지·설치 경로·프로필·기본 URI handler가 없는 전용 runner에서 시작 |
| 2. `.deb` 설치·코어·샌드박스·기본 handler | 실제 설치 후 코어 **9개**의 이름·SHA256이 소스와 일치. 공식 sandbox는 설치기가 선택한 **root:root/0755**, 앱별 AppArmor profile은 실제 loaded. QA의 mode 변경이나 샌드박스 비활성화 없이 기본 전용 링크 해석 확인 |
| 3. 번들 런타임 | 설치된 실행 파일로 번들 **Node 24.22.0 x64** 실행. 별도 Node 설치 불필요 |
| 4. cold 전용 링크·창·정상 닫기 | `xdg-open`으로 설치된 실행 파일 시작, 정확한 합성 URI의 **process-title-token**·가시 창·스크린샷 확인. 원래 argv는 미증명(`originalArgvProven=false`). PID 소유를 재확인한 창에 `wmctrl` EWMH 닫기 요청 후 관측한 프로세스 소멸, opener 종료 코드 0·signal null 확인 |
| 5. 직접 CDP·실행 중 샌드박스 | 별도 기동의 실제 설치 renderer에서 invalid URI 오류 확인. browser-target `SystemInfo.getProcessInfo`의 browser PID는 기동 PID와 같고 renderer native PID는 OS의 정확한 실행 파일·UID·부모 트리와 일치. renderer **Seccomp=2·NoNewPrivs=1** 확인 |
| 6. warm 전용 링크 | 새 invalid URI가 같은 main PID에 도달해 구별되는 parser 오류 표시. 기기 자격 정보·최초 웹 복귀 설정 생성 없음 |
| 7. 정상 IPC 종료 | 실제 앱의 quit IPC 뒤 직접 기동한 main 종료 코드 0·signal null, 관측한 소유 프로세스 소멸 확인 |
| 8. 제거·원복 | 패키지 purge 뒤 설치 파일·프로토콜 handler·앱별 AppArmor 파일/커널 profile 제거. 새 프로필·소유 URI opener·임시 경로 정리 확인. `autoremove` 미사용 |

실제 CLI·모델 추론은 **0회**(`cliInferenceRequested=false`)다. invalid URI가 기기 키 저장·API ACK·adapter 구성 전에 거절되는 제품 흐름으로 해당 작업을 배제했으며, main의 네트워크를 독립 캡처해 API 호출 0회를 측정한 것은 아니다. cold 실행은 renderer 상태를 CDP로 읽지 않았고, 직접 자식이 아닌 cold main의 종료 코드는 측정하지 않았다. 프로세스 소멸 근거는 관측한 소유 PID와 읽을 수 있는 `/proc` 범위이며 모든 sandbox 자손의 관측을 보장하지 않는다.

이번 8조건은 인증 페어링·OS 키 암호화·실제 모델 응답을 검증하지 않는다. 앞선 unpackaged 암호화 13조건과 별개다. 정식 배포, 실사용자의 브라우저 승인·GUI 설치 경험, Wayland, 재부팅, 서명·업데이트는 미검증이며 Windows·macOS의 별도 진행 상태는 유지한다. AppImage는 계속 빌드·배포 대상에서 제외한다.

## phase14 제품 설치본 CI — 730ad8d · 당시 실패 보존

제품 소스 `730ad8d0ee418b623634288636e44a47fe8e4331`의 [CI 39041064640](https://github.com/csm-kr/haparkchopaeng-workspace/actions/runs/39041064640)는 **Web·PostgreSQL·Windows·Linux 성공, Mac 실패**로 종료됐다. 설치 영수증 source는 CI merge `c926f9965458c089a2b38b4d0c4ceda631aea54c`다. 과거 `ec594c2`의 해시·검증 수와 합산하지 않는다.

Web job 117420497398은 120 suites 통과·1 skip, 웹 946개 통과·PG 전용 13개 skip, pytest 60개, lint/build 종료 코드 0, Chromium 8개(30.7초), HTTP wire step 통과다. 별도 PostgreSQL job 117420497435의 13개도 성공했다. phase13의 같은 수치와 중복 합산하지 않는다.

| job | 완료된 검증 |
| --- | --- |
| [Windows 117420497431](https://github.com/csm-kr/haparkchopaeng-workspace/actions/runs/39041064640/job/117420497431) | NSIS 실제 설치·프로토콜 등록·번들 Node·코어 9개 SHA 일치. Node installed URI 영수증 5 checks·정상 IPC·프로필 정리 통과. 최종 PS 영수증 passed/uninstalled/protocolRestoredToAbsent 모두 true |
| [Ubuntu 117420497268](https://github.com/csm-kr/haparkchopaeng-workspace/actions/runs/39041064640/job/117420497268) | 위 실제 .deb 설치 8조건 재통과. 코어 9개, Node 24.22.0 x64, 설치기가 선택한 root:root/0755 sandbox·앱별 AppArmor loaded. QA mode 변경 없음. purge·프로필·handler·AppArmor·opener·Temp 정리 모두 true |
| [Mac 117420497541](https://github.com/csm-kr/haparkchopaeng-workspace/actions/runs/39041064640/job/117420497541) | SIGTRAP으로 실패. ASCII 실행 파일명 분리·logging 보강도 해결하지 못했다. 원인은 미확정이며 설치 앱 OS URI 완료로 표시하지 않음 |

Windows cold는 실제 ShellExecute의 정확한 OS 루트 슬래시 변형을 관측했다(`normalizedRootSlashObserved=true`, `rawExactMatch=false`). 원문 exact가 true인 것처럼 덮어쓰지 않았다. 가시 창·WM_CLOSE, warm의 다른 parser 오류·same PID/single main, 정상 quit IPC, ownedProcessesStopped/freshProfileRemoved와 errors=[]를 확인했다. ACL은 같은 현재 토큰의 소유 그룹임을 검증했다(`currentTokenOwner=true`, `currentUserOwner=false`, `administratorsOwner=true`); SID 원문은 기록하지 않는다. 경로·실제 경로·생성 시각·reparse 부재 검사도 통과했다. 자체 제거 뒤 handler 없음은 확인했으며 설치 폴더 Remove-Item은 명령 성공/job 종료 코드 0 근거다. 삭제 후 exists 별도 boolean은 없다.

| 이번 CI에서 검증한 파일 | bytes | SHA256 |
| --- | ---: | --- |
| Windows NSIS unsigned QA artifact | 111584107 | `3e2b6669cb543d242f0f8a20c4724c96e6e048e95fc9bbbe5fbd67dd54297289` |
| Ubuntu .deb amd64 | 영수증에서 별도 크기 미측정 | `85ede6d95ea984427dcd27a12e1f78af45b44e67a8f1156a702b14b39caff1dd` |

Windows의 Authenticode 상태를 이 영수증에서 측정하지 않았으므로 서명 완료를 주장하지 않는다. CLI·실제 추론 0회이며 API ACK 전 parser 경계로 실행을 배제했다. main-process 네트워크는 독립 측정하지 않았다. Ubuntu의 URI 제목 토큰·원래 argv 미증명·읽기 가능한 `/proc` 범위, 실사용자 브라우저 승인·인증 페어링·재부팅/업데이트·Mac x64·Wayland·서명/공증·운영 미배포 한계는 유지한다. 설치본 CI 성공은 unpackaged 암호화 13조건이나 실사용자 검증을 대신하지 않는다.

## phase14 제품 설치본 CI — 9eeccee · 당시 성공 보존

제품 소스 `9eeccee5aa75ed4ef3c14ae9cd95344a49134ef2`의 [CI 39042209763](https://github.com/csm-kr/haparkchopaeng-workspace/actions/runs/39042209763)는 **completed/success, 5개 job 모두 성공**이다. Web [117423809238](https://github.com/csm-kr/haparkchopaeng-workspace/actions/runs/39042209763/job/117423809238)의 120 suites·946 tests·Chromium 8개(24.4초)·실제 HTTP 쿠키 유실 회귀·lint/build·하네스 guards와 별도 PG 13개, Mac·Windows·Ubuntu 설치를 통과했다. 설치 영수증의 checkout merge는 `a4aef36f072196d06a69531b2ca56cd9a0033a55`다. 로컬 connector pure **137/137**과 설치된 electron-builder의 실제 구현을 합성 번들·ASAR에 적용한 **5/5**도 통과했다. 이 빌더 회귀 자체는 앱을 기동하지 않으며 아래 실제 Mac 검증과 별도다.

Mac [job 117423809065](https://github.com/csm-kr/haparkchopaeng-workspace/actions/runs/39042209763/job/117423809065)의 실제 설치 **9 checks**가 통과했다. CFBundleName·bundle/main 실행 이름은 `hapark-connector`, Helper 4개도 ASCII이며 CFBundleDisplayName·ASAR productName은 `하박조팽 연결기`, ASAR npm name은 원본을 유지한다. 기존 한글 프로필 위치는 처음 부재했다가 runtimeProfileCreated=true, ASCII 대체 프로필은 처음 부재하고 생성=false로 확인했다. 이는 **새 프로필의 위치 유지 실증이며 기존 기기 키 이전 검증은 아니다.** 기존 프로필이 있으면 중단하며 예상 밖 ASCII 이름 프로필은 삭제하지 않는다. Debian packageName과 ASAR npm runtimePackageName도 분리했다.

같은 Mac 영수증은 DMG 읽기 전용 mount·소유 Applications 복사·코어 9개 SHA·번들 Node, cold/warm same PID·정상 quit IPC·두 번째 cold/IPC와 전체 정리를 확인했다. arm64 DMG는 128,089,217 bytes·SHA256 `1e932a93fa2e8bbbab6aa48aba574ff0725572c53af8449fd827c47e993572d9`다. x64는 DMG 빌드만이며 131,861,518 bytes·SHA256 `f9555f9d6be4babe944944d16860ec88d42f9210dc45e73dc5177a41e4851f88`다. adHoc=true·DeveloperID=false·notarization=false·GatekeeperAccepted=false·strict verification exit1/unknown은 유지한다. 이전 SIGTRAP의 정확한 원인을 확정하거나 서명·공증 통과로 해석하지 않는다.

Windows [job 117423809100](https://github.com/csm-kr/haparkchopaeng-workspace/actions/runs/39042209763/job/117423809100)도 실제 cold OS 루트 슬래시·가시 창·WM_CLOSE, warm same PID/parser·정상 IPC·프로세스/프로필 정리(errors=[])·자체 제거·protocolRestoredToAbsent를 통과했다. 코어 9개 SHA가 일치했고 unsigned QA NSIS는 111,584,104 bytes·SHA256 `86b2ff18f8f949d94ed23053e1c6c6715f5cece2587eef983cf3d3bea78d1499`다. 별도 PG [job 117423809162](https://github.com/csm-kr/haparkchopaeng-workspace/actions/runs/39042209763/job/117423809162)은 PostgreSQL 16의 13개와 noSchemaDifference를 통과했다. 위 `730ad8d` 수치·해시와 합산하거나 재사용하지 않는다.

Ubuntu [job 117423808860](https://github.com/csm-kr/haparkchopaeng-workspace/actions/runs/39042209763/job/117423808860)의 실제 설치 **8 checks**도 passed/completed다. 코어 9개 SHA·실행 중 sandbox·기록된 정리 6개가 모두 통과했고 `.deb` SHA256은 `42a5b76906854f2a22fd322c5865b98aeb3362c56c4ba633dcd4d9734d8c44dc`다. cold URI는 process-title-token이며 originalArgvProven=false·rendererStateObserved=false를 그대로 유지한다. 이 Linux 성공은 원래 argv 관측이나 cold renderer 상태 검증으로 확대하지 않는다.

별도 공통 저장소 소스 `e5e6a61246acbb91adb6a38ecf4720d9ae4c0d63`의 [CI 39041845705](https://github.com/csm-kr/local-agent-connector/actions/runs/39041845705)는 **3개 OS 모두 success**로 종료됐다. Windows [117422756321](https://github.com/csm-kr/local-agent-connector/actions/runs/39041845705/job/117422756321)의 preflight 2·full 5 checks, Mac [117422756115](https://github.com/csm-kr/local-agent-connector/actions/runs/39041845705/job/117422756115)의 설치 9 checks, Ubuntu [117422756303](https://github.com/csm-kr/local-agent-connector/actions/runs/39041845705/job/117422756303)의 설치 8 checks와 각 소유 프로세스·프로필·설치본·handler 정리를 확인했다. 공통 Windows의 unsigned QA 설치본은 110,619,701 bytes·SHA256 `de9b6abbdf398b4e37fa47f08e659a599eb75791e5244c6077ec8fb04986c99cd`다. known PID 관측의 unknown 샘플이 실제 발생했는지는 영수증에 기록되지 않아 주장하지 않는다. 상세는 [공통 검증 기록](https://github.com/csm-kr/local-agent-connector/blob/main/connector/VALIDATION.md)을 따른다. 이 성공은 하박조팽 Mac, 서명·공증·인증 페어링·실브라우저 승인·운영 배포의 성공을 뜻하지 않는다.

## phase14 제품 설치본 CI — c808e926 · 당시 성공 보존

2026-10-18 기록. 제품 소스 `c808e926301a6937b78383ebf064bb97cf20d909`의 [CI 39042877981](https://github.com/csm-kr/haparkchopaeng-workspace/actions/runs/39042877981)는 **completed/success, 5개 job 모두 성공**이다. 실제 설치 영수증의 PR merge 소스는 `6c44bc8ab3c796d0165afaa723e83d9a2f476090`다. 위 `9eeccee`·`730ad8d`의 결과·해시는 해당 실행의 역사로 보존한다.

| job | 실제 완료 결과 |
| --- | --- |
| [Web 117425731031](https://github.com/csm-kr/haparkchopaeng-workspace/actions/runs/39042877981/job/117425731031) | 120 suites·946 tests·Chromium 8개, Harness/isolation guards·lint·production build·실제 HTTP 계약과 쿠키 소실 회귀 모두 PASS |
| [PostgreSQL 117425731030](https://github.com/csm-kr/haparkchopaeng-workspace/actions/runs/39042877981/job/117425731030) | PostgreSQL 16 실제 13개 PASS, schema drift 0 |
| [Windows 117425731090](https://github.com/csm-kr/haparkchopaeng-workspace/actions/runs/39042877981/job/117425731090) | preflight 2/full 5 checks. NSIS 설치·등록·번들 Node·코어 9개 SHA·cold OS 루트 슬래시/가시 창/WM_CLOSE·warm 같은 PID/parser·정상 IPC·프로세스/새 프로필 정리·자체 제거·handler 없음 복구 PASS, errors=[] |
| [Mac arm64 117425730893](https://github.com/csm-kr/haparkchopaeng-workspace/actions/runs/39042877981/job/117425730893) | 실제 DMG 복사·코어 9개 SHA·번들 Node·ASCII bundle/main/Helper 4개·한글 표시/runtime·기존 한글 프로필 위치 유지·cold/warm·정상 IPC 두 회차·재기동·전체 소유 정리 9 checks PASS |
| [Ubuntu 117425731139](https://github.com/csm-kr/haparkchopaeng-workspace/actions/runs/39042877981/job/117425731139) | 실제 .deb 설치·코어 9개 SHA·번들 Node·0755 sandbox/AppArmor·cold/warm·EWMH 정상 닫기·CDP native PID/renderer sandbox·정상 IPC·purge/프로필/handler/AppArmor/opener/Temp 정리 8 checks PASS |

전체 Node 테스트는 제품 **139개**이며 실제 Mac electron-builder 구현 회귀 **5개**는 별도다. 합성 번들·ASAR builder 회귀는 앱 기동 자체가 아니며 위 실제 설치 checks·웹 946개·PG 13개와 합산하지 않는다. 공통 Mac 설정 포팅 후 호스트별 build 설정을 검증한 소스다.

phase14 하네스 step2 검증은 60개 PASS이며 3 steps completed로 기록됐다. 이는 이번 개발·설치 검증 구간의 완료이며 `overallGoalComplete=false`·운영 외부 gate 3개는 그대로 유지한다.

| 이번 CI 산출물 | bytes | SHA256 |
| --- | ---: | --- |
| Windows NSIS unsigned QA artifact | 111584109 | `66089d657386c5cdf30ca07bd90c81e6a609686c0910208e8329a510945e908f` |
| Mac arm64 DMG · 실제 설치 PASS | 128089257 | `49773e4f88016e29821d743e54befd896d10006adff1a4f1f38e687279942585` |
| Mac x64 DMG · 빌드만 | 131861438 | `1ca0b2c5a5e554805d88435242bdb2ac33ca58554963a6b34d562900e570d73a` |
| Ubuntu .deb amd64 | 영수증에서 별도 크기 미측정 | `856af88ed0f0a2ecfa8d9b1ce62b836fd8c3cc628d0b20fef53b0d8ce3148875` |

Mac CFBundleName·bundle/main은 `hapark-connector`, Helper 4개도 ASCII이며 표시 이름·ASAR productName은 `하박조팽 연결기`다. 기존 한글 프로필 경로는 처음 부재했다가 생성됐고 ASCII 대체 경로는 생성되지 않았다. **프로필 위치 설정 유지의 실증이며 기존 기기 키 이전·기존 자격 정보가 있는 사용자 프로필 검증은 아니다.** ad hoc 서명, Developer ID·공증 없음, Gatekeeper 미통과·quarantine 미변경, strict verify exit1/valid=false/reason unknown을 유지한다. 이전 SIGTRAP의 정확한 원인을 소급 확정하지 않는다.

별도 공통 `1e309c3f3d2fe1a333029e23bffea3945a3c4fc7`의 [CI 39042868288](https://github.com/csm-kr/local-agent-connector/actions/runs/39042868288)도 Windows·Mac·Ubuntu 3개 job 모두 성공했다. 공통 Node **165개**, Mac builder **5개**, 실제 설치 Windows preflight 2/full 5·Mac 9·Ubuntu 8은 각각 별도 범위다. 실행별 해시와 Research Notebook의 앱 ID별 production 프로필 근거는 [공통 VALIDATION](https://github.com/csm-kr/local-agent-connector/blob/main/connector/VALIDATION.md)을 따른다.

설치 smoke는 invalid URI를 자격 정보 저장·API ACK·CLI adapter 구성 전에 거절시키며 실제 인증 페어링·CLI·추론을 검증하지 않는다(추론 0). 독립 main-process 네트워크 측정이 아니다. Ubuntu는 X11·GUI·활성 키링·CJK 글꼴·정상 sandbox 전제이며 원래 argv·cold renderer 상태는 미증명이다. 관측한 소유 PID와 읽기 가능한 /proc 범위를 넘는 자식 전체 종료를 보장하지 않는다. 서명·공증·Gatekeeper·Mac x64 설치·Wayland·실브라우저 승인·재부팅/업데이트·실사용자·운영 배포는 미검증이다. 9eeccee 로컬 QA exe는 이전 정적 검사본이며 이 CI 설치본으로 교체하지 않는다.

## phase14 Intel Mac 실제 설치 CI — 394d47e8

제품 `394d47e8a24d2284b62bfefa2e2df173a3278012`의 [CI 39044291095](https://github.com/csm-kr/haparkchopaeng-workspace/actions/runs/39044291095)는 **completed/success, 6 jobs 모두 성공**이다. 실제 PR merge 소스는 `d6440d02b00ab40ef206c5bc09f22f028b227010`이다. Intel은 빌드만 확인한 과거 기록과 달리 실제 x64 runner에서 설치·실행했다.

| job | 직접 확인한 결과 |
| --- | --- |
| [Web 117429827918](https://github.com/csm-kr/haparkchopaeng-workspace/actions/runs/39044291095/job/117429827918) | 120 suites·946 tests·Chromium 8개·Harness/lint/build·HTTP cookie-loss PASS |
| [PG 117429827644](https://github.com/csm-kr/haparkchopaeng-workspace/actions/runs/39044291095/job/117429827644) | PostgreSQL 16 실제 13개·drift 0 PASS |
| [Windows 117429827891](https://github.com/csm-kr/haparkchopaeng-workspace/actions/runs/39044291095/job/117429827891) | preflight 2/full 5 checks·코어 9개 SHA·실제 cold OS URI/가시 창/WM_CLOSE·warm same PID/parser·정상 IPC·프로필/프로세스 정리·자체 제거·handler 복구 PASS |
| [Mac arm64 117429827856](https://github.com/csm-kr/haparkchopaeng-workspace/actions/runs/39044291095/job/117429827856) | process.arch/RUNNER_ARCH=arm64/ARM64 실측, 실제 installed 9 checks·전체 소유 cleanup PASS |
| [Mac Intel 117429827893](https://github.com/csm-kr/haparkchopaeng-workspace/actions/runs/39044291095/job/117429827893) | process.arch/RUNNER_ARCH=x64/X64 실측, 실제 installed 9 checks·전체 소유 cleanup PASS |
| [Ubuntu 117429827885](https://github.com/csm-kr/haparkchopaeng-workspace/actions/runs/39044291095/job/117429827885) | 실제 .deb 설치 8 checks·sandbox·cold/warm·정상 IPC·package/AppArmor/profile/handler/opener/Temp 정리 PASS |

두 Mac 모두 읽기 전용 DMG mount→소유 Applications 복사→코어 9개 SHA·번들 Node→LaunchServices 기본 handler→cold/warm 같은 PID→정상 IPC→다시 cold/IPC→프로필·앱·mount·handler·소유 프로세스/Temp 제거를 통과했다. ASCII bundle/main/Helper 4개와 한글 표시/runtime·새 한글 프로필 위치를 유지했다. 기존 기기 키 이전 검증은 아니다.

| 이번 CI 산출물 | bytes | SHA256 |
| --- | ---: | --- |
| Windows NSIS unsigned QA | 111584107 | `187b43b10937821bc00565f0d2272f044afb8034b3156cc359fd623b944ab487` |
| Mac arm64 DMG · 실제 설치 PASS | 128089057 | `e0a0d5d9361cdb13f54eff6d5973e9914f6c4c0b53fe3c2c0485c8329cd880c8` |
| Mac Intel x64 DMG · 실제 설치 PASS | 131861538 | `206a492edaf78ed6cd1f386d1b35c0842f4427bc3cdd4ed035abf905a2994af4` |
| Ubuntu .deb | 별도 크기 미측정 | `92924c8a92a57e55b73b4ef22ee444f761064aff20bc0814f3f6f0570a5b5223` |

arm64는 adHoc=true·strict verify exit1/valid=false/reason unknown·Gatekeeper exit1/accepted=false다. Intel x64는 adHoc=false·strict verify exit1/valid=false/reason unsigned·Gatekeeper exit3/accepted=false다. 두 아키텍처 모두 Developer ID·공증 미완료, quarantine 없음/미변경이며 설치·기동 성공을 서명 승인으로 해석하지 않는다.

phase14 추가 step3 하네스 AC도 실제 60개 PASS이며 현재 4 steps completed다. overallGoalComplete=false·운영 외부 gate 3개는 유지한다.

Node **139개**, 실제 Mac builder 구현 회귀 **5개**, 각 Mac의 installed **9 checks**는 별도 검증이며 합산하지 않는다. 공통 `57ce17397a5a2c8b38028e3cbbfdb0e4bd2e9429`의 [CI 39044299350](https://github.com/csm-kr/local-agent-connector/actions/runs/39044299350)도 4 jobs 모두 성공했고 Node 165개·builder 5개·각 Mac installed 9 checks를 별도로 기록한다.

직전 제품 `86b98d8f`/CI 39043732926의 5 jobs와 공통 `2fad9a9a`/CI 39043744517의 3 jobs도 당시 성공 기록이다. 이전 `c808e926`/`1e309c3f`·`9eeccee`/`e5e6a612`와 각 실행의 설치본 해시는 보존하며 새 산출물의 해시로 재사용하지 않는다.

서명·공증·Gatekeeper 승인, 실제 브라우저 승인·운영 인증/추론·기존 기기 키 이전·재부팅/업데이트·Wayland는 미검증이다. 설치 smoke는 invalid URI를 자격 정보 저장·API ACK·CLI adapter 구성 전에 거절하며 실제 추론은 0회다. 독립 네트워크 실측이 아니고 unpackaged 암호화·재개·손상 복구 13조건과 별도다. Ubuntu는 GUI·키링·CJK 글꼴·X11·정상 sandbox 전제이며 원래 argv·cold renderer 상태를 증명하지 않는다. `overallGoalComplete=false`·운영 외부 gate 3개는 유지한다. 9eeccee 로컬 QA exe는 과거 정적 검사본으로 파일명·링크·SHA를 유지한다.


## 2026-10-24 · 0.1.11 상태별 ImageGen 브리 배포

제품 소스 `c65c73c846fbeadb6aa8899e494bb242a11b7fca`의 동일 태그 CI 40066225682는 최종 5개 job 모두 성공했고, 게시 workflow 40067055378도 3개 job 모두 성공했다. Windows·Mac arm64·Ubuntu의 검증된 설치 파일을 공개하고 Production 다운로드 목록의 0.1.11을 운영 API에서 재확인했다. 파일별 SHA256·크기·실행 링크와 첫 Mac cleanup 실패/재실행의 구분은 [배포 기록](../phases/25-bri-stateful-companion/RELEASE.md)을 따른다. CI 설치·정리와 신규 격리 프로필 범위이며 실제 계정 추론·기존 사용자 업그레이드·정식 게시자 서명은 포함하지 않는다.
