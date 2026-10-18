# 브리 캐릭터와 트레이에서 상태 확인·열기·종료

선행 산출물은 `phases/16-ai-bridge-pairing-countdown/step0.md`의 번호 UX와 `docs/design/AI_BRIDGE_TRAY_CHARACTER.md`의 Aside 기반 시각 메모다.

- 앱·설치·트레이·펫의 글자·부엉이 표식을 사용자가 지정한 브리 캐릭터와 그라파이트·라임 색감으로 교체한다. 아이콘은 하나의 SVG에서 생성한다.
- Windows 트레이·macOS 메뉴 막대에 상태와 열기·종료 메뉴를 제공한다. 정상 상태 갱신만으로 창을 열거나 포커스를 가져오지 않는다.
- 연결 중 창 닫기는 실제 트레이를 사용할 수 있는 Windows·Mac에서만 숨김이다. Linux·트레이 생성 실패는 CLI와 모니터를 정리한 뒤 종료한다. 실행 중 트레이가 사라지면 숨은 창을 포커스 없이 복구한다.
- 트레이를 폐기하기 전에 실행·모니터를 정리한다. 메뉴 콜백의 중복 종료와 폐기 뒤 늦은 호출을 차단한다.
- 기존 Windows 복구 QA는 비패키지 전용 `--connector-qa-tray`로 실제 트레이를 사용하되 창은 offscreen·숨김으로 유지한다. 이 플래그로 프로토콜 등록이나 패키지 보안을 우회하지 않는다.
- 실제 계정 추론·OS 프로토콜 등록을 이 자동 QA에서 하지 않는다. 이유: 격리된 fixture만으로 상태·종료와 네이티브 UI를 검증할 수 있다.
- 자동 시작·펫은 기본 꺼짐이며 웹 실행 허가의 수명과 기존 OS 암호화 저장 경로는 유지한다.
- 설치 앱 버전은 0.1.2로 올리고 공개 preview 파일은 정확한 소스·네이티브 검증 뒤 게시한다.

## Acceptance Criteria

```text
node --test connector/test/*.test.mjs
node connector/scripts/desktop-tray-qa.mjs
node connector/scripts/run-desktop-qa.mjs
```

Windows 로컬은 실제 Electron·MenuItem 콜백·sandbox·창 숨김과 종료·번호 재입력·허가 만료를 확인한다. OS 메뉴에서의 실제 마우스 클릭과 Linux 트레이 표시 여부는 별도 수동 범위로 기록한다. Mac·Ubuntu는 CI의 기존 암호화·설치 검사와 새 트레이 QA에서 확인한다.
