# 브리 안테나 외곽선 · 0.1.7 준비 검증

부모 하네스 재검증: 이 작업트리의 자체 Electron 의존성으로 step 1·2를 실행해 통과했다. 네이티브 펫은 안테나 위·좌·우 픽셀을 포함해 10개 통과, 전체 connector 테스트는 211개 통과·명시 opt-in 1개 생략이다. 포커스 요청·관측과 네트워크·CLI 요청은 0이며 소유 앱과 임시 프로필은 정상 정리됐다. 정확 소스 다중 OS CI·게시·기존 사용자 설치 검증은 별도 릴리스 영수증으로 기록한다.

기준 소스는 `6e44b22ee297c2da7ca8e49a3bc14eb9489b838c`다. 현재는 그 위의 미커밋 수정이며, 0.1.7 공개·설치 완료 기록이 아니다. 제품 renderer는 [pet.html](../../connector/desktop/renderer/pet.html)의 기존 하부 outline에 원 한 줄만 추가했다. `pet.css`는 변경하지 않았다.

## 실제 RED → GREEN

- 기존 Windows Electron 렌더에서 기존 9개 검증은 통과하고, 안테나 끝의 그라파이트 외곽선 픽셀 검사만 실패했다. 영수증: `%TEMP%/hapark-ai-pet-20261018/outline-red/result.json`.
- 원의 외곽선은 기존 몸체처럼 바깥으로 0.7 SVG px가 보이게 한다. 라임 점의 반지름과 캐릭터 크기를 바꾸지 않는다.
- 얇은 곡선의 안티앨리어싱을 반영한 최종 판정으로 기존 RED PNG도 다시 읽었다. 기존 흰색·다크 캡처의 위·좌·우 픽셀은 각각 `0/0/0`이다. 수정 후에는 흰색 `10/7/7`, 다크 `2/2/2`로 외곽선을 관측했다. CSS 문자열 존재 검사를 성공 근거로 사용하지 않았다.
- 최종 실제 Windows Electron은 **10/10 PASS**다. 영수증: `%TEMP%/hapark-ai-pet-20261018/outline-final/result.json`. 같은 폴더의 `light-neutral.png`, `dark-neutral.png`를 직접 확인했다.

재현 명령은 repo 루트에서 다음과 같다. 아래 재사용 의존성은 이전 작업트리의 Electron 44.9.0을 읽기만 사용하며, 그 작업트리는 수정하지 않았다.

```powershell
node connector/scripts/pet-qa.mjs --dependencies-root=C:/Users/csm81/Desktop/04_스킬개발/projects/hapark-ai-bridge-pet/connector/desktop --evidence-dir=C:/Users/csm81/AppData/Local/Temp/hapark-ai-pet-20261018/outline-final
```

이 명령은 QA 전용 작은 창을 `showInactive`로 표시한다. 기본 의존성 경로는 그대로이며, `--dependencies-root`는 제품의 실행 옵션·IPC·권한을 추가하지 않는다.

## 관측 범위

| 경계 | 현재 직접 확인한 결과 |
| --- | --- |
| Windows x64 Electron renderer | 안테나 대비 포함 10개 PASS. 실제 깜빡임 주기 5999ms, 미소 주기 13999.1ms. 네이티브 얼굴 호버·커서 복원 PASS |
| Mac arm64·Intel / Ubuntu x64 | 이번 변경의 실제 native QA·정확 소스 CI는 아직 미실행. 부모가 새 CI 영수증으로 갱신해야 함 |
| 드래그·접근성 | 중앙 28×26px no-drag와 나머지 드래그 CSS 보존, 동작 줄이기·정적 호버 PASS. 물리적 OS 드래그는 미실행 |
| 보안·수명 | sandbox·contextIsolation·Node 차단·기존 CSP 유지. 포커스 요청·관측 0, 네트워크·CLI 요청 0, 기존 계정 프로필 읽기 0 |
| 정리 | 소유 Electron 정상 종료·QA 프로필 삭제 true, 강제 종료 false. 기존 앱·프로필·OS 프로토콜을 다루지 않음 |
| 패키징·게시·설치 | 이번 0.1.7 후보로는 아직 미실행. 버전 준비와 renderer QA는 서명·공증·게시·기존 사용자 업그레이드 증거가 아님 |

## 버전·최소 회귀

기존 packaging identity 기대값을 먼저 `0.1.7`로 바꿔 실제 `0.1.6 !== 0.1.7` RED를 확인했다. 이후 desktop package와 lockfile 최상위·루트 metadata의 버전 세 곳만 바꿨다. 의존성 버전·무결성 값은 변경하지 않았다.

`node --test connector/test/pet-renderer.test.mjs connector/test/desktop-packaging-identity.test.mjs connector/test/desktop-version-display.test.mjs`: **5 PASS / 1 native opt-in SKIP**. 이 skip은 위의 별도 Electron 10개와 합산하거나 실제 네이티브 재실행으로 표시하지 않는다. 버전 변경 후 native QA는 재실행하지 않았으며 검증된 renderer·QA 파일은 동일하다.

| 직접 검증한 파일 | SHA256 |
| --- | --- |
| `connector/desktop/renderer/pet.html` | `cd676f142694194dc6a3b4d21a936a040efb60dca74100dd1cf22aea55a87a66` |
| `connector/scripts/pet-qa.mjs` | `ee2c5f48d40bd0f3cff46e962a05f79759777cc6297918cf30a230c0f1534952` |

`node --check connector/scripts/pet-qa.mjs`와 `git diff --check`도 통과했다. 하네스는 아직 이 phase에서 실행하지 않았고 두 step은 pending이다. 최종 소스 CI·패키지 SHA·릴리스·운영 또는 기존 설치 앱의 확인은 부모가 별도로 기록한다.
