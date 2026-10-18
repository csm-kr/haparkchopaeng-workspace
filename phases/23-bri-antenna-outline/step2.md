# 네이티브 펫·연결앱 회귀와 OS 근거

입력은 [step1.md](step1.md)의 renderer·QA·메타데이터, [VALIDATION.md](VALIDATION.md)의 Windows RED/GREEN 영수증이다.

AC는 해당 작업트리의 Electron 의존성을 준비한 환경에서 순차 실행한다.

```sh
node connector/scripts/pet-qa.mjs
node --test connector/test/*.test.mjs
```

로컬 의존성 재사용은 QA 전용 `--dependencies-root=<desktop 디렉터리>`로 명시할 수 있다. 외부 경로의 Electron 의존성은 읽기만 하며 그곳에서 설치하거나 설정을 바꾸지 않는다. 옵션이 없으면 기존 `connector/desktop/node_modules/electron` 경로를 유지한다. 캡처·프로필은 소유 임시 경로만 사용한다.

흰색·그라파이트 배경의 실제 안테나 위·좌·우 외곽선 픽셀, 불투명 얼굴·플러그, 6초 깜빡임·14초 미소의 실제 경과, 호버·동작 줄이기, 드래그 영역·포커스 및 소유 프로세스·프로필 정리를 확인한다. 눈·입 중앙 28×26px 이외의 드래그 영역과 sandbox·CSP를 유지한다. 실제 마우스 드래그는 수행하지 않았으면 그대로 미검증으로 남긴다.

부모가 정확한 최종 소스의 Windows·Mac arm64·Mac Intel·Ubuntu CI를 수집한 뒤 OS 표를 갱신한다. Windows 로컬 renderer 근거로 다른 OS나 설치 파일을 통과 처리하지 마라. 이유: 캡처·실행 환경과 패키징은 서로 다른 경계다. 계정·CLI 추론·운영 API를 호출하지 마라. 이유: 외곽선 검증에는 필요 없다.

커밋·push·태그·패키징·게시·기존 사용자 앱 교체는 부모 소유다. 정확 소스 CI, 공개 파일 SHA와 실제 설치 확인이 없으면 `targetReleasePublished`·`installedUpgradeVerified`를 true로 바꾸지 않는다. 하네스 통과와 배포 완료는 별도로 기록한다.
