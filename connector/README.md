# AI 브릿지

웹에서 내 PC에 설치하고 로그인한 Codex·Claude Code를 사용하는 앱이다. 표시 이름은 **AI 브릿지**다. Node 기반 실행 코어와 Electron 데스크톱 앱을 별도 패키지로 나눴다. 최종 사용자는 AI 브릿지 설치본만 설치하며 Node·npm을 따로 설치하지 않는다. 사용할 CLI와 해당 구독 계정 로그인은 필요하다.

현재 하박조팽 배포 주소는 **https://hapark.vercel.app** 이다. URI나 웹 요청이 새 서버 주소를 지정할 수 없으며 빌드에 등록한 origin으로만 통신한다.

## 사용자 흐름

1. 웹의 **AI 연결**에서 연결앱 열기를 누른다. 설치된 앱은 OS가 등록한 `hapark-connect://` 링크로 실행한다.
2. 최초 사용자는 설치본을 다운로드하고 실행한다. 설치가 끝나 앱이 처음 열리면 등록된 웹의 `/profile?localAgentResume=1`로 돌아가 로그인과 연결 요청을 확인한다.
3. 브라우저가 앱 열기를 막으면 웹의 **연결앱으로 돌아가기**를 누른다. 브라우저·OS의 다운로드, 설치, 전용 링크 확인을 우회하지 않는다.
4. 앱에 사이트·팀·계정과 **빈 6자리 입력란**이 표시된다. 웹에서 본 번호를 입력한다. 번호는 URI에 넣거나 자동 입력하지 않는다.
5. 연결 뒤 웹에서 AI와 모델을 직접 선택한다. 처음 선택된 기본 모델은 없다. 이후 동일 기기는 암호화된 기기 키를 재사용하고 웹이 새로 승인한 연결을 이어 간다.
6. 권한 lease가 잠깐 끊기면(서버의 `WEB_PERMISSION_EXPIRED` 또는 앱이 본 만료) 실행 중인 CLI만 취소하고, 최대 10분 동안 '복구 중'으로 heartbeat를 보내다가 웹이 갱신하면 같은 연결을 이어 간다. 웹 로그아웃·세션 만료·연결 해제나 10분을 넘긴 만료는 실행을 취소하고 연결을 끝낸다. 앱 창이 보이면 다시 연결할 안내를 유지한다. 기본 설정에서 창을 숨긴 상태라면 실행 정리 후 앱도 종료한다.

처음 설치할 때 OS에 프로토콜 핸들러를 등록하므로 웹이 설치 경로를 알 필요가 없다. 앱이 꺼져 있어도 다음 웹 버튼이 실행한다. Windows는 사용자 단위 설치, macOS는 `AI Bridge.app`을 Applications에 복사(이전 `hapark-connector.app`은 새 앱이 처음 실행될 때 휴지통으로 이동), Ubuntu는 .deb 데스크톱 패키지/런처 등록을 사용한다. 각 OS의 실제 설치 검증 범위는 아래를 따른다.

자동 시작과 펫은 기본으로 꺼져 있다. 사용자가 켠 경우에만 해당 백그라운드 상태를 유지한다. 웹 연결이 유효한 동안 X를 누르면 창을 숨기고 현재 연결을 유지하며 **앱 종료**는 명시적으로 취소 후 종료한다. 기본 설정에서는 웹 권한이 끝나면 숨은 앱을 남기지 않는다.

작은 펫 브리는 ImageGen으로 만든 투명 스프라이트와 짙은 얼굴·라임색 테두리를 사용한다. 대기 중에는 6초 주기로 3px만 위아래로 부유하고, 실제 작업 중에는 작은 키보드의 두 프레임과 **일하는 중** 문구를 표시한다. 연결 중·복구 중·웹 권한 종료·오류는 각각 고정 문구와 상태에 맞는 표정으로 구분한다. 눈 깜빡임과 가끔 하는 인사는 장식이며 작업 성공을 뜻하지 않는다. 동작 줄이기에서는 반복 동작을 멈추고 정적인 표정과 문구를 유지한다. 펫이 꺼져 있어도 메인 창의 배지로 작업·복구 상태를 확인한다. [펫 표시와 표정 설계](../docs/design/AI_BRIDGE_TRAY_CHARACTER.md)를 따른다.

## 개발 실행

개발 환경은 Node 22 이상을 대상으로 한다. 이 저장소에서는 Node 24.15.0으로 검증했다.

```powershell
npm --prefix connector test
npm --prefix connector/desktop ci
npm --prefix connector/desktop run start:dev
```

개발 실행은 `http://localhost:3000`, `http://127.0.0.1:3000`만 허용한다. `start:dev`는 기본 브라우저를 자동으로 열지 않는다. 실제 웹의 인증된 연결 요청이 있어야 질문을 실행한다.

```powershell
# 실제 CLI 버전·인증 종류·모델 목록·제공되는 사용 한도만 조회한다. 추론하지 않는다.
npm --prefix connector run smoke

# 독립 loopback fixture + 숨김 Electron UI 회귀. 포트 3000을 비워 둔다.
npm --prefix connector run qa:desktop

# Windows 설치본 빌드 후 실행. 기존 동명 앱·프로토콜이 없는 깨끗한 사용자만 허용한다.
npm --prefix connector run qa:install
```

UI 회귀는 사용자의 브라우저에 연결하지 않는다. 작업 전용 Electron의 CDP만 사용하고 실제 모델 작업을 적재하지 않는다. Windows 네이티브 닫기 검증은 소유한 앱 PID에만 WM_CLOSE를 전송한다. 산출물과 격리 프로필은 각각 무시되는 `artifacts/`와 작업별 임시 폴더에 둔다.

기존 기본 설치 회귀는 GUID 임시 경로에 NSIS를 무인 설치하고 전용링크 등록 대상·코어·번들 Node를 확인한 뒤 자체 제거해 기존 ‘등록 없음’ 상태로 복구했다. 그 범위에서는 GUI·브라우저·모델 추론을 실행하지 않았고 당시 Windows CI도 통과했다. 후속 phase14의 실제 설치 앱·OS URI 실행 결과는 아래 OS 표와 구분한다. 세 OS의 `node connector/scripts/ci-desktop-smoke.mjs`는 unpackaged Electron·실제 OS 암호화 저장소와 loopback API fixture로 첫 연결·정상 종료 후 재개·손상 복구 13조건을 검증한다. 키링을 모의 구현하거나 평문 저장을 허용하지 않으며 모델을 호출하지 않는다. Linux는 workflow의 가상 디스플레이·D-Bus·키링·공식 sandbox 준비가 필요하다.

`scripts/smoke.mjs --infer`는 실제 구독 사용량을 소비한다. 자동 테스트와 UI 회귀에서는 호출하지 않는다.

## 설치본 만들기

운영 빌드는 HTTPS origin 설정이 없거나 개발용 manifest이면 실패한다. 설치본을 배포하기 전에 플랫폼별 서명·다운로드 게시가 필요하다.

```powershell
$env:CONNECTOR_APP_ORIGIN = 'https://hapark.vercel.app'
npm --prefix connector/desktop run package:win
```

```sh
CONNECTOR_APP_ORIGIN=https://hapark.vercel.app npm --prefix connector/desktop run package:mac
CONNECTOR_APP_ORIGIN=https://hapark.vercel.app npm --prefix connector/desktop run package:linux
```

각 OS에서 해당 빌드를 실행한다. 출력은 `connector/dist/`다. Linux 빌드 대상은 .deb만이다. 제품 `394d47e8` CI에서 Windows 실제 설치·cold/warm URI·정상 종료·제거, Mac arm64·Intel x64 각각 설치 9 checks와 Ubuntu 격리 X11 설치 8 checks가 통과했다. Windows는 unsigned QA artifact이며 서명 완료를 검증하지 않았다. Mac arm64는 ad hoc 서명, Intel x64는 미서명이며 두 아키텍처 모두 Developer ID·notarization·Gatekeeper 승인은 미완료다. 실사용자의 설치 승인과 정식 배포도 별도다. 자동 업데이트는 구현하지 않았으며 새 설치본으로 갱신하는 절차도 검증해야 한다. 실행별 해시와 실제 검증 범위는 [VALIDATION.md](VALIDATION.md)를 따른다.

Electron의 Node 런타임을 앱에 포함한다. `desktop/node_modules`, `dist`, `artifacts`, 실제 환경의 `desktop/apps.generated.json`은 Git에 포함하지 않는다. CLI 로그인 토큰이나 OS 보안 저장소의 기기 키를 빌드·로그·저장소에 복사하지 않는다.

## 실행과 권한

- `core/security.mjs`: 등록 origin·URI·모델 ID 검증, 충돌하는 API 키 환경 변수 제거.
- `core/discovery.mjs`: 네이티브 CLI와 공식 npm 엔트리를 탐색한다. GUI 앱의 짧은 PATH를 고려하고 공식 JS 엔트리는 번들 Node로 실행한다. `.cmd`·`.ps1`을 셸 문자열로 실행하지 않는다.
- `core/adapters.mjs`: 추론 없는 메타데이터 조회, 논문 질문 전용 도구 없는 CLI 실행, 모델·실제 구독 한도 정규화.
- `core/runtime.mjs`: 서버의 scoped 작업을 하나씩 claim하고 답변 전체 스냅샷과 증가하는 sequence를 전송한다. heartbeat는 5초, claim은 2초, 웹 권한은 250ms마다 확인한다.
- `core/lifetime.mjs`: 취소와 메타데이터 프로세스 정리가 끝난 뒤 종료한다.
- `desktop/main.mjs`: 단일 인스턴스·전용 링크·OS 보안 저장소·격리 renderer·기본 꺼짐 설정.

서버 계약은 상위 앱의 `types/local-agent.ts`, `lib/local-agent/PROTOCOL.md`에 있다. 기기 키는 CLI 계정 토큰과 별개이며 32바이트 난수다. ACK/PAIR 외에는 Authorization Bearer + X-Local-Agent-Device로 보낸다. 웹 세션이 갱신한 lease만 실행 권한으로 인정하며 데스크톱 heartbeat는 웹 권한을 연장하지 않는다.

Codex는 ChatGPT 계정, Claude Code는 `claude.ai`·`firstParty` 구독 OAuth 로그인을 확인한다. API 키·Bedrock·Vertex 등 별도 과금 경로를 자동 활성화하지 않는다. 테스트한 최소 CLI는 Codex 0.163.0, Claude Code 2.1.301이다. 더 오래된 버전은 업데이트 안내로 멈춘다.

Codex는 read-only sandbox, 사용자 설정 무시, 임시 세션, 셸·이미지·멀티에이전트·MCP·웹·훅·플러그인 차단을 적용한다. Claude는 `--tools ''`, restricted/safe-mode, 빈 strict MCP, 빈 setting sources, slash command/세션 저장 차단과 verbatim 사용자 입력을 적용한다. 둘 다 격리한 임시 작업 디렉터리와 stdin 입력을 사용하며 셸 문자열로 질문을 합치지 않는다. 예상하지 못한 도구·승인 요청은 거절한다.

앱은 OS의 `app.getPath('userData')` 아래에 설정과 암호화된 `devices.enc.json`을 저장한다. 이름이 바뀌어도 기존 키를 유지하도록 프로필 폴더와 내부 암호화 서비스명은 `하박조팽 연결기`로 고정한다. 일반적으로 Windows는 Roaming AppData, macOS는 Library/Application Support, Linux는 사용자 config 영역이다. Linux의 보안 저장소가 `basic_text`이면 연결 키를 저장하지 않고 키링을 켜도록 안내한다.

보안 저장소는 활성 상태인데 기존 암호문을 읽을 수 없으면 원본을 `devices.enc.json.unreadable-UUID.enc.bak`으로 보존하고 새 6자리 번호로 다시 확인한다. 백업을 자동으로 복호화하거나 이전 키로 재승인하지 않는다. 보안 저장소 비활성·접근 권한·파일 읽기 오류는 이 복구로 처리하지 않는다. 정상 키와 다른 웹앱의 연결은 유지하며 읽기·저장·제거·백업은 같은 큐로 처리한다.

## 사용 한도와 모델

작은 링은 CLI가 제공한 기간만 표시한다. 300분이면 5시간, 10080분이면 7일로 구분하고 존재하지 않는 창은 만들지 않는다. 정확한 잔여 토큰 수로 환산하지 않는다. 값이 없으면 **한도 정보 미제공**, 마지막 실제 한도 관측에서 90초가 지나면 회색 링과 **이전 확인값**을 표시한다. 상세는 hover/키보드 focus/터치 시 표시하고 Escape·바깥 클릭으로 닫는다.

인증·모델 확인 시각은 `observedAt`, 실제 사용 한도 관측 시각은 `quotaObservedAt`이다. Claude 메타데이터 갱신이 오래된 한도를 새 값으로 보이게 하지 않는다. 모델 목록 조회 성공은 각 모델의 사용 권한이나 남은 한도를 보장하지 않는다. 실제 제한은 작업 오류로 반영한다.

## OS 범위와 다른 앱 적용

Windows x64에서는 로컬 실제 CLI·UI·보안 저장소·NSIS 설치/제거를 검증했다. 과거 [CI 실행 39028900156](https://github.com/csm-kr/haparkchopaeng-workspace/actions/runs/39028900156)에서는 Windows x64, macOS 15 arm64, Ubuntu 24.04 x64의 unpackaged Electron·실제 OS 암호화 저장·정상 앱 종료 후 재개·손상 복구 13조건을 각각 통과했다. API는 loopback fixture이며 세 runner에는 CLI가 설치되지 않아 실제 모델 추론·운영 웹·설치 앱의 OS URI 검증으로 확대하지 않는다. macOS DMG는 arm64/x64 모두 생성했지만 x64 네이티브 UI는 미검증이다.

Ubuntu는 GUI 세션, 활성 Secret Service/keyring, 한국어 표시 글꼴, 패키지별 URI 등록이 필요하다. 초기 CI 39028900156의 unpackaged 실행은 공식 Electron sandbox를 root:root/4755로 준비했고 한글이 글꼴 부재로 네모였다. 이는 당시 기록이며, 후속 [CI 39029600751](https://github.com/csm-kr/haparkchopaeng-workspace/actions/runs/39029600751)에서 CJK 글꼴을 준비한 캡처의 가독성을 확인했다. 현재의 실제 .deb 설치 결과는 다음 phase14 표를 따른다. AppImage는 builder의 샌드박스 비활성화 인수 경로 때문에 계속 빌드·배포 대상에서 제외한다. 이전 AppImage도 다운로드 목록에 등록하지 않는다. Wayland의 펫 위치·항상 위 표시에는 제약이 있어 자동 시작·펫을 필수로 삼지 않았다. Headless 서버 연결은 대상이 아니다.

### phase14 실제 설치본 · 최신 확정 상태

이전 제품 소스 `730ad8d`의 [CI 39041064640](https://github.com/csm-kr/haparkchopaeng-workspace/actions/runs/39041064640)는 Web·PostgreSQL·Windows·Linux job 성공, Mac 실패로 종료됐다. 웹 946개·별도 PG 13개·Chromium 8개·HTTP wire·pytest 60개·lint/build가 통과했다. 설치 영수증의 CI merge 소스는 `c926f9965458c089a2b38b4d0c4ceda631aea54c`다. `4c74a19`/CI 39039821379와 함께 당시 기록으로 보존하며 새 후보의 실제 결과와 구분한다.

새 제품 소스 `394d47e8a24d2284b62bfefa2e2df173a3278012`의 [CI 39044291095](https://github.com/csm-kr/haparkchopaeng-workspace/actions/runs/39044291095)는 **completed/success, 6개 job 모두 성공**이다. 웹 946개·Chromium 8개·HTTP wire·lint/build·하네스 guards와 별도 PostgreSQL 16의 13개·schema difference 없음, Windows 설치·Mac arm64·Intel x64 각 설치 9 checks·Ubuntu 설치 8 checks를 통과했다. Mac CFBundleName·Helper 이름을 ASCII로 맞추면서 한글 표시·ASAR 런타임 메타데이터와 기존 한글 프로필 경로 생성을 실제 확인했다. 기존 기기 키 이전은 검증하지 않았다. 로컬 pure 139/139·실제 builder 구현 회귀 5/5는 별도이며 웹 테스트 수와 합산하지 않는다.

별도 공통 저장소의 `57ce1739` [CI 39044299350](https://github.com/csm-kr/local-agent-connector/actions/runs/39044299350)는 Windows·Ubuntu·Mac arm64·Intel x64의 4개 job 모두 성공했다. Research Notebook 설정의 실제 설치·OS URI 검증이며 제품 Mac의 통과를 뜻하지 않는다. 실행별 5/9/8 checks와 해시는 [공통 검증 기록](https://github.com/csm-kr/local-agent-connector/blob/main/connector/VALIDATION.md)을 따른다.

전체 Node 회귀는 제품 **139개**·공통 **165개**, 실제 Mac builder 구현 회귀는 각 **5개**로 별도 통과했다. 설치된 코어 파일 9/10개, 웹 946개, installed-package 5/9/8 checks와 합산하지 않는다. 직전 제품 `9eeccee`/CI 39042209763과 공통 `e5e6a612`/CI 39041845705의 성공·해시는 각 VALIDATION 문서의 당시 기록으로 보존한다.

Intel 후속 phase14 하네스 step3 AC도 실제 60개 PASS이며 현재 4 steps completed다. 개발·설치 검증 구간 완료와 `overallGoalComplete=false`·운영 외부 gate 3개 유지를 구분한다.

| 환경 | 확인된 범위 | 남은 확인 |
| --- | --- | --- |
| 제품 Ubuntu 24.04 x64 | `394d47e8` [job 117429827885](https://github.com/csm-kr/haparkchopaeng-workspace/actions/runs/39044291095/job/117429827885) 성공. 실제 .deb 설치·코어 9개 SHA 대조·번들 Node·기본 URI handler·cold/warm 링크·가시 창·정상 닫기/quit IPC·purge/프로필/handler/AppArmor 정리 8조건 통과 | 격리 X11 CI 범위. 실사용자 GUI·인증 페어링·브라우저 승인·Wayland·재부팅·업데이트·정식 배포 |
| 제품 macOS arm64 | `394d47e8` [job 117429827856](https://github.com/csm-kr/haparkchopaeng-workspace/actions/runs/39044291095/job/117429827856) 성공. DMG 복사·코어 9개 SHA·번들 Node·ASCII 번들/Helper 4개·한글 표시/런타임/프로필 위치·cold/warm·정상 IPC 두 회차·제거 9 checks | ad hoc 서명·strict verify exit1 unknown·Gatekeeper 미통과. 기존 기기 키 이전, Finder·Developer ID·공증·운영 연결 미검증 |
| 제품 macOS Intel x64 | `394d47e8` [job 117429827893](https://github.com/csm-kr/haparkchopaeng-workspace/actions/runs/39044291095/job/117429827893) 성공. 실제 x64/X64 guard·DMG 설치·코어 9개 SHA·cold/warm·정상 IPC 두 회차·정리 9 checks | unsigned(adHoc=false)·strict verify exit1 unsigned·Gatekeeper exit3 미통과. 정식 서명·공증·운영 인증/추론은 미검증 |
| 제품 Windows x64 | `394d47e8` [job 117429827891](https://github.com/csm-kr/haparkchopaeng-workspace/actions/runs/39044291095/job/117429827891) 성공. 실제 NSIS 설치·등록·코어 9개 SHA·번들 Node·cold/warm URI·가시 창/WM_CLOSE·같은 PID·정상 IPC·프로필 정리·자체 제거·handler 없음 복구 | unsigned QA artifact. 서명·실제 브라우저 승인·인증 페어링·실사용자 재부팅/업데이트·운영 연결은 미검증 |

Ubuntu 설치본의 sandbox는 설치기가 선택한 root:root/0755·앱별 AppArmor loaded 상태이며 QA가 mode를 바꾸지 않았다. cold URI는 정확한 합성 process-title-token을 관측했으며 원래 argv는 미증명이다. 별도 직접 CDP 기동에서 browser/renderer native PID를 OS 실행 파일·UID·부모 트리와 대조하고 renderer Seccomp=2·NoNewPrivs=1을 확인했다. CLI·추론은 0회다. API ACK 이전 parser 경계로 해당 실행을 배제했으며 main-process 네트워크를 독립 측정한 것은 아니다. 설치본 8조건은 인증 페어링·OS 키 암호화를 다시 검증하지 않는다.

최신 실행별 설치본 SHA256과 직접 확인한 과거 `ec594c2` 영수증은 [VALIDATION.md](VALIDATION.md)의 phase14 추가 절에서 구분한다. 이전 해시를 최신 산출물에 재사용하지 않는다. Windows cold URI는 OS가 추가한 정확한 루트 `/` 변형으로 확인했으며 원문 exact 값이 false인 사실도 보존했다. macOS Finder·Keychain 확인창·서명/공증, 운영 최초 연결과 OS 업데이트·앱 이동·재부팅 후 링크 복구도 남아 있다. CI unpackaged 13조건, 실제 설치본, 실사용자·운영 검증을 구분한다.

다른 웹앱은 고유 appId·프로토콜·브랜드 자산·정적 HTTPS allowlist로 다시 구성하고 동일 REST 계약의 서버 어댑터를 제공한다. `parseLaunchUrl`과 암호화 저장소는 앱 ID별로 분리하지만, 사용자 입력 URI로 임의 origin을 추가하지 않는다. `scripts/configure-desktop.mjs`의 applications, 패키징 protocols, Windows `desktop/installer.nsh`의 프로토콜 키를 함께 변경한다. 이 폴더는 독립 Node 패키지이므로 별도 저장소로 추출할 수 있다.

직전 제품 `86b98d8f`/CI 39043732926의 5 jobs와 공통 `2fad9a9a`/CI 39043744517의 3 jobs도 당시 성공 기록이다. 이전 `c808e926`/`1e309c3f`·`9eeccee`/`e5e6a612`와 각 실행의 설치본 해시는 보존하며 새 산출물의 해시로 재사용하지 않는다. Mac의 과거 빌드만/Intel 미검증 표기는 당시 범위이며 최신 실증은 위 두 아키텍처 각 9 checks다.
