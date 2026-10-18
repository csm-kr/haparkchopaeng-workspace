# Debian 설치 파일의 실제 이름으로 게시

첫 native 게시 실행의 Ubuntu 단계는 설치와 정리를 통과한 뒤 업로드에서 `ENOENT`로 실패했다. Electron Builder가 Debian 설치 파일 이름의 `${arch}`를 `amd64`로 생성하는데, 게시 코드의 입력 경로는 Node의 `x64`를 사용했다.

- Linux 입력 경로만 `hapark-connector-<version>-linux-amd64.deb`로 해석한다.
- 공개 파일명 `AI-Bridge-<version>-linux-x64.deb`, 런타임 및 manifest의 `x64`는 유지한다.
- 실제 생성 규칙의 `amd64` fixture에서 실패를 먼저 재현하고, 설치 영수증 해시와 같은 파일만 업로드하는 검증을 보존한다.
- 앱 실행 코드, OS 보안 경계, 배포 권한과 운영 DB는 변경하지 않는다.
- 기존 태그와 파일은 덮어쓰지 않는다. 새 정확한 소스 태그의 전체 검증을 통과한 뒤 새 초안에 게시한다.

## Acceptance Criteria

```text
node --test connector/test/preview-release.test.mjs
```

`python scripts/execute.py 15-ai-bridge-preview --verify --step 1`로 회귀 검증을 기록한다. 설치 파일 공개·익명 다운로드 해시 대조·운영 manifest와 Aside 확인은 별도 실제 배포 영수증으로 검증한다.
