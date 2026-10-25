# 로컬 AI 연결 운영 배포 런북

## AI 브릿지 테스트 설치 파일 게시

앱 표시 이름은 **AI 브릿지**다. 현재 빌드 버전은 `connector/desktop/package.json`을 따르며, 0.1.6에는 밝은 배경의 펫 대비와 눈 깜빡임·미소가 포함된다. 공개된 다운로드 버전은 실제 게시 영수증과 운영 다운로드 API에서 확인한다. 기존 `hapark-connect` 링크·앱 ID·OS 프로필과 내부 암호화 서비스명은 유지한다. 정식 게시자 서명 전에는 테스트 버전으로 구분한다.

Windows 파일은 정확한 소스와 실제 NSIS 설치·제거·코어 일치를 확인한 뒤 draft prerelease에 올린다. Mac arm64(Apple Silicon)와 Ubuntu x64는 수동 실행 전용 [미리보기 게시 워크플로](../../.github/workflows/ai-bridge-preview.yml)를 사용한다. 기존 PR 검증의 읽기 권한은 유지한다. 이 워크플로는 사전 생성한 태그·정확한 SHA·같은 SHA의 6개 CI 성공·draft prerelease를 확인하고, 네이티브 암호화와 실제 설치를 통과한 자기 아키텍처의 파일 하나와 해시 메타데이터만 직접 업로드한다. Actions artifact 저장소는 사용하지 않는다.

모든 파일의 소스·크기·SHA256을 확인한 뒤 draft를 테스트 릴리스로 공개한다. 기존 동명 파일을 덮어쓰지 않는다. 서버 `LOCAL_AGENT_RELEASES`에는 공개되어 다운로드 가능한 실제 URL만 넣고, 게시자 서명이 없는 파일은 `unsigned: true`로 명시한다. 이 필드는 신뢰할 수 있는 게시자 서명이 없다는 뜻이며 Mac의 ad hoc 서명 여부와 별개다. 운영 웹에서 OS·칩 선택과 다운로드 안내까지 확인한다.

테스트 파일 게시를 Windows 게시자 서명·Mac Developer ID/공증·Gatekeeper 승인이나 실사용자의 전체 페어링·추론 검증으로 보고하지 않는다. 현재 실제 게시 결과와 URL·소스·검증 영수증은 HTML 배포 보고서에 별도로 기록한다.

## 2026-10-24 브리 0.1.11 게시

상태별 ImageGen 브리를 포함한 [0.1.11 테스트 릴리스](https://github.com/csm-kr/haparkchopaeng-workspace/releases/tag/ai-bridge-v0.1.11-preview.1)를 Windows x64·Mac Apple Silicon·Ubuntu x64로 공개했다. 동일 소스 태그의 5개 CI job과 게시 workflow 3개 job이 모두 성공했고, 각 파일 SHA256·크기·공개 HTTP 200을 확인했다. Production 다운로드 설정을 갱신한 뒤 운영 API에서 세 OS 모두 0.1.11을 다시 확인했다. 정확한 소스·파일 해시·배포 영수증과 검증 범위는 [배포 기록](../../phases/25-bri-stateful-companion/RELEASE.md)을 따른다. 기존 unsigned prerelease 채널이며 사용자 컴퓨터의 기존 설치 앱은 자동으로 교체하지 않는다.

## 2026-10-24 0.1.12 게시

연결 창 통합·로컬 CLI 상태와 터미널 열기 버튼을 포함한 [0.1.12 테스트 릴리스](https://github.com/csm-kr/haparkchopaeng-workspace/releases/tag/ai-bridge-v0.1.12-preview.2)를 Windows x64·Mac Apple Silicon·Ubuntu x64로 공개했다. 소스는 `604e8a746e161bf627852685ac328ff334dd92f2`이고 PR45 병합 커밋 `526842f`와 Git tree가 같다. PR CI 40070846181과 같은 태그 CI 40071138156이 각각 5개 job, 게시 workflow 40071844526이 3개 job 모두 성공했다. 세 파일을 익명으로 다시 받아 HTTP 200·크기·SHA256을 확인했다. Production 배포는 `dpl_DKTN8TnjRNn371ufHen9vArN7c6B`이고, 바꾼 환경 변수는 `LOCAL_AGENT_RELEASES` 하나다. 로그인한 운영 다운로드 API에서 세 OS 모두 0.1.12를 다시 확인했다.

| 파일 | bytes | SHA256 |
| --- | ---: | --- |
| AI-Bridge-0.1.12-linux-x64.deb | 99521112 | `e97147bc316fbcced560aafe09788b04bce25f808048dd1584ac916e5c511f72` |
| AI-Bridge-0.1.12-mac-arm64.dmg | 128512934 | `496dad30ca9e8f024a7580c0762db8f609f5e0db45d7bdb7dd6185831b2e2acd` |
| AI-Bridge-0.1.12-win-x64.exe | 111719001 | `a0d80e95b03b3fdec70a838567eb01006cb219159c2f9512af0c5c2448f1f708` |

실제 CLI 확인 범위: Codex 요청 1건은 정상 응답을 받았고 Claude 요청 1건은 `RATE_LIMITED`로 끝나 Claude 완료는 확인하지 못했다. Mac은 ad hoc 서명 무결성만 확인했으며 Developer ID·공증·Gatekeeper 승인은 아니다. 게시 당시 사용자 PC의 설치 앱은 0.1.11이었고 자동으로 교체하지 않았다. 원본 영수증은 게시 세션의 로컬 임시 폴더에만 있었으므로 이 절을 정본 기록으로 삼는다.

## 2026-10-18 운영 반영 기록

사용자의 운영 배포 요청에 따라 Supabase `ocprfnjuakugiraimeoo`의 `postgres/public`을 확인하고 두 20261017 SQL을 한 트랜잭션으로 반영했다. 반영 전 실제 Prisma schema diff는 예정한 6테이블·7컬럼 추가와 일치했고, 반영 후 `prisma migrate diff --exit-code`는 **0 / No difference detected**다. 새 PK 6개·FK 12개·PK 포함 인덱스 19개와 기존 논문 11개·분석 22개·Figure 63개·멤버 12명·팀 4개를 확인했다.

운영의 기존 public 테이블에는 RLS가 켜져 있고 기본 ACL에 비신뢰 역할의 TRUNCATE 등이 남아 있었다. 새 6테이블에만 [접근 제한 SQL](sql/20261018-local-agent-table-access.sql)을 같은 트랜잭션에 추가했다. `PUBLIC/anon/authenticated/service_role`의 테이블 권한을 모두 회수하고 RLS를 켰다(정책 0개, FORCE 없음). 실제 역할 권한 검사 18개가 모두 거부되고 소유자 `postgres`의 서버 접근을 유지한다. 기존 테이블과 default privileges는 변경하지 않았다.

반영 직전 24개 public 테이블의 데이터·스키마 메타데이터를 로컬 비공개 논리 백업으로 저장하고 압축 해제·행 수를 확인했다. SHA256은 `862839408626ef94c17f36241f03fc0162d22593544efd10aad8ac9bf6787f2b`다. Auth·Storage는 이번 변경 대상이 아니며 백업에서 제외했다. 복원 절차와 원본 schema를 함께 보관했으며 실제 복원 연습은 미실행이다. 웹 승격·Inngest 동기화와 설치 파일 게시 여부는 별도 최종 배포 영수증에 기록한다. 아래 과거 미적용 설명은 해당 시점의 이력이다.

연결기 기준 `d54a1fd`의 [CI 39029600751](https://github.com/csm-kr/haparkchopaeng-workspace/actions/runs/39029600751)에서 웹 852개·PostgreSQL 16 동시성 8개·3 OS native를 확인했다. 이후 로컬 논문 분석·AI 채팅을 추가한 `3f16685`의 [CI 39033348260](https://github.com/csm-kr/haparkchopaeng-workspace/actions/runs/39033348260)에서 웹 946개·PostgreSQL 13개·Chromium 8개·HTTP 계약·3 OS native/패키징의 5 jobs가 성공했다. [새 기능 검증 HTML](../reports/local-ai-research-chat-2026-10-17.html)을 함께 확인한다. 운영 DB 반영·Production 승격·정식 설치 파일 게시 기록은 아직 없다. 실제 배포에는 최종 커밋, 해당 CI, 서명한 설치 파일의 SHA256을 한 묶음으로 기록한다.

동작 계약은 [LOCAL_AGENT](LOCAL_AGENT.md)와 [연구 채팅 설계](../design/LOCAL_AI_RESEARCH_CHAT.md), 플랫폼별 검증 근거는 [connector/VALIDATION](../../connector/VALIDATION.md)를 따른다. 적용 SQL은 [연결기 5테이블](sql/20261017-local-agent-connection.sql) 다음 [논문 본문·분석 실행·대화 확장](sql/20261017-local-ai-research-chat.sql) 순서다.

## 실행 권한과 담당

사용자가 승인한 개발·격리 DB 검증·CI·개발 설치본 생성·전용 환경 설치/제거 검증은 계속 진행할 수 있다. 운영 DB는 별도 수동 검토 단계다. [ADR-020/022/025](../agent/ADR.md)는 각각 “실제 push/백필 실행은 사람이 검토 후 한다”, “사람이 검토 후 수동 실행”, “사람의 SQL 검토·수동 실행 대상”으로 정한다. [LOCAL_AGENT](LOCAL_AGENT.md)의 운영 적용 조항도 같은 원칙을 따른다.

| 담당 | 확인·실행할 일 |
| --- | --- |
| 개발 담당 | 최종 소스·SQL·CI·설치 파일·해시·미검증 범위를 검토 가능하게 준비 |
| 운영 DB 담당 | 정확한 Supabase 프로젝트·스키마·백업/복원 지점 확인, SQL 검토와 수동 반영 |
| 배포 담당 | 게시자·서명 리소스·다운로드 위치 확정, 검증된 파일 게시, 환경 설정과 웹 승격 |
| 파일럿 사용자 | 실제 브라우저·설치본·기존 CLI 로그인으로 연결과 권한 회수 확인 |

`ISSUES`의 알림 채널 I-5는 이 기능의 짧은 REST 조회에 적용되는 추가 배포 gate가 아니다. 서명 비밀은 배포용 보안 저장소에서 주입하며 채팅·문서·저장소에 값을 복사하지 않는다.

## 1. 배포 후보와 지원 범위 고정

최종 커밋과 CI 실행 링크, SQL 검토 결과, 설치본 이름·버전·아키텍처·SHA256·서명 상태, 설치/재실행/업데이트/제거 결과를 남긴다. 코어가 바뀌면 패키지를 다시 만들고 설치된 코어 9개 모듈이 소스와 일치하는지 확인한다.

| 환경 | 확인된 근거 | 정식 배포 전 남은 확인 |
| --- | --- | --- |
| Windows x64 | 과거 암호화·재개·손상 복구에 더해 `394d47e8`의 실제 NSIS 설치·등록·cold/warm URI·가시 창/WM_CLOSE·정상 IPC·프로필 정리·자체 제거·handler 없음 복구 통과 | unsigned QA artifact. 게시자 서명, 실사용자 브라우저 승인·인증 페어링·재부팅/업데이트·운영 연결 |
| macOS arm64 | `394d47e8` 실제 DMG 설치·ASCII 번들/Helper 4개·한글 표시/런타임/새 프로필 위치·cold/warm·정상 IPC 두 회차·제거 9 checks 통과. 이전 `730ad8d`의 SIGTRAP은 당시 실패로 보존 | ad hoc 서명·strict verify exit1 unknown·Gatekeeper 미통과. 기존 기기 키 이전, Developer ID·공증·실사용자·운영 검증 |
| macOS Intel x64 | `394d47e8` 실제 x64/X64 guard·DMG 설치·cold/warm·정상 IPC 두 회차·정리 9 checks PASS | unsigned·strict verify exit1 unsigned·Gatekeeper exit3 미통과. 최종 서명본의 실제 인증·암호화 보관/재개·실사용자·운영 검증 |
| Ubuntu GUI x64 | 기존 암호화·재개·손상 복구 13조건과 별도로, phase14에서 실제 .deb 설치·전용 링크 cold/warm 실행·샌드박스·정상 종료·제거 8조건 통과 | 최종 배포본으로 실제 사용자 브라우저 승인·인증 페어링·GUI 설치 경험, 업데이트·재부팅·Wayland |

과거 unpackaged 암호화 13조건의 근거는 [실행 39029600751](https://github.com/csm-kr/haparkchopaeng-workspace/actions/runs/39029600751)이다. 실제 Electron·OS 암호화 저장소를 사용했으며 서버 API만 loopback fixture다. 그 실행은 실제 모델 추론·운영 웹·설치 앱 URI를 검증하지 않았다. 최신 설치본 결과와 구분하며 macOS x64는 여전히 DMG 생성만 확인했다.

Ubuntu는 GUI와 안전한 키링, 한국어 표시가 가능한 글꼴이 필요하다. `basic_text` 저장소는 차단한다. 해당 CI는 공식 sandbox의 root:root/4755 준비와 CJK 글꼴을 확인했고 한글 캡처 가독성을 검토했다. X11/Wayland의 펫 위치·항상 위 제약, headless 미지원도 안내한다. 각 OS의 완료 근거가 확보된 아키텍처만 다운로드 목록에 등록한다.

Ubuntu 배포 후보는 .deb만이다. builder의 기본 AppImage launcher에서 샌드박스 비활성화 경로를 확인해 AppImage를 빌드·배포 대상에서 제외했다. 이전 CI가 만든 AppImage는 Git에서 제외한 개발 산출물로 보류하고 `LOCAL_AGENT_RELEASES`에 등록하지 않는다. 안전한 AppImage 대안 개발은 이번 배포 범위 밖이다.

### phase14 최신 Intel 실제 설치 CI — 394d47e8 / 57ce1739

제품 `394d47e8a24d2284b62bfefa2e2df173a3278012` [CI 39044291095](https://github.com/csm-kr/haparkchopaeng-workspace/actions/runs/39044291095) **6 jobs 모두 success**, 공통 `57ce17397a5a2c8b38028e3cbbfdb0e4bd2e9429` [CI 39044299350](https://github.com/csm-kr/local-agent-connector/actions/runs/39044299350) **4 jobs 모두 success**다. 제품 웹 946개·Chromium 8개·lint/build/HTTP cookie-loss와 PG16 실제 13개·drift 0, 양 저장소의 Windows actual full 5/preflight 2·Ubuntu 설치 8 checks, Mac arm64·Intel x64 각각 installed 9 checks와 전체 소유 정리를 확인했다.

Intel 후속 phase14 step3 하네스 AC도 실제 60개 PASS로 기록해 현재 4 steps completed다. overallGoalComplete=false·운영 외부 gate 3개는 유지한다.

Mac guard는 process.arch/RUNNER_ARCH=arm64/ARM64·x64/X64를 실제로 확인했다. 양 아키텍처의 ASCII 내부 이름·표시/runtime·기존 프로필 위치 설정을 유지하며 새 프로필 생성·정리를 확인했다. 기존 기기 키 이전이나 최종 운영 인증 페어링을 검증한 것은 아니다. 제품 Node 139개·공통 165개·각 builder 구현 회귀 5개·각 installed checks는 합산하지 않는다.

| 이번 CI 산출물 | bytes | SHA256 |
| --- | ---: | --- |
| Windows NSIS unsigned QA | 111584107 | `187b43b10937821bc00565f0d2272f044afb8034b3156cc359fd623b944ab487` |
| Mac arm64 DMG · 실제 설치 PASS | 128089057 | `e0a0d5d9361cdb13f54eff6d5973e9914f6c4c0b53fe3c2c0485c8329cd880c8` |
| Mac Intel x64 DMG · 실제 설치 PASS | 131861538 | `206a492edaf78ed6cd1f386d1b35c0842f4427bc3cdd4ed035abf905a2994af4` |
| Ubuntu .deb | 별도 크기 미측정 | `92924c8a92a57e55b73b4ef22ee444f761064aff20bc0814f3f6f0570a5b5223` |

공통 arm64 DMG는 128087666 bytes·SHA256 `e83063073b44b34265bbb86b5a5d4346fd332a47cc889b16dcf5476f8208fadb`, Intel x64 DMG는 131872368 bytes·SHA256 `52a830b3281cf889a004c8f4beef35db20852491181f65f9b895b9e3e8120849`이며 **둘 다 실제 설치 9 checks**가 통과했다. 공통 Windows는 110619701 bytes·SHA256 `414327149c42d94cfb12145e4381e8f6675c2bd1f39109c8c5bcd754dd5af54c5`, Ubuntu .deb는 SHA256 `47b1e5e684d3da1786fcb0a3ac729413601d4d036d3423bbb9f636aa4e7b2f64`다. 상세는 [제품 검증 기록](../../connector/VALIDATION.md)과 [공통 검증 기록](https://github.com/csm-kr/local-agent-connector/blob/main/connector/VALIDATION.md)을 따른다.

arm64는 adHoc=true·strict verify exit1/valid=false/reason unknown·Gatekeeper exit1/accepted=false다. Intel x64는 adHoc=false·strict verify exit1/valid=false/reason unsigned·Gatekeeper exit3/accepted=false다. 두 아키텍처 모두 Developer ID·공증 미완료, quarantine 없음/미변경이며 설치·기동 성공을 서명 승인으로 해석하지 않는다.

직전 제품 `86b98d8f`/CI 39043732926의 5 jobs와 공통 `2fad9a9a`/CI 39043744517의 3 jobs도 당시 성공 기록이다. 이전 `c808e926`/`1e309c3f`·`9eeccee`/`e5e6a612`와 각 실행의 설치본 해시는 보존하며 새 산출물의 해시로 재사용하지 않는다. 9eeccee 로컬 QA exe는 과거 정적 검사본이며 링크·해시를 유지한다. 운영 SQL 사람 검토·수동 반영, 서명/공증과 게시, 실사용자 운영 파일럿의 외부 gate 3개와 overallGoalComplete=false는 유지한다.

### phase14 직전 확정 CI — c808e926 / 1e309c3f · 당시 기록 보존

제품 `c808e926301a6937b78383ebf064bb97cf20d909` [CI 39042877981](https://github.com/csm-kr/haparkchopaeng-workspace/actions/runs/39042877981)는 **5 jobs 모두 success**, 공통 `1e309c3f3d2fe1a333029e23bffea3945a3c4fc7` [CI 39042868288](https://github.com/csm-kr/local-agent-connector/actions/runs/39042868288)는 **3 OS 모두 success**다. 제품 Web 120 suites·946 tests·Chromium 8개·Harness/lint/build/HTTP cookie-loss와 PostgreSQL 16 실제 13개·drift 0이 통과했다. 양쪽 Windows 실제 설치·cold/warm·정상 종료·제거, Mac arm64 실제 설치 9 checks, Ubuntu 실제 설치 8 checks와 소유 정리를 확인했다.

제품 Node **139개**·공통 **165개**, 실제 Mac builder 구현 회귀 각 **5개**는 별도이며 웹·PG·설치 checks와 합산하지 않는다. Mac ASCII 내부 이름과 표시/runtime·기존 프로필 위치 설정 유지가 실제 통과했다. 새 프로필 검증이므로 기존 기기 키 이전으로 확대하지 않는다.

phase14 하네스 step2 60개 PASS·3 steps completed로 개발·설치 검증 구간을 마쳤다. 전체 목표는 `overallGoalComplete=false`이고 운영 외부 gate 3개를 유지한다. 이 기록은 운영 SQL·배포·서명 승인을 대신하지 않는다.

| 최신 제품 산출물 | bytes | SHA256 |
| --- | ---: | --- |
| Windows CI unsigned NSIS | 111584109 | `66089d657386c5cdf30ca07bd90c81e6a609686c0910208e8329a510945e908f` |
| Mac arm64 DMG · 설치 PASS | 128089257 | `49773e4f88016e29821d743e54befd896d10006adff1a4f1f38e687279942585` |
| Mac x64 DMG · 빌드만 | 131861438 | `1ca0b2c5a5e554805d88435242bdb2ac33ca58554963a6b34d562900e570d73a` |
| Ubuntu .deb | 별도 크기 미측정 | `856af88ed0f0a2ecfa8d9b1ce62b836fd8c3cc628d0b20fef53b0d8ce3148875` |

공통 Windows NSIS는 110,619,701 bytes·SHA256 `bc0f2ccecc8fc0b4e1b37d6e1dbd85ca5e62f027b99d57086286787b599f147d`, arm64 DMG는 128,087,768 bytes·SHA256 `dccfa7da8de558ca8fadff7190b656c9e2663265048fb6f37e11a21cf3db37ad`, Ubuntu .deb는 SHA256 `ea133e8f7d98843749f06b882ffc0e637ff9c0d0f0c406d267bd618e564a7ff9`다. 공통 x64 DMG 131,871,917 bytes·SHA256 `3cf94ea2b95ddba9cbf83ac0114ce96d1a37767ef4fa22fa77c3771ee301a100`도 빌드만 확인했다. 실행별 상세는 [제품 검증 기록](../../connector/VALIDATION.md)과 [공통 검증 기록](https://github.com/csm-kr/local-agent-connector/blob/main/connector/VALIDATION.md)을 따른다.

양 Mac은 ad hoc 서명·strict verify exit1 unknown·Gatekeeper 미통과다. 게시자 서명·Developer ID/공증·실사용자 승인·인증 페어링·재부팅/업데이트·Mac x64 설치·Wayland·운영 SQL/웹/worker 배포 gate는 유지한다. 보고서의 9eeccee 로컬 QA exe는 과거 정적 검사본으로 링크·해시를 유지하며 새 CI 설치본이나 정식 웹 다운로드로 표시하지 않는다.

### phase14 설치본 CI — 730ad8d · 당시 기록 보존

[CI 39041064640](https://github.com/csm-kr/haparkchopaeng-workspace/actions/runs/39041064640)는 Web·PostgreSQL·Windows·Linux 성공, Mac 실패다. [Windows job 117420497431](https://github.com/csm-kr/haparkchopaeng-workspace/actions/runs/39041064640/job/117420497431)의 cold OS 루트 슬래시·가시 창/WM_CLOSE·warm same PID/다른 오류·정상 quit IPC·프로필 정리와 자체 제거·handler 없음 복구가 통과했다. raw exact=false를 보존했고 ACL은 현재 토큰의 소유 그룹임을 확인했다. [Ubuntu job 117420497268](https://github.com/csm-kr/haparkchopaeng-workspace/actions/runs/39041064640/job/117420497268)도 실제 설치 8조건을 재통과했다. Mac은 SIGTRAP이며 원인을 확정하지 않았다.

동일 730ad8d에서 웹 946개·별도 PG 13개·Chromium 8개·HTTP wire·pytest 60개·lint/build도 통과했다. 운영 적용이나 전체 CI 성공의 근거로 확대하지 않는다.

Windows unsigned QA artifact는 **111,584,107 bytes**, SHA256 `3e2b6669cb543d242f0f8a20c4724c96e6e048e95fc9bbbe5fbd67dd54297289`다. Authenticode 완료 검증은 없다. Ubuntu .deb SHA256은 `85ede6d95ea984427dcd27a12e1f78af45b44e67a8f1156a702b14b39caff1dd`다. 설치 폴더 삭제는 명령 성공으로 확인했으며 삭제 후 exists 별도 boolean은 없다. 상세는 [연결기 최신 영수증](../../connector/VALIDATION.md)을 따른다. 이전 로컬 파일·아래 초기 Ubuntu 해시와 구분하고 서명본 재빌드 뒤 다시 확인한다.

### 직전 9eeccee / e5e6a612 성공 기록 · 보존

제품 `9eeccee5aa75ed4ef3c14ae9cd95344a49134ef2`의 [CI 39042209763](https://github.com/csm-kr/haparkchopaeng-workspace/actions/runs/39042209763)는 **5개 job 모두 success**로 종료됐다. Mac 설치 [117423809065](https://github.com/csm-kr/haparkchopaeng-workspace/actions/runs/39042209763/job/117423809065)의 실제 9 checks, Windows 설치 [117423809100](https://github.com/csm-kr/haparkchopaeng-workspace/actions/runs/39042209763/job/117423809100)·Ubuntu 설치 8 checks·별도 PG 13개와 schema difference 없음, 웹 946개·Chromium 8개(24.4초)·HTTP wire·lint/build·하네스 guards가 성공했다. 로컬 pure 137/137·실제 builder 구현 회귀 5/5는 이 실제 기동과 별도다. Mac CFBundleName·Helper는 ASCII, 표시 이름·ASAR 런타임과 새로 생성한 프로필 위치는 한글로 유지함을 확인했다. 기존 기기 키 이전과 이전 SIGTRAP의 정확한 원인은 확정하지 않았다.

새 제품 arm64 DMG는 128,089,217 bytes·SHA256 `1e932a93fa2e8bbbab6aa48aba574ff0725572c53af8449fd827c47e993572d9`, Windows CI unsigned NSIS는 111,584,104 bytes·SHA256 `86b2ff18f8f949d94ed23053e1c6c6715f5cece2587eef983cf3d3bea78d1499`, Ubuntu .deb는 SHA256 `42a5b76906854f2a22fd322c5865b98aeb3362c56c4ba633dcd4d9734d8c44dc`다. Mac x64 DMG는 생성만 확인했고 native 설치·기동은 미검증이다. 서명·공증·Gatekeeper는 통과하지 않았다. 상세는 [제품 검증 기록](../../connector/VALIDATION.md)의 새 소스 절을 따른다.

공통 저장소 `e5e6a612`의 [CI 39041845705](https://github.com/csm-kr/local-agent-connector/actions/runs/39041845705)는 Windows·Mac·Ubuntu 3개 job 모두 성공했다. 실제 설치 URI는 Windows preflight 2/full 5, Mac 9, Ubuntu 8 checks이며 정리도 통과했다. 이는 Research Notebook 설정의 결과로 제품 Mac의 배포 gate를 대신하지 않는다. 공통 Windows unsigned QA 설치본은 110,619,701 bytes·SHA256 `de9b6abbdf398b4e37fa47f08e659a599eb75791e5244c6077ec8fb04986c99cd`다. 자세한 실행별 범위는 [공통 검증 기록](https://github.com/csm-kr/local-agent-connector/blob/main/connector/VALIDATION.md)을 따른다. 서명·공증·실브라우저 승인·실사용자 재부팅/업데이트·운영 배포 gate는 유지한다.

### phase14 초기 Ubuntu 실제 설치 CI — 보존 기록

[Ubuntu job 117412530581 / 실행 39038318920](https://github.com/csm-kr/haparkchopaeng-workspace/actions/runs/39038318920/job/117412530581)에서 실제 설치 8조건이 모두 통과했다. 제품 소스 `ec594c2`, 영수증의 CI merge 소스 `7d06c8bf571da8b1020bc99bf8d1c3c94bc2f302`를 구분한다. 패키지는 `hapark-connector-desktop` `0.1.0` `amd64`, 설치한 `.deb` SHA256은 `3a792f591ddf3eb99383859bb12f5b1a54ad437f55ec33ffdfef37917ba6289f`다. 정식 게시 파일이 아닌 해당 CI 산출물의 해시다.

8조건은 (1) 빈 패키지·프로필·설치 경로·handler 사전 확인, (2) 실제 설치와 코어 9개 SHA256·기본 handler·root:root/0755 sandbox·앱별 AppArmor loaded, (3) 설치본의 번들 Node 24.22.0 x64, (4) cold `xdg-open`의 설치 실행 파일·합성 URI 제목 토큰·가시 창과 소유 창의 EWMH 정상 닫기, (5) 직접 CDP browser/renderer native PID와 OS 실행 파일·UID·부모 트리·Seccomp=2·NoNewPrivs=1, (6) warm URI의 같은 main PID·구별되는 오류, (7) 정상 quit IPC와 종료 코드 0, (8) purge·프로필·AppArmor·handler·opener·임시 경로 정리다. 설치기가 sandbox mode를 선택했고 QA가 0755를 수동 변경하지 않았다.

합쳐진 Linux process title의 URI 토큰을 관측했으며 **원래 argv는 미증명**이다. cold renderer 상태와 직접 자식이 아닌 cold main의 종료 코드는 측정하지 않았다. 종료 확인 범위는 관측한 소유 PID와 읽기 가능한 `/proc`다. CLI·추론 0회이며 invalid URI parser가 자격 정보·API ACK·adapter 구성 전에 거절하는 경계로 배제했다. 독립 네트워크 캡처로 API 호출 수를 측정하지 않았다. 인증 페어링·실제 사용자 GUI·Wayland·재부팅·서명·업데이트·정식 배포는 남아 있다. Windows·macOS 상태는 이 Ubuntu 결과로 변경하지 않는다. 상세 8조건과 이전 기록은 [connector/VALIDATION](../../connector/VALIDATION.md)의 phase14 절을 따른다.

초기 검증 당시의 로컬 Windows QA 파일은 `hapark-connector-0.1.0-win-x64.exe`, 111,583,838바이트, SHA256 `9E12B8206ECB8A365C799B978A73B0396E68FC0AA32D184A3DAC82F046D6ABD8`, Authenticode `NotSigned`다. 재빌드하면 해시를 다시 계산한다. 이 파일과 CI의 unsigned artifact는 개발 검토용으로 표시한다. 미서명 파일을 먼저 사용할 경우 운영자가 비공개 개발 파일럿 범위를 명시적으로 선택한다.

## 2. 정식 설치 파일 준비

설치본의 origin은 `https://hapark.vercel.app`, 프로토콜은 `hapark-connect`로 고정한다. 현재 Windows 설정의 `win.signExecutable=false`는 QA 빌드에서 서명을 생략한다. 정식 빌드는 이를 명시적으로 덮어쓰고, 서명 누락 시 실패하도록 한다.

```powershell
$env:CONNECTOR_APP_ORIGIN = 'https://hapark.vercel.app'
npm --prefix connector/desktop ci
npm --prefix connector/desktop run package:win -- -c.win.signExecutable=true -c.forceCodeSigning=true
```

위 명령은 배포 담당이 서명 인증서를 안전하게 주입한 환경에서 실행한다. 설치 EXE와 설치된 앱 EXE의 Authenticode 상태가 `Valid`이고 게시자가 확정한 주체인지 확인한다. SHA256을 기록하고 깨끗한 Windows 사용자에서 설치·전용 링크·제거 회귀를 수행한다.

```powershell
Get-AuthenticodeSignature -LiteralPath 'connector/dist/hapark-connector-0.1.0-win-x64.exe' |
  Select-Object Status, SignerCertificate
Get-FileHash -LiteralPath 'connector/dist/hapark-connector-0.1.0-win-x64.exe' -Algorithm SHA256
npm --prefix connector run qa:install
```

macOS는 해당 OS에서 `package:mac`을 실행하며 [Developer ID 서명](https://developer.apple.com/developer-id/)과 [notarization](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)을 활성화한다. 일반 Apple ID 로그인과 Apple Developer Program 가입·Developer ID 서명 자격은 구분하며 실제 서명 단계에서 사용할 자격과 인증서를 확인한다. 현재 서명 자격 보유 여부를 확정한 것은 아니다. CI의 `CSC_IDENTITY_AUTO_DISCOVERY=false` 설정은 unsigned 검증용이므로 정식 서명 환경을 따로 구성한다. 그 전까지 임시 조치로 `mac.identity: "-"`가 번들 전체를 ad-hoc 서명한다. 0.1.8 preview.3까지의 DMG는 번들 봉인이 없어 strict 검증에 실패했고, 브라우저로 받은 사본은 '손상됨'으로 차단될 수 있었다. 이제 사용자가 시스템 설정 > 개인정보 보호 및 보안의 '그래도 열기'로 실행할 수 있고, 설치 QA는 strict 서명 검증 통과를 요구한다. Developer ID 서명 시 이 값을 인증서로 바꾼다. Mac 번들 파일·실행 파일·Helper 이름은 `AI Bridge`다(electron-builder가 `mac.executableName`으로 번들 파일 이름을 정하므로 실행 파일도 같은 이름을 쓴다). 0.1.8 preview.4까지는 `hapark-connector.app`이었다. 표시 이름 `AI 브릿지`, appId `kr.hapark.connector`, `hapark-connect` 스킴, 프로필 이름은 그대로라 기존 기기 키와 프로필을 이어 쓴다. 새 앱이 `/Applications` 또는 `~/Applications` 바로 아래에서 실행되면, 같은 bundle ID의 `hapark-connector.app`을 LaunchServices에서 등록 해제한 뒤 휴지통으로 옮긴다. 삭제는 하지 않는다. DMG에서 바로 실행하거나 격리 경로로 실행하면 옮기지 않는다. 최종 앱에서 `codesign --verify --deep --strict`, `spctl --assess --type execute`, `xcrun stapler validate`를 확인한다. 2026-10-20부터 Intel Mac(x64) DMG는 빌드·검증·게시하지 않고 Apple Silicon(arm64) DMG만 만든다. 아래 Intel 기록은 당시 검증 결과로 보존한다.

Ubuntu는 CI 네이티브 기동·암호화 검증 뒤 해당 GUI 환경에서 `package:linux`의 .deb를 설치한다. CI의 실제 .deb 읽기 검사는 maintainer scripts·.desktop에 샌드박스 비활성화 인수가 없고 공식 sandbox 설정·URI MIME이 포함됐는지 확인하는 단계다. 실제 설치 성공과 구분한다. 안전한 키링과 한국어 글꼴을 갖춘 데스크톱에서 첫 연결·재개·복구·URI·제거를 검증하고 SHA256을 기록한다. 자동 업데이트는 구현되지 않았으므로 새 설치 파일로 갱신하는 절차도 확인한다. AppImage는 게시하지 않는다.

## 3. 운영 DB 읽기 전용 사전 확인

운영 담당이 선택한 Supabase 프로젝트와 복원 가능한 최근 백업·스냅샷 또는 논리 백업을 확인한다. 백업의 시점·보관 위치·복원 담당·복구 절차를 기록한다. CI의 일회용 DB 검증은 운영의 기존 스키마 상태를 증명하지 않는다.

다음 조회는 운영 담당이 실행한다. 연결 비밀을 출력하지 않고 실제 프로젝트 식별자, DB, `public` 스키마가 의도한 대상인지 확인한다.

```sql
SELECT current_database(), current_user, current_schema();
SHOW search_path;
SELECT name, to_regclass(format('%I.%I', 'public', name))::text AS relation
FROM (VALUES
  ('Team'), ('AppSetting'),
  ('LocalAgentDevice'), ('LocalAgentAttempt'), ('LocalAgentGrant'),
  ('LocalAgentSnapshot'), ('LocalAgentJob')
) AS expected(name);
```

기존 main이 사용하는 `Team`·`AppSetting` 등 기반 스키마가 맞아야 한다. 첫 적용은 새 5개 테이블이 모두 없는 상태에서 진행한다. 일부만 있으면 중단하고 차이를 검토한다. 이미 5개가 있으면 CREATE SQL을 다시 실행하지 않고 스키마 차이부터 확인한다.

승인된 배포 checkout과 운영 담당이 관리하는 환경에서 아래 명령으로 예정 차이를 읽는다. `DATABASE_URL`·`DIRECT_URL`을 임시 테스트 URL과 혼용하지 않는다. 이 명령은 SQL을 출력하며 DB를 변경하지 않는다.

```text
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script
```

연결기 SQL은 LocalAgent 5개 테이블·인덱스 11개·FK 10개를 추가한다. 후속 연구 채팅 SQL은 Paper 4컬럼·LocalAgentJob 3컬럼·ResearchConversation 1테이블·인덱스 2개·FK 2개를 추가한다. 최종 차이는 이 두 검토 SQL과 일치해야 한다. 범위 밖의 기존 테이블 변경·삭제가 나오면 운영 반영을 멈춘다. 백필과 seed는 필요 없다.

## 4. 검토한 SQL 수동 반영

운영 담당이 [연결기 SQL](sql/20261017-local-agent-connection.sql)과 [연구 채팅 SQL](sql/20261017-local-ai-research-chat.sql) 전체를 순서대로 검토한 뒤 선택한 DB 도구에서 한 트랜잭션으로 실행한다. 트랜잭션 안에서 `SET LOCAL search_path TO public;`을 먼저 실행해 새 테이블과 FK가 `public`에 생성되게 한다. `BEGIN;`·스키마 지정·두 검토 SQL 전체·`COMMIT;` 순서이며, 실행할 전체 본문을 확인한 뒤 반영한다.

Supabase 환경에서는 `COMMIT;` 전에 [신규 테이블 접근 제한](sql/20261018-local-agent-table-access.sql)도 적용한다. 새 6테이블의 Data API 역할 권한과 RLS만 다루며 기존 테이블·default privileges는 변경하지 않는다. RLS만으로 TRUNCATE 권한을 막을 수 없으므로 권한 회수도 함께 확인한다. 반영 후 구조 diff와 별개로 `postgres` 소유·RLS on/FORCE off·정책 0개·`anon/authenticated/service_role`의 모든 테이블 권한 거부를 검증한다.

전체 `prisma db push`, reset, seed 또는 기존 테이블 DROP으로 대체하지 않는다. 오류나 연결 단절로 완료 여부가 불분명하면 다시 CREATE하지 않고 사전 조회와 스키마 차이 검사를 반복한다.

연결기 SQL 다음 연구 채팅 SQL까지 검토·반영한 후 `public`의 새 6개 테이블·총 7개 추가 컬럼·제약을 확인한다. 다음 읽기 전용 검증의 종료 코드는 0이어야 한다. 종료 코드 2는 차이가 남아 있다는 뜻이므로 웹 승격을 중단한다.

```text
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code
```

이 단계가 끝나기 전에 새 웹 코드를 Production으로 승격하지 않는다. 새 회수 경로는 로그아웃·팀 전환에도 새 테이블을 사용한다.

## 5. 실제 파일 게시와 환경 설정

다운로드 게시 위치가 확정되지 않았거나 파일 검증이 끝나지 않았다면 서버 `LOCAL_AGENT_RELEASES=[]`를 유지한다. 임시·가짜 URL을 등록하지 않는다. 배포 담당은 실제 HTTPS 다운로드 URL을 열어 성공 응답, 파일 이름·크기·SHA256·서명, 웹에서 다운로드한 파일의 설치 동작을 확인한다. 개인 GitHub 로그인 등 별도 인증이 필요한 링크라면 대상 사용자도 실제로 내려받을 수 있는지 확인한다.

검증 후 서버 환경에 `platform`, 실제 `url`, `version`, 선택 `filename`·`architecture`를 담는 JSON 배열을 등록한다. 현재 DTO는 SHA256 필드를 받지 않으므로 해시는 별도 검토 기록에 보관한다. 검증되지 않은 OS·아키텍처 항목은 넣지 않는다.

기존 `AUTH_SECRET`는 유지한다. 서버에 CLI OAuth 토큰이나 별도 Codex/Claude API 키를 추가하지 않는다. `CONNECTOR_APP_ORIGIN=https://hapark.vercel.app`은 설치본 빌드용 설정이며 웹 서버의 실행 허가를 대신하지 않는다. 배포 환경의 변경은 새 웹 배포에 적용됐는지 확인한다.

## 6. 웹 승격과 파일럿

DB 반영·파일 게시·환경 설정·최종 CI를 확인한 후 승인된 정확한 커밋을 Production으로 승격한다. 먼저 한 명의 Windows 사용자로 아래 흐름을 확인하고 검증된 OS로 범위를 넓힌다.

- 첫 설치 → 웹 복귀 → 빈 6자리 입력 → 연결 완료. 모델은 처음에 무선택이다.
- 실제 모델 목록과 한도 미제공·오래된 값·0%를 구분하고, 팀 논문 질문의 응답을 확인한다.
- 앱 완전 종료 후 웹 버튼 재실행은 같은 로그인·팀·기기 키를 재사용한다.
- 로그아웃·팀 전환·멤버 제거·연결 해제는 작업을 회수한다. 쿠키 유실·네트워크 단절 후 마지막 허가에서 최장 2분에 실행이 끝나고 허가 만료 후 전송한 결과는 거절된다. 유효 허가 중 서버가 이미 접수한 completed 결과는 현재 팀 멤버십을 다시 확인해 후처리·저장할 수 있다.
- 최종 설치본의 암호화 보관·재개·업데이트·제거를 확인한다. 암호문 손상 검증은 실제 사용자 키 대신 전용 프로필에서 수행한다.

실제 질문은 사용자 구독 한도를 사용한다. 기존 Codex 작은 추론은 성공했고 Claude는 구독 한도 오류 처리를 확인했다. Claude의 정상 응답 성공은 한도 해소 후 확인할 항목으로 남긴다. 단계별 결과와 장애 시각을 기록하고 CLI 인증·기기 키·질문 원문을 진단 로그에 복사하지 않는다.

## 7. 장애 시 롤백

운영 담당이 현재 웹에서 연결 해제·로그아웃으로 해당 기기 허가를 회수한다. 새 다운로드 중단은 `LOCAL_AGENT_RELEASES=[]`로 처리한다. 배포 목록 변경은 신규 다운로드를 제어하며, 실행 허가 회수는 연결 해제 경로가 담당한다.

Vercel에서 이전의 검증된 웹 배포로 돌아간다. 기존 DB 연결과 `AUTH_SECRET`를 보존한다. 웹 허가 갱신이 끊긴 연결기는 마지막 허가부터 최장 2분에 실행을 중단하므로 프로세스 정지까지 확인한다.

추가한 6개 테이블·컬럼과 기록은 유지한다. 롤백을 위해 DROP·reset·seed·행 일괄 삭제를 실행하지 않는다. 원인을 확인하고 새 변경을 같은 검토·CI·수동 반영 순서로 준비한다. 운영 DB 복원은 별도의 복구 판단에 따라 운영 담당이 수행한다.
