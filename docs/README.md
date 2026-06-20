# 하박조팽 — 맥락설계 문서 (Context Design)

4인 리서치 그룹의 주간 세미나 워크스페이스. 이 `docs/`는 제품을 **역할별 관점**으로 나눠 정리한 맥락설계 세트다. 정본 핸드오프는 루트 `README.md`·`PRD.md`·`CLAUDE.md`이며, 충돌 시 루트를 따른다.

## 역할별 문서

### 🧑‍💻 유저 — `user/`
| 문서 | 내용 |
|---|---|
| [PRD](./user/PRD.md) | 제품 정의·목표·핵심 기능·비목표 |
| [USER_JOURNEY](./user/USER_JOURNEY.md) | 페르소나별 시간 축 서사(주간 세미나 사이클) |
| [USER_FLOW](./user/USER_FLOW.md) | 목표 완료까지의 단계·분기(클릭 단위) |

### 🛠️ 개발자 — `dev/`
| 문서 | 내용 |
|---|---|
| [ARCHITECTURE](./dev/ARCHITECTURE.md) | 구조·프로덕션 스택·교체표 |
| [DB](./dev/DB.md) | Prisma 스키마(SQLite)·파생값 |
| [API](./dev/API.md) | route handler 엔드포인트·권한·상태 코드 |
| [SEQUENCE_DIAGRAM](./dev/SEQUENCE_DIAGRAM.md) | 주요 동작의 컴포넌트 호출 순서 |
| [CODING_CONVENTION](./dev/CODING_CONVENTION.md) | 스택·네이밍·타입·금지 규칙 |
| [ENV](./dev/ENV.md) | 환경 변수·논문 분석 LLM 파이프라인 |
| [DEPLOY](./dev/DEPLOY.md) | 배포 런북(Vercel·Supabase·LiveKit·Inngest) |

### 🎨 디자이너 — `design/`
| 문서 | 내용 |
|---|---|
| [DESIGN_GUIDE](./design/DESIGN_GUIDE.md) | 토큰·컴포넌트·금지 사항 |
| [SCREENS](./design/SCREENS.md) | 화면별 구성·카피 카탈로그 |
| [SCREEN_FLOW](./design/SCREEN_FLOW.md) | 화면 전환 맵·조건부 UI 상태 |

### 🔒 보안 — `security/`
| 문서 | 내용 |
|---|---|
| [SECURITY](./security/SECURITY.md) | 위협 모델·인증/인가·비밀·데이터 보호 |

### 🤖 에이전트 — `agent/`
| 문서 | 내용 |
|---|---|
| [ADR](./agent/ADR.md) | 주요 결정 기록(ADR-001~022) |
| [STATE](./agent/STATE.md) | 앱 레벨 vs 서버 영속 상태 |
| [ISSUES](./agent/ISSUES.md) | 미결 사항·열린 질문 |
| [RULES](./agent/RULES.md) | 절대 어기면 안 되는 불변 규칙 |

## 확정 사항 (이번 맥락설계)

- **스택:** Next.js 15 (App Router) + TS strict + Tailwind + shadcn (ADR-009)
- **DB:** Prisma + SQLite, Postgres 이전 경로 유지 (ADR-010)
- **라이브:** LiveKit 다자간 화상(SFU), MVP 포함 (ADR-019, ADR-002 대체)
- **논문 분석:** Google Gemini 보조 추출, 키는 `.env`(서버 전용) (ADR-011, [ENV](./dev/ENV.md))

### 런타임 아키텍처 (ADR-015·016 → [ARCHITECTURE](./dev/ARCHITECTURE.md))
- **배포:** **Vercel(Next.js 15) + Supabase** (ADR-016이 ADR-010/012 개정). 로컬 dev는 SQLite, 운영 DB는 Supabase Postgres
- **긴 작업:** 분석·arXiv·녹화는 **외부 durable 잡 러너**(Inngest/Trigger.dev/QStash)로, 요청 경로 인라인 금지 (ADR-013→016)
- **실시간:** `live` 전이·@멘션은 **Supabase Realtime** 푸시, 폴링 아님 (ADR-014→016)
- **인증:** Google OAuth (Supabase Auth) + 초대 게이트 (ADR-017)
- **데이터 흐름:** 읽기=RSC 서버 조회, 쓰기=Server Action/route handler (ADR-015)

## UX 관점 (전 문서 적용)

기능·데이터뿐 아니라 **사용 경험**을 문서 전반에 박아 두었다:
- **상태 3종**(로딩·빈·에러)을 모든 데이터 화면에 의무화 ([DESIGN_GUIDE §UX 패턴](./design/DESIGN_GUIDE.md), [SCREENS §화면별 상태](./design/SCREENS.md), RULES R26)
- **파괴적 액션 확인/되돌리기**, **업로드≠분석 분리**, **인라인 검증**, **따뜻한 에러 카피** (RULES R27–R30, [API 상태코드→UX 매핑](./dev/API.md))
- **접근성·모션**(`prefers-reduced-motion`, 색+텍스트 병행, 키보드/스크린리더)과 **반응형**(모바일 핵심 동선)
- **엣지 케이스**(동시 라이브 시작, 분석 실패, 발표자 휴가, 네트워크 끊김) ([SCREENS](./design/SCREENS.md), [SCREEN_FLOW](./design/SCREEN_FLOW.md), [USER_JOURNEY 마찰 지점](./user/USER_JOURNEY.md))

## 시작점

- 무엇을 만드는가 → [PRD](./user/PRD.md)
- 어떻게 쓰이는가 → [USER_JOURNEY](./user/USER_JOURNEY.md) · [USER_FLOW](./user/USER_FLOW.md)
- 왜 이렇게 결정했는가 → [ADR](./agent/ADR.md)
- 무엇을 어기면 안 되는가 → [RULES](./agent/RULES.md)
- 무엇이 아직 미정인가 → [ISSUES](./agent/ISSUES.md)
