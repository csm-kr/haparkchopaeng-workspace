# Step 6: portable-extraction

이전 산출물: [step5-output.json](step5-output.json), [연결기 검증 기록](../../connector/VALIDATION.md), [구현 보고서](../../docs/reports/local-agent-implementation-2026-10-17.html). Step 5의 완료는 원본 `d54a1fd` 개발 배포 후보 검증이며 운영 배포 완료가 아니다.

검증된 연결기를 비공개 [local-agent-connector](https://github.com/csm-kr/local-agent-connector) 저장소로 분리했다. 기준 소스는 `1fc2689`, 확인한 원격 CI는 [39030734544](https://github.com/csm-kr/local-agent-connector/actions/runs/39030734544)다. 원본 코어 9개 SHA256을 유지하면서 호스트별 정적 origin·고유 scheme·브랜드·데스크톱 appId·프로필·기기 키를 분리한다. 로그인·팀 멤버십·논문 권한·DB 큐는 각 호스트 서버가 REST 계약에 맞춰 제공한다.

## 확인한 공통 repo 결과

| 경계 | 실제 검증 |
| --- | --- |
| Windows x64 | 계약·설정 64 total / 64 pass / 0 skip, builder 1/1, runtime self-test 7/7, Research Notebook 실제 native 13조건. NSIS 빌드·실제 무인 설치·고유 URI 등록·번들 Node·코어 10개 SHA·제거·원복 통과 |
| macOS 15 arm64 | 계약·설정 64 total / 62 pass / Windows 전용 2 skip, builder 1/1, self-test 7/7, 실제 native 13조건, arm64·x64 DMG 빌드. Intel native·Finder 설치는 별도 |
| Ubuntu 24.04 x64 | 계약·설정 64 total / 62 pass / Windows 전용 2 skip, builder 1/1, self-test 7/7, 실제 native 13조건. `.deb` 빌드 및 launcher·maintainer script·URI·sandbox 설정 읽기 검사. 사용자 `.deb` 설치·Wayland는 별도 |

Native는 loopback API fixture와 실제 Electron·OS 암호화 저장소를 사용하며 추론·브라우저 실행은 0회다. Ubuntu는 GUI/Xvfb·D-Bus·실제 keyring·CJK 글꼴·공식 sandbox 전제이며 `basic_text`, mock keychain, sandbox 비활성화로 통과시키지 않았다. AppImage는 제외했다. 실행 job은 Mac `117390492806`, Windows `117390492881`, Ubuntu `117390492896`이며 3개 모두 성공했다.

첫 CI `39030533949`는 native 성공 뒤 GitHub artifact quota로 업로드에 실패했다. 업로드를 선택 단계로 분리한 후속 실행이 위 최종 CI다. 설치 파일과 native 캡처의 artifact 보관은 기본 꺼짐이며 결과·패키지 SHA는 job 로그와 summary에 남긴다. 보관되지 않은 파일을 내려받을 수 있는 정식 배포로 표시하지 않는다.

## UI/UX 우선 통합 스킬과 소비자 검증

공통 repo의 `skills/local-agent-integration/SKILL.md`와 `references/acceptance.md`는 Aside로 현재 UI/UX 조사 → 기존 접합 재사용 → 앱 JSON → 호스트 REST → 인수 검증 순서를 제공한다. 자동 시작·펫·모델 기본값은 꺼짐/무선택, 웹의 번호와 앱의 빈 6자리 입력, 작은 링과 실제 사용량 신선도, 권한 회수를 유지한다.

2026-10-17 기존 폴더가 없음을 확인한 뒤 `C:/Users/csm81/.codex/skills/local-agent-integration`에 두 파일만 설치했다. `python -Xutf8 C:/Users/csm81/.codex/skills/.system/skill-creator/scripts/quick_validate.py C:/Users/csm81/.codex/skills/local-agent-integration` 결과는 `Skill is valid!`이며 설치본·소스 SHA256은 동일하다. `SKILL.md`는 `298DC13E033B9F12EC5B4B85487F0140D889D29C19E6CAF6311DB280CD369B0A8`, 인수 시나리오는 `F50F4DD5F75513FBECE352AC0671D11ADEF0504AD66EAD3486EB687B2240B2DC`다.

별도 소비자 요청에서는 kit `db770ef`, 호스트 `d54a1fd`를 읽어 재사용 경계·UI 메모·설정 JSON·다음 실행 명령을 임시 HTML로 구체화했다. Aside 1.26.1015.732의 배경 GET에서 dashboard는 로그인 SSR로 이어졌고 status/downloads API는 404였다. 로그인된 내부 화면·다크·모바일은 관측하지 않았다. 기존 2개 탭·활성 타깃을 보존했고 코드·설치·서버·추론 변경은 0회였다. 이후 `1fc2689` 전체의 소비자 재실행이나 운영 연결 성공으로 확대하지 않는다. 상세 근거와 패키지 해시는 공통 repo `docs/VALIDATION.md`에 있다.

## Acceptance Criteria

원격 실행의 실제 성공 결과를 다시 확인한다. 이 명령은 새로운 추론·설치·배포를 시작하지 않는다.

```text
gh run watch 39030734544 --repo csm-kr/local-agent-connector --exit-status
```

원본 checkout에서 `python scripts/execute.py 12-local-agent-connection --verify --step 6`을 실행해 exit code와 `step6-output.json`을 기록한다. 이 검증은 git stage·commit·push 없이 수행한다.

## 완료 범위와 남은 일

Step 6 완료는 공통 repo 분리·두 번째 호스트·3OS CI·스킬 설치와 읽기 전용 소비자 설계의 완료다. 운영 서명·공증·공개 다운로드·운영 SQL 적용·운영 웹 연결은 완료하지 않았다. 새 호스트의 인증·팀·DB 접합과 실제 사용자 설치는 별도 검증한다.

사용자가 추가 요청한 논문 분석 API 대체·AI 연구 채팅은 **phase 13에서 별도 진행 중**이다. Phase 12와 공통 repo CI 통과를 그 새 기능의 완료로 간주하지 않는다. Phase 12 완료는 전체 goal 완료가 아니다.
