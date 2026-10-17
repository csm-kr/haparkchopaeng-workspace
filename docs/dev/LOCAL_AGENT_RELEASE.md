# 로컬 AI 연결 운영 배포 런북

2026-10-17 기준으로 기능 코드 `7671c00`의 웹 CI와 전용 PostgreSQL 16 동시성 8개, 추가 SQL 적용 뒤 스키마 차이 0을 확인했다. 운영 DB 반영·Production 승격·정식 설치 파일 게시 기록은 아직 없다. 실제 배포에는 최종 커밋, 해당 CI, 서명한 설치 파일의 SHA256을 한 묶음으로 기록한다.

동작 계약은 [LOCAL_AGENT](LOCAL_AGENT.md), 플랫폼별 검증 근거는 [connector/VALIDATION](../../connector/VALIDATION.md), 적용 SQL은 [20261017-local-agent-connection.sql](sql/20261017-local-agent-connection.sql)을 따른다.

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
| Windows x64 | 실제 OS 암호화·정상 재개·암호문 손상 후 새 번호 복구, NSIS 설치·프로토콜 등록·제거 | 게시자 서명, 최종 서명본으로 다운로드부터 재설치/업데이트까지 확인 |
| macOS arm64 | CI의 실제 네이티브 암호화·재개·손상 복구, arm64 DMG 생성 | Developer ID 서명·공증, 최종 설치본과 실제 브라우저의 전용 링크·권한 창·업데이트/제거 |
| macOS x64 | x64 DMG 생성 | x64 네이티브 실행·암호화·재개 및 최종 설치 흐름 |
| Ubuntu GUI x64 | Ubuntu 24.04 CI에서 실제 Electron·Secret Service 암호화·정상 재개·손상 복구 13조건 통과, .deb 생성 | 한글 글꼴을 준비한 가독성, .deb 실제 설치·전용 링크·재실행·업데이트·제거·Wayland |

위 네이티브 CI 근거는 [실행 39028900156](https://github.com/csm-kr/haparkchopaeng-workspace/actions/runs/39028900156)이다. 실제 Electron·OS 암호화 저장소를 사용했으며 서버 API만 loopback fixture다. 실제 모델 추론·운영 웹·브라우저 URI 실행은 하지 않았다. macOS의 네이티브 실행은 arm64이며 x64는 DMG 생성과 구분한다.

Ubuntu는 GUI와 안전한 키링, 한국어 표시가 가능한 글꼴이 필요하다. `basic_text` 저장소는 차단한다. 해당 CI는 공식 sandbox의 root:root/4755 준비를 검증했지만, CJK 글꼴이 없어 캡처 한글은 네모로 표시돼 가독성 재확인이 남았다. X11/Wayland의 펫 위치·항상 위 제약, headless 미지원도 안내한다. 각 OS의 완료 근거가 확보된 아키텍처만 다운로드 목록에 등록한다.

Ubuntu 배포 후보는 .deb만이다. builder의 기본 AppImage launcher에서 샌드박스 비활성화 경로를 확인해 AppImage를 빌드·배포 대상에서 제외했다. 이전 CI가 만든 AppImage는 Git에서 제외한 개발 산출물로 보류하고 `LOCAL_AGENT_RELEASES`에 등록하지 않는다. 안전한 AppImage 대안 개발은 이번 배포 범위 밖이다.

현재 로컬 Windows QA 파일은 `hapark-connector-0.1.0-win-x64.exe`, 111,583,838바이트, SHA256 `9E12B8206ECB8A365C799B978A73B0396E68FC0AA32D184A3DAC82F046D6ABD8`, Authenticode `NotSigned`다. 재빌드하면 해시를 다시 계산한다. 이 파일과 CI의 unsigned artifact는 개발 검토용으로 표시한다. 미서명 파일을 먼저 사용할 경우 운영자가 비공개 개발 파일럿 범위를 명시적으로 선택한다.

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

macOS는 해당 OS에서 `package:mac`을 실행하며 [Developer ID 서명](https://developer.apple.com/developer-id/)과 [notarization](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)을 활성화한다. 일반 Apple ID 로그인과 Apple Developer Program 가입·Developer ID 서명 자격은 구분하며 실제 서명 단계에서 사용할 자격과 인증서를 확인한다. 현재 서명 자격 보유 여부를 확정한 것은 아니다. CI의 `CSC_IDENTITY_AUTO_DISCOVERY=false` 설정은 unsigned 검증용이므로 정식 서명 환경을 따로 구성한다. 최종 앱에서 `codesign --verify --deep --strict`, `spctl --assess --type execute`, `xcrun stapler validate`를 확인한다. 두 아키텍처 DMG 생성과 각 아키텍처의 실제 실행 결과를 구분한다.

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

첫 적용의 차이는 검토한 LocalAgent 5개 테이블·추가 인덱스 11개·FK 10개뿐이어야 한다. 기존 테이블 변경·삭제나 이번 기능과 무관한 차이가 나오면 운영 반영을 멈춘다. 백필과 seed는 필요 없다.

## 4. 검토한 SQL 수동 반영

운영 담당이 [추가 전용 SQL](sql/20261017-local-agent-connection.sql) 전체를 검토한 뒤 선택한 DB 도구에서 한 트랜잭션으로 실행한다. 트랜잭션 안에서 `SET LOCAL search_path TO public;`을 먼저 실행해 새 테이블과 FK가 `public`에 생성되게 한다. `BEGIN;`·스키마 지정·검토한 SQL 전체·`COMMIT;` 순서이며, 실행할 전체 본문을 확인한 뒤 반영한다.

전체 `prisma db push`, reset, seed 또는 기존 테이블 DROP으로 대체하지 않는다. 오류나 연결 단절로 완료 여부가 불분명하면 다시 CREATE하지 않고 사전 조회와 스키마 차이 검사를 반복한다.

반영 후 `public`의 5개 테이블과 제약을 확인하고 다음 읽기 전용 검증이 종료 코드 0인지 확인한다. 종료 코드 2는 차이가 남아 있다는 뜻이므로 웹 승격을 중단한다.

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
- 로그아웃·팀 전환·멤버 제거·연결 해제는 작업을 회수한다. 쿠키 유실·네트워크 단절 후 마지막 허가에서 최장 45초에 실행이 끝나고 늦은 결과가 반영되지 않는다.
- 최종 설치본의 암호화 보관·재개·업데이트·제거를 확인한다. 암호문 손상 검증은 실제 사용자 키 대신 전용 프로필에서 수행한다.

실제 질문은 사용자 구독 한도를 사용한다. 기존 Codex 작은 추론은 성공했고 Claude는 구독 한도 오류 처리를 확인했다. Claude의 정상 응답 성공은 한도 해소 후 확인할 항목으로 남긴다. 단계별 결과와 장애 시각을 기록하고 CLI 인증·기기 키·질문 원문을 진단 로그에 복사하지 않는다.

## 7. 장애 시 롤백

운영 담당이 현재 웹에서 연결 해제·로그아웃으로 해당 기기 허가를 회수한다. 새 다운로드 중단은 `LOCAL_AGENT_RELEASES=[]`로 처리한다. 배포 목록 변경은 신규 다운로드를 제어하며, 실행 허가 회수는 연결 해제 경로가 담당한다.

Vercel에서 이전의 검증된 웹 배포로 돌아간다. 기존 DB 연결과 `AUTH_SECRET`를 보존한다. 웹 허가 갱신이 끊긴 연결기는 마지막 허가부터 최장 45초에 실행을 중단하므로 프로세스 정지까지 확인한다.

추가한 5개 테이블과 기록은 유지한다. 롤백을 위해 DROP·reset·seed·행 일괄 삭제를 실행하지 않는다. 원인을 확인하고 새 변경을 같은 검토·CI·수동 반영 순서로 준비한다. 운영 DB 복원은 별도의 복구 판단에 따라 운영 담당이 수행한다.
