# 브리 안테나 외곽선과 0.1.7 메타데이터

입력은 기준 소스 `6e44b22ee297c2da7ca8e49a3bc14eb9489b838c`, [펫 설계](../../docs/design/AI_BRIDGE_TRAY_CHARACTER.md), `connector/desktop/renderer/pet.html`, `pet.css`, `connector/scripts/pet-qa.mjs`다. 변경·직접 검증 근거는 [VALIDATION.md](VALIDATION.md)에 둔다.

안테나 선·몸체와 달리 끝 점에는 그라파이트 외곽선이 없었다. 실제 흰색·어두운 배경 렌더의 점 위·좌·우에 외곽선 픽셀이 없는 RED를 확인하고, 기존 outline 그룹에 원 하나만 추가한다. 라임 점의 크기는 유지하고 바깥으로 보이는 그라파이트 폭을 몸체와 맞춘다. `pet.css`와 눈·입·중앙 28×26px 표정 영역은 바꾸지 않는다.

앱 버전은 `connector/desktop/package.json` 및 `package-lock.json`의 최상위·루트 패키지 버전만 `0.1.7`로 바꾼다. 의존성·앱 ID·프로토콜·기존 프로필 이름은 유지한다. 기존 packaging identity 테스트의 버전 기대값은 먼저 `0.1.7`로 바꿔 RED를 확인하고 메타데이터 변경으로 통과시킨다.

AC:

```sh
node --check connector/scripts/pet-qa.mjs
node --test connector/test/pet-renderer.test.mjs connector/test/desktop-packaging-identity.test.mjs connector/test/desktop-version-display.test.mjs
```

기본 Node 실행에서 native opt-in 테스트의 skip을 실제 렌더 통과로 세지 마라. 이유: 위 명령은 네이티브 Electron을 실행하지 않는다. 버전 변경으로 새 패키지 설치·게시가 끝났다고 기록하지 마라. 이유: 이 단계는 소스와 메타데이터 준비다.

산출물은 renderer 한 줄 수정, 실제 픽셀 회귀, 버전 세 곳 및 기대값 한 곳, 범위가 분리된 검증 기록이다. 현재 기록은 수동 실행 근거이며 하네스 step 상태는 부모의 실제 AC 실행 전까지 pending이다.
