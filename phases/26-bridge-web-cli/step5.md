# Step 5: release-0-1-13

## 읽어야 할 파일

- `docs/dev/LOCAL_AGENT_RELEASE.md` — 게시 런북
- `.github/workflows/ai-bridge-preview.yml`, `.github/workflows/local-agent.yml`
- `phases/25-bri-stateful-companion/RELEASE.md` — 직전 게시 절차와 영수증 형식
- step 0~4 결과

## 작업

사용자가 0.1.13 게시를 승인한 상태에서만 진행한다. 순서를 바꾸지 않는다.

1. 웹 PR을 올리고 CI(`local-agent.yml`) 전체 성공을 확인한 뒤 병합한다. Vercel Production 배포가 병합 커밋으로 Ready인지 확인한다. **웹이 앱보다 먼저다.**
2. 병합 커밋에 태그 `ai-bridge-v0.1.13-preview.1`을 만들고 draft prerelease를 만든다. 같은 SHA의 CI 성공 뒤 `ai-bridge-preview.yml`로 Mac arm64·Ubuntu x64를 게시하고, Windows x64는 직전 게시와 같은 방식으로 정확한 소스에서 만든 파일을 올린다.
3. 각 파일의 크기·SHA256을 공개 URL로 다시 받아 확인한 뒤 prerelease로 공개한다.
4. Production `LOCAL_AGENT_RELEASES`를 0.1.13 URL로 바꾸고 재배포한 뒤, 로그인한 운영 다운로드 API에서 세 OS 모두 0.1.13인지 읽어 확인한다.
5. `docs/dev/LOCAL_AGENT_RELEASE.md`에 0.1.12와 0.1.13 게시 기록(소스 SHA·CI run·파일 해시·확인 범위)을 남긴다.

## Acceptance Criteria

```bash
gh release view ai-bridge-v0.1.13-preview.1 --json isPrerelease,isDraft,assets
curl -fsSL -o /dev/null -w "%{http_code}\n" <각 자산 URL>   # 200
```

## 검증 절차

AC 실행 → 운영 다운로드 API 확인 → index.json step 5 갱신.

## 금지사항

- 앱을 웹보다 먼저 게시하지 마라. 이유: 구 서버가 새 heartbeat 필드를 거절해 연결이 끊긴다.
- 기존 동명 자산을 덮어쓰지 마라. 이유: 이미 받은 사용자의 해시 검증이 깨진다.
- 서명·공증이나 실사용자 검증을 했다고 기록하지 마라. 이유: 이번 게시는 미서명 테스트 채널이다.
