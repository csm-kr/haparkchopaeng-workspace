# 브리 안테나 외곽선 · 0.1.7 준비 검증

## 최신: preview.2 CI의 0.25px 판정 보정

소스 `005bb0be`, exact-tag CI `39114075357`의 Windows `117636144417`·Mac Intel `117636144291`·Ubuntu `117636144262` 기록을 보존했다. 세 환경 모두 기본 위치의 실제 외곽선은 `8/4/5`, outline-hidden 대조는 `0/0/0`이었다. 인공적인 0.25px 이동에서는 실제 외곽선의 개별 픽셀 게이트가 `4/3/0`이 되어 실패했고, 외곽선을 숨긴 영상에도 `0/1/0`이 남았다. 색상과 도형 geometry가 같아도 얇은 곡선의 안티앨리어싱 분산에 개별 픽셀 판정이 민감했음을 보여준다. CI 원본 PNG는 없으므로 당시 화면을 재구성했다고 주장하지 않는다. 원문·추출한 RED 영수증은 `%TEMP%/hapark-bri-outline-release-20261018/job-*.log`와 `quarter-pixel-ci-red.json`이다.

제품 HTML·CSS·버전은 바꾸지 않고 QA만 고쳤다. 흰색·다크 쌍에서 복원한 graphite의 **알파를 곱한 픽셀별 면적**을 위·좌·우에서 합산하고, 같은 위치에서 outline만 숨긴 실제 렌더의 면적을 뺀다. 라임·기존 halo 성분과 색상 잔차 16 모델은 유지한다. 기존 픽셀 게이트의 0.6×0.75, 즉 **0.45 픽셀 상당의 실제 graphite 추가 면적**을 각 방향에서 요구한다. 단일 픽셀의 색상/알파 문턱을 낮추지 않으며, 그 개별 판정 값은 `rimPixels` 진단으로 계속 남긴다. 양성·대조의 geometry도 직접 비교한다.

| 최종 실제 Windows 렌더 | 위·좌·우 추가 graphite 면적 | 판정 |
| --- | --- | --- |
| 기본 위치, 외곽선 있음 − 숨김 | `9.4560 / 7.0412 / 7.0405` | PASS |
| 0.25px 이동, 외곽선 있음 − 숨김 | `10.7952 / 7.3541 / 6.7943` | PASS |
| 기본 위치, 독립적으로 다시 캡처한 outline-hidden − 숨김 | `0 / 0 / 0` | FAIL 유지 |
| 0.25px 이동, 독립적으로 다시 캡처한 outline-hidden − 숨김 | `0 / 0 / 0` | FAIL 유지 |
| 최초 실제 RED 원본 PNG − 같은 위치의 outline-hidden | `0 / 0 / 0` | FAIL 유지 |

두 번의 outline-hidden 캡처는 같은 이미지 객체를 자기 자신에게 빼는 검사가 아니다. 실제 별도 캡처를 비교하고 없어진 외곽선은 계속 실패시킨다. 양성/음성 PNG를 모두 저장한다. 최신 영수증은 `%TEMP%/hapark-ai-pet-20261018/outline-differential/result.json`이고, 이 폴더에 `light/dark-tip-default-outline-hidden.png`와 `light/dark-tip-quarter-outline-hidden.png`도 있다.

이 작업트리 자체 Electron에서 **10/10 PASS**, 실제 6초·14초 주기 관측, 물리 호버·미소·커서 복원, 포커스 보존, 정상 종료·소유 QA 프로필 삭제를 확인했다. QA 창은 작업 영역 왼쪽 위이며 사용자 설치 앱·펫은 조작하지 않았다. 네트워크·CLI 요청·실계정 프로필 읽기는 0이다. `npm --prefix connector test`는 **총 212개 중 211 PASS / 1 native opt-in SKIP**, `node --check`와 scoped `git diff --check`도 PASS다. 전체 Node 원문은 `%TEMP%/hapark-bri-outline-release-20261018/node-final.log`에 남겼다.

새 QA의 실제 Mac/Ubuntu CI는 아직 실행하지 않았다. 이 로컬 GREEN은 실패한 preview.2 태그의 성공·릴리스 게시·사용자 설치 증거가 아니다. 재태그·하네스 상태 기록은 부모 작업으로 남긴다.

## 이전: preview.1 CI 이후 검사 보정

소스 `5b9daccf7defd069d2a934fcf8c1fd81a18f61de`, CI `39112898344`의 Windows `117632599699`·Mac Intel `117632599660`·Ubuntu `117632599648`은 기존 검사에서 흰 배경 `8/6/6`, 다크 배경 `2/0/2`로 실패했다. 당시 CI는 정확한 tip geometry·전경색을 기록하지 않아 그 값을 추정하지 않는다. 로그의 얼굴 `[26,24,22,255]`는 BGRA 형식의 `--subtle` 색이며 안테나의 RGB 색으로 사용하지 않는다.

제품 HTML·CSS·0.1.7 버전은 그대로 두고 QA만 보정했다. 실제 Windows에서 QA 캐릭터를 `(0.25px,0.25px)` 이동하자 기존 검사도 흰 배경 `7/7/4`, 다크 배경 `0/0/0`으로 실패했다. 영수증은 `%TEMP%/hapark-ai-pet-20261018/outline-subpixel-red/result.json`이다.

새 검사는 같은 도형 위치에서 실제 흰색·다크 캡처를 짝지어 배경 혼합률과 잉크 알파를 계산한다. 투영된 안테나 환형 영역 안에서 실제 computed graphite·lime·기존 halo 색상의 혼합 거리로 외곽선을 구분한다. 고정 채널 임계값을 넓히지 않았으며 잉크 알파 0.6·graphite 비중 0.75·색상 잔차 16 기준을 유지한다. geometry·RGB 색·판정 기준·픽셀 수와 일부 알파/색 성분이 영수증에 남는다. 관측된 RGB는 graphite `[14,15,12]`, lime `[198,255,61]`, halo `[236,237,232]`다.

| 실제 Windows 대조 | 위·좌·우 픽셀 | 판정 |
| --- | --- | --- |
| 기본 위치, 실제 외곽선 | `8/4/4` | PASS |
| 0.25px 이동, 실제 외곽선 | `4/4/2` | PASS |
| 기본 위치, QA DOM에서 외곽선만 숨김 | `0/0/0` | FAIL 유지 |
| 0.25px 이동, QA DOM에서 외곽선만 숨김 | `0/0/0` | FAIL 유지 |
| 최초 실제 RED의 흰/다크 원본 PNG 재검사 | `0/0/0` | FAIL 유지 |

음성 대조는 합성 픽셀이 아니라 실제 Electron 캡처다. 임시 DOM 변형은 검사 뒤 복구하며 제품 파일을 바꾸지 않는다. CI에 최초 로컬 PNG가 없으면 그 재검사만 `checked:false`로 남기고, 두 위치의 실제 outline-hidden 대조는 계속 필수다.

검사 보정 중 오른쪽 아래 QA 창의 물리 호버는 실패했다. 사용자의 설치된 0.1.6 펫이 같은 기본 위치에 켜져 있음을 부모가 확인했다. 사용자 앱·펫을 조작하지 않고 **소유 QA 창만 작업 영역 왼쪽 위로 옮긴 뒤 10/10 PASS**했다. 특정 창의 가림 HWND는 측정하지 않았으므로 충돌 주체까지 확정하지 않는다. 임의로 옮긴 다른 항상 위 창과의 비가림까지 보장하지 않는다. DIP→물리 좌표 변환, `showInactive`, 포커스 보존 및 실제 커서 복원 조건은 유지했다.

최신 영수증: `%TEMP%/hapark-ai-pet-20261018/outline-paired-isolated/result.json`. 같은 폴더의 `light-neutral.png`·`dark-neutral.png`와 `light-tip-quarter.png`·`dark-tip-quarter.png`는 실제 양성 캡처다. 네이티브 호버·미소·커서 복원 true, 포커스 관측·네트워크·CLI 요청 0, 정상 종료·소유 QA 프로필 삭제 true, 강제 종료 false다. 관련 Node 검증은 다시 **5 PASS / 1 native opt-in SKIP**다. QA SHA256은 `51ddb266d800782b0ca5152a2e4b1965c4866d6431cf7185e4a32f64918394d8`이다.

보정한 QA의 하네스 step 2와 정확한 새 소스의 다중 OS CI는 아직 대기한다. Mac·Ubuntu 보정판 통과, 새 태그 게시·설치 성공을 주장하지 않는다.

## 이전 하네스·초기 로컬 기록

보정 전 부모 하네스 재검증: 이 작업트리의 자체 Electron 의존성으로 step 1·2를 실행해 통과했다. 당시 네이티브 펫은 10개 통과, 전체 connector 테스트는 211개 통과·명시 opt-in 1개 생략이었다. 이 기록은 위 preview.1 CI 실패와 보정판 검증을 대신하지 않는다.

최초 기준 소스는 `6e44b22ee297c2da7ca8e49a3bc14eb9489b838c`다. 제품 renderer는 [pet.html](../../connector/desktop/renderer/pet.html)의 기존 하부 outline에 원 한 줄만 추가했다. `pet.css`는 변경하지 않았다. 아래 수치는 초기 로컬 기록이며 0.1.7 공개·설치 완료 기록이 아니다.

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

## 최초 로컬 관측 범위

| 경계 | 현재 직접 확인한 결과 |
| --- | --- |
| Windows x64 Electron renderer | 안테나 대비 포함 10개 PASS. 실제 깜빡임 주기 5999ms, 미소 주기 13999.1ms. 네이티브 얼굴 호버·커서 복원 PASS |
| Mac arm64·Intel / Ubuntu x64 | 초기 로컬 단계에서는 미실행. 이후 Intel·Ubuntu preview.1 실패와 보정판 CI 대기는 위 최신 기록을 따름 |
| 드래그·접근성 | 중앙 28×26px no-drag와 나머지 드래그 CSS 보존, 동작 줄이기·정적 호버 PASS. 물리적 OS 드래그는 미실행 |
| 보안·수명 | sandbox·contextIsolation·Node 차단·기존 CSP 유지. 포커스 요청·관측 0, 네트워크·CLI 요청 0, 기존 계정 프로필 읽기 0 |
| 정리 | 소유 Electron 정상 종료·QA 프로필 삭제 true, 강제 종료 false. 기존 앱·프로필·OS 프로토콜을 다루지 않음 |
| 패키징·게시·설치 | 이번 0.1.7 후보로는 아직 미실행. 버전 준비와 renderer QA는 서명·공증·게시·기존 사용자 업그레이드 증거가 아님 |

## 버전·최소 회귀

기존 packaging identity 기대값을 먼저 `0.1.7`로 바꿔 실제 `0.1.6 !== 0.1.7` RED를 확인했다. 이후 desktop package와 lockfile 최상위·루트 metadata의 버전 세 곳만 바꿨다. 의존성 버전·무결성 값은 변경하지 않았다.

`node --test connector/test/pet-renderer.test.mjs connector/test/desktop-packaging-identity.test.mjs connector/test/desktop-version-display.test.mjs`: **5 PASS / 1 native opt-in SKIP**. 이 skip은 별도 Electron 10개와 합산하거나 실제 네이티브 실행으로 표시하지 않는다. 초기 수동 버전 검증 명령 자체는 native QA를 재실행하지 않았으며, 뒤 부모 하네스와 QA 보정판의 네이티브 실행은 별도 근거다.

| 최초 직접 검증한 파일 | 당시 SHA256 |
| --- | --- |
| `connector/desktop/renderer/pet.html` | `cd676f142694194dc6a3b4d21a936a040efb60dca74100dd1cf22aea55a87a66` |
| `connector/scripts/pet-qa.mjs` | `ee2c5f48d40bd0f3cff46e962a05f79759777cc6297918cf30a230c0f1534952` |

초기 및 보정 후 `node --check connector/scripts/pet-qa.mjs`와 `git diff --check`도 통과했다. 최초 하네스 통과 이력은 보존하고, 보정판 step 2는 재검증 대기로 두었다. 최종 소스 CI·패키지 SHA·릴리스·운영 또는 기존 설치 앱의 확인은 부모가 별도로 기록한다.
