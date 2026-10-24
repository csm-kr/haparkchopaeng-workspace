# AI Bridge 0.1.11 배포 기록

2026-10-24 사용자 승인으로 기존 unsigned prerelease 채널에 게시했다.

- [릴리스](https://github.com/csm-kr/haparkchopaeng-workspace/releases/tag/ai-bridge-v0.1.11-preview.1), 태그 `ai-bridge-v0.1.11-preview.1`.
- 제품 소스: `c65c73c846fbeadb6aa8899e494bb242a11b7fca`.
- [동일 태그 검증 40066225682](https://github.com/csm-kr/haparkchopaeng-workspace/actions/runs/40066225682): web·PostgreSQL·Windows·Mac arm64·Ubuntu의 5개 job 모두 성공. 최초 Mac 실행은 설치 후 임시 앱 폴더 정리에서 실패했으며, 소스 변경 없이 실패 job 재실행으로 전체 성공했다.
- [설치 파일 게시 40067055378](https://github.com/csm-kr/haparkchopaeng-workspace/actions/runs/40067055378): preflight와 Mac·Ubuntu native job 3개 모두 성공. 각 OS의 암호화·설치·정리 영수증을 확인한 파일만 draft에 업로드했다. Windows는 위 동일 소스 CI의 설치 파일·설치 및 URI 영수증을 별도로 검증했다.
- 각 JSON 메타데이터와 GitHub 서버의 asset SHA256·크기·소스·버전이 일치한다. 공개 후 세 파일 모두 인증 없는 HTTP HEAD 200과 정확한 Content-Length를 확인했다.

| 설치 파일 | bytes | SHA256 |
| --- | ---: | --- |
| [AI-Bridge-0.1.11-linux-x64.deb](https://github.com/csm-kr/haparkchopaeng-workspace/releases/download/ai-bridge-v0.1.11-preview.1/AI-Bridge-0.1.11-linux-x64.deb) | 99518760 | `cb8277ecfed5ade8e87ff2117afe693131a06bfd2a6de1aa5d7bf1b089802772` |
| [AI-Bridge-0.1.11-mac-arm64.dmg](https://github.com/csm-kr/haparkchopaeng-workspace/releases/download/ai-bridge-v0.1.11-preview.1/AI-Bridge-0.1.11-mac-arm64.dmg) | 128512624 | `eaea5caf3527941e8804627a99bcc59a6b38ad644440c56dc3a0cb1892d28bb5` |
| [AI-Bridge-0.1.11-win-x64.exe](https://github.com/csm-kr/haparkchopaeng-workspace/releases/download/ai-bridge-v0.1.11-preview.1/AI-Bridge-0.1.11-win-x64.exe) | 111716184 | `de475df4388bc3f133f015647fa3d92924753462183632a1d22a9eeb539d3857` |

## 운영 웹

프로젝트 `csm-krs-projects/hapark`의 Production `LOCAL_AGENT_RELEASES`만 [published-releases.json](published-releases.json)으로 갱신했다. 기존 공개 0.1.10 목록은 로컬 배포 산출물에 보관했다.

새 배포 `dpl_AjR3pRQwnohfSUxEZFsMFtxhPzwy` / [검증한 배포](https://hapark-cdud8hcfz-csm-krs-projects.vercel.app)는 Ready이며 `https://hapark.vercel.app`에 연결됐다. 사용자가 로그인한 브라우저에서 운영 `/api/local-agent/downloads`를 실제로 다시 읽어 HTTP 200, 세 OS 모두 0.1.11과 정확한 공개 URL을 확인했다. 개인 세션·쿠키는 기록하지 않았다.

## 사용과 범위

기존 앱을 종료하고 해당 OS의 새 설치본으로 업데이트한 뒤 **작은 펫 표시**를 켠다. 자동 업데이트는 제공하지 않는다. 기존 앱 ID·프로토콜·프로필 이름은 유지한다. 이번 작업은 공개 설치 파일·다운로드 설정 배포이며, 이 컴퓨터의 기존 설치 앱이나 사용자 프로필을 교체하지 않았다.

기존과 같은 미서명 테스트 릴리스다. Mac 번들은 ad hoc strict 서명 검증을 통과했지만 Developer ID·공증·Gatekeeper 승인은 포함하지 않는다. CI의 모의 API·신규 격리 프로필과 invalid URI 검증은 실제 계정 페어링·추론·기존 사용자 업그레이드를 검증하지 않는다.
