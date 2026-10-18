# 선택한 펫의 대비와 표정

입력: `docs/design/AI_BRIDGE_TRAY_CHARACTER.md`, `docs/design/DESIGN_GUIDE.md`, 기존 `connector/desktop/renderer/pet.html`, `pet.css`, `connector/desktop/main.mjs`의 펫 수명·드래그·sandbox 계약.

흰색·그라파이트 배경에 구분되는 얼굴 면·눈·입·외곽선을 `pet.html`의 인라인 SVG로 만들고, `pet.css`에서 6초마다 감긴 표정 약 180ms·전환 포함 약 360ms의 깜빡임, 14초마다 약 1.2초의 자발 미소를 표현한다. 눈·입 중앙의 28×26px만 `no-drag` 표정 영역으로 두어 즉시 호버 미소를 제공하고, 테두리·몸체·플러그는 잡아 옮긴다. reduced-motion에서는 반복 동작을 끄고 정적 호버 표정만 남긴다. 주기·지속시간을 설계 문서와 일치시킨다. 기본 꺼짐과 사용자의 기존 선택은 유지하며 공용 설치·트레이 자산은 바꾸지 않는다.

TDD: `connector/test/pet-renderer.test.mjs`의 펫 renderer·스타일 회귀를 먼저 실패시키고 통과 구현을 작성한다. 접근 가능한 이름, 외부 스크립트 없음, CSP와 드래그, reduced-motion 경계를 포함한다. AC: `node --test connector/test/*.test.mjs`. 정적 테스트는 실제 렌더·시간 경과·네이티브 드래그 성공의 대체 증거가 아니다.

웹의 애니메이션 허용 목록을 늘리지 마라. 이유: 사용자 요청은 켠 데스크톱 펫에 한정된다. 펫에 preload·새 IPC·원격 리소스를 추가하지 마라. 이유: 표정은 실행 권한이나 연결 계약을 바꾸지 않는다. 원본 dirty checkout을 수정하지 마라. 이유: 현재 격리 작업트리 밖의 사용자 작업을 보존한다.

산출물: 펫 renderer·관련 테스트와 RED/GREEN 기록. 버전·패키지·배포는 부모가 별도로 관리하며 이 step에서 완료로 기록하지 않는다.
