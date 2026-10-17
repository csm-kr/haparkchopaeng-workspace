# Step 5: release-verification

기능 통합 후 Windows 설치 패키지와 등록 프로토콜·종료 후 재실행·안전한 인증 저장을 실제 확인한다. macOS/Ubuntu는 각 OS의 빌드·실행 근거를 확보하고 Ubuntu GUI/Wayland 제약을 문서화한다. 서명·공증 및 배포 schema 반영은 검토 가능한 파일/명령/결과를 만든다.

AC:

```text
node connector/scripts/ci-desktop-smoke.mjs --self-test
gh run watch 39029600751 --repo csm-kr/haparkchopaeng-workspace --exit-status
```

위 CI의 소스는 `d54a1fd3334bb14158eb662eb7ef5c81d4bbe6d0`다. 세 OS 네이티브 검증은 실제 OS 암호화와 mock REST를 사용하며 CLI 추론은 0회다. Ubuntu는 `.deb`만 제공하고 실제 산출물의 launcher·maintainer script·sandbox·URI를 읽기 검사한다. 한국어 화면은 Noto CJK 글꼴을 준비한 CI에서 확인했다.

이 단계의 완료는 개발 배포 후보의 검증과 수동 배포 자료 준비를 뜻한다. 서명·공증·운영 DB 적용·실제 Production 설치의 완료와 구분한다. 운영 작업은 [배포 런북](../../docs/dev/LOCAL_AGENT_RELEASE.md)에 따라 별도로 진행한다.
