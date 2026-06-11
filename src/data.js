// ============================================
// 하박조팽 — Mock Data
// ============================================

window.TEAM = [
  {
    id: "ha",
    name: "하수현",
    handle: "@hajieun",
    role: "PI / 멀티모달 LLM",
    color: "var(--m-ha)",
    initial: "하",
    presence: "online",
    status: "📍 NeurIPS 마감 모드",
    email: "ha@habakjopaeng.team",
  },
  {
    id: "bak",
    name: "박진희",
    handle: "@parksj",
    role: "Vision / Diffusion",
    color: "var(--m-bak)",
    initial: "박",
    presence: "online",
    status: "리뷰 중",
    email: "park@habakjopaeng.team",
  },
  {
    id: "jo",
    name: "조성민",
    handle: "@chominho",
    role: "RAG / 평가",
    color: "var(--m-jo)",
    initial: "조",
    presence: "away",
    status: "회의 — 5시 복귀",
    email: "cho@habakjopaeng.team",
  },
  {
    id: "paeng",
    name: "팽진욱",
    handle: "@paengjh",
    role: "Robotics / RL",
    color: "var(--m-paeng)",
    initial: "팽",
    presence: "busy",
    status: "🔬 실험 돌리는 중",
    email: "paeng@habakjopaeng.team",
  },
];

window.CURRENT_USER = window.TEAM[0];

// 멤버 권한 (관리자 | 멤버 | 게스트)
window.ACCESS = { ha: "관리자", bak: "멤버", jo: "멤버", paeng: "멤버" };

// 초대 대기 중인 사람들
window.PENDING_INVITES = [
  { email: "yoon@university.ac.kr", role: "멤버", sentAt: "2일 전", by: "ha" },
  { email: "intern.kim@university.ac.kr", role: "게스트", sentAt: "어제", by: "ha" },
];

// 워크스페이스 메타
window.WORKSPACE = { name: "하박조팽", slug: "habakjopaeng", createdDays: 142, seats: 8 };

// 현재 진행 중인 라이브 세미나 (null이면 배너 숨김)
window.SEMINAR_LIVE = {
  title: "주간 세미나 — Mixture-of-Depths 리뷰",
  presenter: "jo",
  count: 3,
};

window.PAPERS = [
  {
    id: "p1",
    title: "Mixture-of-Depths: Dynamically allocating compute in transformer-based language models",
    authors: "Raposo et al., DeepMind",
    venue: "ICML 2024",
    year: 2024,
    uploadedBy: "jo",
    uploadedAt: "오늘 14:22",
    tags: ["LLM", "Efficiency"],
    kind: "pdf",
    pageCount: 14,
    arxiv: "2404.02258",
    abstract: "Transformer 기반 언어 모델은 시퀀스 전반에 균등한 FLOPs를 사용하지만, 모든 토큰이 동일한 계산을 필요로 하지는 않는다. 본 논문은 라우터 메커니즘을 통해 각 레이어에서 동적으로 토큰별 연산량을 할당하는 Mixture-of-Depths (MoD) 를 제안한다.",
    method: [
      "각 transformer 블록 앞에 가벼운 router를 두고, top-k 토큰만 self-attention + MLP를 통과",
      "선택되지 않은 토큰은 residual connection을 통해 그대로 다음 레이어로",
      "Capacity를 일정한 비율로 제한 — 컴파일 친화적 정적 그래프 유지",
      "MoE와 결합한 MoDE 변형도 제시",
    ],
    results: [
      "동일한 FLOPs에서 baseline 대비 -1.5% perplexity",
      "동일한 perplexity 도달까지 50% 더 적은 FLOPs",
      "Inference 단계에서 step당 최대 50% 빠른 처리",
    ],
    keywords: ["transformer", "conditional compute", "routing", "MoE", "efficient inference"],
    notes: "@박진희 우리 vision backbone 에도 적용 가능할 것 같음. 다음 주 미팅에서 논의.",
  },
  {
    id: "p2",
    title: "ReALM: Reference Resolution As Language Modeling",
    authors: "Moniz et al., Apple",
    venue: "Preprint",
    year: 2024,
    uploadedBy: "ha",
    uploadedAt: "어제 18:40",
    tags: ["NLP", "On-device"],
    kind: "pdf",
    pageCount: 9,
    abstract: "Reference resolution을 자연어 생성 문제로 재정의. 화면 상의 entity, 대화 컨텍스트, 백그라운드 entity를 모두 토큰 시퀀스로 인코딩하여 LM이 직접 처리.",
    method: [
      "Screen entity를 좌표 기반 텍스트로 직렬화",
      "기존 NER 파이프라인 없이 end-to-end LM fine-tuning",
      "On-device용 80M / 250M / 1B 모델 트레이닝",
    ],
    results: [
      "GPT-4 대비 동등 이상의 성능 (특정 태스크에서)",
      "Parameter 효율 — 80M 모델이 GPT-3.5 능가",
    ],
    keywords: ["reference resolution", "on-device LLM", "context understanding"],
  },
  {
    id: "p3",
    title: "Diffusion Forcing: Next-token prediction meets full-sequence diffusion",
    authors: "Chen et al., MIT",
    venue: "NeurIPS 2024",
    year: 2024,
    uploadedBy: "bak",
    uploadedAt: "3일 전",
    tags: ["Diffusion", "Video"],
    kind: "pdf",
    pageCount: 18,
    abstract: "Autoregressive next-token prediction과 full-sequence diffusion을 통합하는 새로운 프레임워크. 각 토큰별 독립적인 노이즈 레벨로 학습.",
    method: [
      "토큰마다 다른 시간 t로 노이즈 추가",
      "causal masking + diffusion loss 결합",
      "추론 시 가변 horizon 가능 — rolling generation",
    ],
    results: [
      "비디오 생성에서 안정적 long-rollout",
      "Planning task에서 MCTS 보다 효율적",
    ],
    keywords: ["diffusion", "video generation", "planning"],
  },
  {
    id: "p4",
    title: "RT-2: Vision-language-action models transfer web knowledge to robotic control",
    authors: "Brohan et al., Google DeepMind",
    venue: "CoRL 2023",
    year: 2023,
    uploadedBy: "paeng",
    uploadedAt: "1주 전",
    tags: ["Robotics", "VLM"],
    kind: "pdf",
    pageCount: 26,
    abstract: "VLM을 robotic control에 직접 활용. Action을 텍스트 토큰으로 코딩하여 일반 VLM을 그대로 fine-tune.",
    method: ["Action discretization → text tokens", "Co-training: 웹 데이터 + 로봇 시연", "Chain-of-thought reasoning for control"],
    results: ["Unseen object 일반화 +63%", "Semantic reasoning 가능한 manipulation"],
    keywords: ["VLA", "robot learning", "generalization"],
  },
  {
    id: "p5",
    title: "InstructBLIP: Towards general-purpose vision-language models with instruction tuning",
    authors: "Dai et al., Salesforce",
    venue: "NeurIPS 2023",
    year: 2023,
    uploadedBy: "bak",
    uploadedAt: "2주 전",
    tags: ["VLM", "Instruction"],
    kind: "pdf",
    pageCount: 12,
    abstract: "26개 instruction 데이터셋을 활용한 vision-language 모델의 instruction tuning. Q-Former를 활용한 효율적 visual feature 추출.",
    keywords: ["instruction tuning", "vision-language"],
  },
];

window.PRESENTATIONS = [
  {
    id: "pres1",
    title: "주간 세미나 — Mixture-of-Depths 리뷰",
    presenter: "jo",
    date: "오늘 16:00",
    duration: "30분",
    slideCount: 12,
    tags: ["주간세미나"],
    summary: "MoD의 라우팅 메커니즘과 우리 RAG 평가 파이프라인에서의 활용 가능성 검토.",
    keypoints: [
      "Token-level conditional compute의 효과 — perplexity-FLOPs 트레이드오프",
      "Router의 capacity 제약이 batch 처리에 미치는 영향",
      "RAG retrieval re-ranking 단계에 적용 시 latency 50% 절감 가능성",
      "단점: 매우 짧은 시퀀스에서는 overhead가 더 큼",
      "Next step: 우리 RAG 벤치마크에 적용 실험 셋업 — 다음 주",
    ],
    slides: [
      { title: "Mixture-of-Depths", subtitle: "Dynamically allocating compute in transformers", body: "조성민 · 2026.05.19 주간 세미나" },
      { title: "왜 이 논문인가", body: "• Inference 비용 = 우리 RAG 시스템의 가장 큰 병목\n• 모든 토큰에 같은 연산? 비효율\n• MoE보다 단순한 sparse compute 방식" },
      { title: "Core Idea", body: "Router → top-k 토큰만 통과\n나머지는 residual로 skip\nCapacity 고정 → 정적 그래프 유지" },
      { title: "Architecture", body: "[블록 다이어그램]\nRouter (linear) → top-k selection\n→ self-attn + MLP\n→ skip path는 그대로 통과" },
      { title: "Training", body: "Auxiliary loss 불필요\nCapacity factor c = 0.125 ~ 0.5\nFull-attention baseline과 동일 FLOPs로 비교" },
      { title: "Result 1 — Perplexity", body: "동일 FLOPs에서 -1.5% PPL\n특히 mid-depth 레이어에서 효과적" },
      { title: "Result 2 — Latency", body: "Inference step당 최대 50% 단축\nbatch size 영향 미미" },
      { title: "MoDE Variant", body: "MoE + MoD 결합\n각 전문가가 sparse하게 활성화\n추가 FLOPs 절감" },
      { title: "Limitation", body: "짧은 시퀀스(<512)에서 효과 미미\nRouter의 미분 가능성 — straight-through estimator 의존" },
      { title: "우리 시스템에 적용?", body: "Re-ranker에 적용 → latency budget 여유 확보\n생성 단계 적용은 추가 검토 필요" },
      { title: "Next Steps", body: "1. MoD 오픈소스 코드 fork\n2. 우리 8B re-ranker에 통합\n3. RAG-eval 벤치마크 회귀 측정\n4. 다음 주 결과 공유" },
      { title: "Q & A", body: "조성민 @chominho\nthank you 🙏" },
    ],
  },
  {
    id: "pres2",
    title: "Diffusion Forcing 발표 자료",
    presenter: "bak",
    date: "어제",
    duration: "25분",
    slideCount: 9,
    tags: ["주간세미나"],
    summary: "박진희가 발표한 Diffusion Forcing 논문 정리.",
    keypoints: [
      "Per-token noise level — autoregressive와 diffusion의 결합",
      "Long-horizon generation 안정성 개선",
      "우리 video synthesis 파이프라인에 적용 검토",
    ],
    slides: [],
  },
  {
    id: "pres3",
    title: "Q2 연구 로드맵 — 멀티모달 평가",
    presenter: "ha",
    date: "5월 12일",
    duration: "45분",
    slideCount: 18,
    tags: ["로드맵"],
    summary: "Q2 연구 방향, NeurIPS 제출 전략, 자원 분배 논의.",
    keypoints: [],
    slides: [],
  },
];

window.IDEAS = [
  {
    id: "i1",
    title: "MoD 기반 efficient RAG re-ranker",
    desc: "Mixture-of-Depths를 우리 RAG 시스템의 re-ranking 단계에 적용. Latency 50% 절감이 목표.",
    status: "exploring",
    tags: ["RAG", "Efficiency"],
    owners: ["jo", "ha"],
    relatedPaper: "p1",
  },
  {
    id: "i2",
    title: "Vision-language alignment 평가 벤치마크",
    desc: "기존 벤치마크의 한계를 극복하는 새로운 multimodal alignment 평가셋. Distribution shift에 robust한 메트릭.",
    status: "exploring",
    tags: ["VLM", "Eval"],
    owners: ["bak", "ha"],
  },
  {
    id: "i3",
    title: "On-device reference resolution",
    desc: "ReALM 아이디어를 우리 모바일 어시스턴트 파이프라인에 적용. 80M 모델로 충분한지 검증 필요.",
    status: "drafting",
    tags: ["On-device", "NLP"],
    owners: ["ha"],
    relatedPaper: "p2",
  },
  {
    id: "i4",
    title: "Diffusion Forcing — robot trajectory planning",
    desc: "RT-2 + Diffusion Forcing 결합. Long-horizon manipulation을 위한 trajectory generation.",
    status: "drafting",
    tags: ["Robotics", "Diffusion"],
    owners: ["paeng", "bak"],
  },
  {
    id: "i5",
    title: "Compositional VQA — synthetic data pipeline",
    desc: "VLM의 compositional reasoning 개선을 위한 자동 데이터 생성. Scene graph → caption → question.",
    status: "experimenting",
    tags: ["VLM", "Data"],
    owners: ["bak"],
  },
  {
    id: "i6",
    title: "Reward model에서 length bias 제거",
    desc: "RLHF reward model의 length 편향을 디버깅. Token-level penalty + length-balanced sampling.",
    status: "experimenting",
    tags: ["RLHF", "Alignment"],
    owners: ["jo"],
  },
  {
    id: "i7",
    title: "Sim-to-real for diffusion policy",
    desc: "Diffusion policy의 sim-to-real gap. Domain randomization + adapter layer.",
    status: "submitted",
    tags: ["Robotics", "Sim2Real"],
    owners: ["paeng"],
  },
];

window.ACTIVITIES = [
  { id: "a1", user: "jo", action: "uploaded", target: "Mixture-of-Depths", targetType: "paper", time: "방금 전", targetId: "p1" },
  { id: "a2", user: "ha", action: "commented_on", target: "ReALM", targetType: "paper", time: "12분 전", targetId: "p2", excerpt: "On-device에 적용하려면 latency budget 측정부터 해야할듯" },
  { id: "a3", user: "bak", action: "presented", target: "Diffusion Forcing 발표 자료", targetType: "pres", time: "1시간 전", targetId: "pres2" },
  { id: "a4", user: "paeng", action: "added_idea", target: "Diffusion Forcing — robot trajectory planning", targetType: "idea", time: "2시간 전", targetId: "i4" },
  { id: "a5", user: "ha", action: "shared", target: "Q2 연구 로드맵", targetType: "pres", time: "어제", targetId: "pres3" },
  { id: "a6", user: "jo", action: "mentioned", target: "박진희", targetType: "mention", time: "어제", excerpt: "@박진희 vision backbone에 MoD 적용 가능할 듯" },
  { id: "a7", user: "bak", action: "reacted", target: "Mixture-of-Depths", targetType: "paper", time: "어제", targetId: "p1", emoji: "🔥" },
];

window.COMMENTS = {
  p1: [
    { id: "c1", user: "ha", text: "이거 우리 re-ranker에 적용해보면 어떨까요? @조성민", time: "5분 전" },
    { id: "c2", user: "jo", text: "@하수현 네 그래서 올린거에요 ㅎㅎ 다음 주 세미나에서 발표할 예정", time: "3분 전" },
    { id: "c3", user: "bak", text: "Capacity factor 0.125는 너무 공격적인거 아닌가요? Generation quality 떨어질 듯", time: "1분 전" },
  ],
  p2: [
    { id: "c4", user: "ha", text: "On-device에 적용하려면 latency budget 측정부터 해야할듯 🤔", time: "12분 전" },
  ],
};

window.NAV_SECTIONS = [
  {
    label: "워크스페이스",
    items: [
      { id: "dashboard", icon: "home", label: "홈" },
      { id: "library", icon: "book", label: "논문", count: 87 },
      { id: "presentations", icon: "play", label: "발표 자료", count: 14 },
      { id: "schedule", icon: "calendar", label: "스케쥴" },
      { id: "team", icon: "users", label: "팀 관리" },
      { id: "meeting", icon: "video", label: "세미나 라이브", live: true },
    ],
  },
  {
    label: "채팅",
    items: [
      { id: "lounge", icon: "hash", label: "세미나", unread: 3 },
    ],
  },
];

window.SEARCH_RESULTS = [
  {
    kind: "논문",
    title: "Mixture-of-Depths: Dynamically allocating compute in transformer-based language models",
    snippet: "Token-level conditional compute의 효과 — perplexity-FLOPs 트레이드오프...",
    targetId: "p1",
    targetType: "paper",
  },
  {
    kind: "발표",
    title: "주간 세미나 — Mixture-of-Depths 리뷰",
    snippet: "조성민이 정리한 MoD의 라우팅 메커니즘과 우리 RAG 평가 파이프라인에서의 활용...",
    targetId: "pres1",
    targetType: "pres",
  },
  {
    kind: "아이디어",
    title: "MoD 기반 efficient RAG re-ranker",
    snippet: "Mixture-of-Depths를 우리 RAG 시스템의 re-ranking 단계에 적용. Latency 50% 절감...",
    targetId: "i1",
    targetType: "idea",
  },
  {
    kind: "코멘트",
    title: "@하수현 — Mixture-of-Depths",
    snippet: "이거 우리 re-ranker에 적용해보면 어떨까요? @조성민",
    targetId: "p1",
    targetType: "paper",
  },
];

// helper
window.findUser = (id) => window.TEAM.find(u => u.id === id);
window.findPaper = (id) => window.PAPERS.find(p => p.id === id);
window.findPres = (id) => window.PRESENTATIONS.find(p => p.id === id);
window.findIdea = (id) => window.IDEAS.find(i => i.id === id);

// ============================================
// Paper deep-analysis (연구 / 재구현 lens)
// ============================================
window.ANALYSIS = {
  p1: {
    research: {
      problem: {
        oneLine: "Transformer는 토큰마다 같은 연산을 쓰지만, 모든 토큰이 같은 계산을 필요로 하지는 않는다.",
        setting: "Decoder-only 자기회귀 언어모델. 시퀀스 길이 L에 대해 FLOPs가 선형으로 늘어나며, 모든 토큰이 모든 레이어에서 self-attention + MLP를 통과한다. 고정된 컴퓨트 예산 안에서 '어려운 토큰에 더 많은 연산'을 배분하는 것이 목표.",
        assumptions: [
          "정적(static) 계산 그래프를 유지해야 함 — 하드웨어/컴파일러 친화적",
          "토큰별 연산량은 학습 가능한 router가 결정",
          "전체 capacity(통과 토큰 비율)는 사전에 고정",
        ],
      },
      contributions: [
        "각 transformer 블록 앞에 경량 router를 두고 top-k 토큰만 attention+MLP를 통과시키는 Mixture-of-Depths(MoD) 제안",
        "Capacity를 고정 비율로 제한해 tensor shape을 정적으로 유지 — 컴파일 친화적이며 배치 처리에 유리",
        "MoE와 결합한 MoDE 변형 제시 (depth + expert 동시 sparse)",
        "동일 FLOPs에서 baseline 대비 낮은 perplexity, 추론 step당 최대 50% 속도 향상",
      ],
      io: {
        inputs: [
          { name: "토큰 시퀀스 x", type: "int[L]", desc: "길이 L의 토큰 ID 시퀀스" },
          { name: "히든 상태 h", type: "float[L×d]", desc: "각 블록 입력 임베딩" },
        ],
        outputs: [
          { name: "다음 토큰 분포", type: "float[L×V]", desc: "vocabulary V에 대한 logits" },
          { name: "router mask", type: "bool[L]", desc: "블록별 통과 토큰 선택 (중간 산출물)" },
        ],
      },
      comparison: {
        caption: "동일 학습 FLOPs 예산에서의 비교 (논문 Table 1 기반 · AI 추출)",
        columns: ["방법", "PPL ↓", "상대 FLOPs", "step 속도", "비고"],
        rows: [
          { cells: ["Vanilla Transformer", "기준", "1.00×", "1.00×", "baseline"], highlight: false },
          { cells: ["MoD (capacity 0.5)", "−0.6%", "1.00×", "1.18×", "보수적"], highlight: false },
          { cells: ["MoD (capacity 0.25)", "−1.5%", "1.00×", "1.50×", "권장"], highlight: true },
          { cells: ["MoDE (MoD+MoE)", "−2.1%", "1.00×", "1.42×", "expert 결합"], highlight: false },
        ],
      },
      ablation: {
        caption: "주요 ablation — 설계 선택별 영향 (AI 추출)",
        columns: ["설정", "변형", "PPL 변화", "관찰"],
        rows: [
          { cells: ["라우팅 주기", "매 블록", "−1.5%", "가장 효과적"], highlight: false },
          { cells: ["라우팅 주기", "한 블록 건너", "−1.1%", "FLOPs 추가 절감"], highlight: false },
          { cells: ["Router", "학습형 top-k", "기준", "STE로 학습"], highlight: true },
          { cells: ["Router", "랜덤 선택", "+3.2%", "학습형이 필수적"], highlight: false },
          { cells: ["Capacity", "0.125", "+0.4%", "너무 공격적"], highlight: false },
        ],
      },
      figures: [
        { id: "f1", title: "Figure 1 — Routing 개요", caption: "각 블록에서 router가 top-k 토큰을 선택, 나머지는 residual로 skip.", interpretation: "핵심 다이어그램. 선택된 토큰만 attention+MLP를 통과하고 나머지는 그대로 다음 레이어로 전달되어 연산이 절감됨을 보여준다." },
        { id: "f2", title: "Figure 3 — PPL vs FLOPs", caption: "동일 perplexity 도달까지 필요한 FLOPs 비교.", interpretation: "MoD 곡선이 baseline 아래에 위치 — 같은 성능을 더 적은 연산으로 달성. capacity 0.25에서 가장 좋은 트레이드오프." },
        { id: "f3", title: "Figure 5 — Capacity sweep", caption: "capacity factor에 따른 성능/속도 곡선.", interpretation: "0.25 부근에서 속도-성능 균형 최적. 0.125 이하로 내리면 품질 급락." },
      ],
    },
    repro: {
      data: {
        caption: "사전학습 데이터 (논문 기반 추정 · AI)",
        columns: ["데이터셋", "규모", "토크나이저", "용도"],
        rows: [
          { cells: ["영문 웹 코퍼스", "~200B tokens", "SentencePiece 32k", "사전학습"], highlight: false },
          { cells: ["held-out split", "~1B tokens", "동일", "PPL 평가"], highlight: false },
        ],
      },
      model: {
        params: "여러 스케일 (예: 220M / 1B)",
        items: [
          { name: "구조", desc: "Decoder-only Transformer, RoPE 위치 임베딩" },
          { name: "Router", desc: "블록당 linear → scalar, top-k 선택 (capacity c)" },
          { name: "Skip path", desc: "비선택 토큰은 residual로 그대로 통과" },
          { name: "정밀도", desc: "bf16 mixed precision" },
        ],
      },
      loss: [
        { name: "Next-token CE", expr: "ℒ = −Σ log p(xₜ | x₍₍<t₎₎)", desc: "표준 자기회귀 교차엔트로피" },
        { name: "Aux loss", expr: "없음", desc: "router는 STE(straight-through)로 학습, 별도 balancing loss 불필요" },
      ],
      metrics: [
        { name: "Perplexity (PPL)", desc: "held-out 코퍼스 — 주 지표" },
        { name: "FLOPs / token", desc: "연산 효율" },
        { name: "Throughput", desc: "step당 처리 속도 (tokens/s)" },
      ],
      training: {
        caption: "하이퍼파라미터 스펙 시트 (AI 추출 · 추정 포함)",
        rows: [
          ["Optimizer", "AdamW (β₁=0.9, β₂=0.95)"],
          ["Learning rate", "3e-4 (cosine decay)"],
          ["Warmup", "2,000 steps"],
          ["Batch size", "~0.5M tokens"],
          ["Weight decay", "0.1"],
          ["Grad clip", "1.0"],
          ["Sequence length", "2,048"],
          ["Precision", "bf16"],
          ["Capacity factor", "0.25 (권장)"],
        ],
      },
      testing: [
        "Held-out PPL 측정 + iso-FLOP 곡선 비교",
        "추론 throughput 벤치마크 (batch size 변화)",
        "capacity factor sweep으로 품질-속도 트레이드오프 확인",
      ],
      gpu: {
        hardware: "A100 80GB",
        count: 16,
        vramGb: 80,
        vramUsedGb: 58,
        trainDays: 3,
        note: "원 논문은 TPU 환경. GPU 환산은 1B 스케일 기준 추정치이며 실제 자원은 모델 크기·배치에 따라 달라짐.",
      },
    },
  },
  p2: {
    research: {
      problem: {
        oneLine: "Reference resolution(대명사·지시어 해소)을 별도 파이프라인 없이 언어모델 생성 문제로 푼다.",
        setting: "온디바이스 어시스턴트 환경. 화면 위 entity, 대화 컨텍스트, 백그라운드 entity를 모두 토큰으로 직렬화해 작은 LM이 직접 해소.",
        assumptions: ["화면 entity는 좌표 기반 텍스트로 인코딩 가능", "소형 모델(80M~1B)로 온디바이스 추론"],
      },
      contributions: [
        "Reference resolution을 language modeling으로 재정의",
        "화면 entity의 좌표 기반 직렬화 기법",
        "80M 소형 모델이 특정 태스크에서 GPT-3.5 능가",
      ],
      io: {
        inputs: [{ name: "대화 + 화면 entity", type: "text", desc: "직렬화된 컨텍스트" }],
        outputs: [{ name: "해소된 reference", type: "text", desc: "지시 대상 entity" }],
      },
      comparison: {
        caption: "모델 크기별 성능 (AI 추출)",
        columns: ["모델", "Screen", "Conversational", "비고"],
        rows: [
          { cells: ["GPT-4", "높음", "높음", "기준"], highlight: false },
          { cells: ["ReALM-250M", "동등", "동등 이상", "온디바이스"], highlight: true },
          { cells: ["ReALM-80M", "근접", "양호", "최경량"], highlight: false },
        ],
      },
      ablation: null,
      figures: [
        { id: "f1", title: "Figure 1 — Entity 직렬화", caption: "화면 entity → 좌표 텍스트 변환.", interpretation: "비전 입력 없이 텍스트만으로 화면 맥락을 인코딩하는 핵심 아이디어." },
      ],
    },
    repro: {
      data: {
        caption: "데이터 (AI 추출)",
        columns: ["데이터셋", "유형", "용도"],
        rows: [
          { cells: ["합성 reference 데이터", "screen/conv/background", "학습"], highlight: false },
        ],
      },
      model: { params: "80M / 250M / 1B", items: [{ name: "베이스", desc: "소형 디코더 LM fine-tune" }] },
      loss: [{ name: "Next-token CE", expr: "표준", desc: "생성 기반 fine-tuning" }],
      metrics: [{ name: "Accuracy", desc: "reference 해소 정확도 (카테고리별)" }],
      training: { caption: "하이퍼파라미터 (추정)", rows: [["Optimizer", "AdamW"], ["LR", "5e-5"], ["Precision", "fp16"]] },
      testing: ["카테고리별(Screen/Conv/Background) 정확도 측정"],
      gpu: { hardware: "A100 40GB", count: 4, vramGb: 40, vramUsedGb: 22, trainDays: 1, note: "소형 모델 — 자원 요구량 낮음. 추정치." },
    },
  },
  p3: {
    research: {
      problem: {
        oneLine: "자기회귀 next-token 예측과 full-sequence diffusion을 토큰별 노이즈 레벨로 통합한다.",
        setting: "시퀀스 생성(비디오·플래닝). 각 토큰에 독립적인 시간 t로 노이즈를 부여해 학습.",
        assumptions: ["토큰마다 다른 노이즈 레벨 적용 가능", "causal masking과 diffusion loss 결합"],
      },
      contributions: [
        "Per-token noise level — AR과 diffusion의 통합 프레임워크",
        "가변 horizon rolling generation 지원",
        "긴 롤아웃에서 안정적 생성",
      ],
      io: {
        inputs: [{ name: "노이즈 시퀀스", type: "float[L×d]", desc: "토큰별 t로 손상된 입력" }],
        outputs: [{ name: "디노이즈 시퀀스", type: "float[L×d]", desc: "복원된 토큰" }],
      },
      comparison: {
        caption: "생성 안정성 비교 (AI 추출)",
        columns: ["방법", "Long-rollout", "Planning", "비고"],
        rows: [
          { cells: ["AR baseline", "불안정", "—", "기준"], highlight: false },
          { cells: ["Full diffusion", "안정", "느림", "—"], highlight: false },
          { cells: ["Diffusion Forcing", "안정", "효율적", "제안"], highlight: true },
        ],
      },
      ablation: null,
      figures: [
        { id: "f1", title: "Figure 2 — Per-token noise", caption: "토큰마다 다른 노이즈 레벨.", interpretation: "AR(완전 관측)과 diffusion(완전 노이즈)을 양 극단으로 두는 통합 관점." },
      ],
    },
    repro: {
      data: {
        caption: "데이터 (AI 추출)",
        columns: ["도메인", "데이터셋", "용도"],
        rows: [
          { cells: ["비디오", "도메인별 비디오셋", "생성"], highlight: false },
          { cells: ["플래닝", "maze/control", "의사결정"], highlight: false },
        ],
      },
      model: { params: "도메인별 상이", items: [{ name: "백본", desc: "causal transformer + diffusion head" }] },
      loss: [{ name: "Diffusion loss", expr: "ℒ = 𝔼‖ε − ε_θ‖²", desc: "토큰별 노이즈 예측" }],
      metrics: [{ name: "FVD / 성공률", desc: "비디오 품질 / 플래닝 성공률" }],
      training: { caption: "하이퍼파라미터 (추정)", rows: [["Optimizer", "AdamW"], ["LR", "1e-4"], ["Noise schedule", "cosine"]] },
      testing: ["Long-horizon rollout 안정성 / planning 성공률"],
      gpu: { hardware: "A100 80GB", count: 8, vramGb: 80, vramUsedGb: 48, trainDays: 4, note: "비디오 도메인 기준 추정치." },
    },
  },
  p4: {
    research: {
      problem: {
        oneLine: "웹 지식으로 학습한 VLM을 로봇 제어로 직접 전이한다(VLA).",
        setting: "로봇 매니퓰레이션. action을 텍스트 토큰으로 인코딩해 일반 VLM을 그대로 fine-tune.",
        assumptions: ["action discretization → text token 가능", "웹 데이터와 로봇 시연 co-training"],
      },
      contributions: [
        "Action을 텍스트 토큰으로 코딩하는 VLA 정식화",
        "웹+로봇 co-training으로 일반화 향상",
        "Chain-of-thought 추론 기반 제어",
      ],
      io: {
        inputs: [{ name: "이미지 + 명령", type: "image+text", desc: "관측과 자연어 지시" }],
        outputs: [{ name: "action token", type: "text", desc: "이산화된 로봇 행동" }],
      },
      comparison: {
        caption: "일반화 성능 (AI 추출)",
        columns: ["방법", "Unseen object", "Semantic", "비고"],
        rows: [
          { cells: ["기존 imitation", "낮음", "제한적", "기준"], highlight: false },
          { cells: ["RT-2", "+63%", "가능", "제안"], highlight: true },
        ],
      },
      ablation: null,
      figures: [
        { id: "f1", title: "Figure 1 — VLA 개요", caption: "VLM이 이미지+명령 → action token.", interpretation: "별도 정책망 없이 VLM 한 모델로 인식·추론·제어를 통합." },
      ],
    },
    repro: {
      data: {
        caption: "데이터 (AI 추출)",
        columns: ["소스", "유형", "용도"],
        rows: [
          { cells: ["웹 VQA", "image-text", "사전지식"], highlight: false },
          { cells: ["로봇 시연", "trajectory", "제어 fine-tune"], highlight: false },
        ],
      },
      model: { params: "대형 VLM (수~수십 B)", items: [{ name: "베이스", desc: "PaLI-X / PaLM-E 계열 VLM" }] },
      loss: [{ name: "Token CE", expr: "표준", desc: "action token 포함 생성 손실" }],
      metrics: [{ name: "성공률", desc: "실제/시뮬 매니퓰레이션 성공률" }],
      training: { caption: "하이퍼파라미터 (추정)", rows: [["Optimizer", "AdamW"], ["LR", "1e-4"], ["Co-train ratio", "web:robot 조정"]] },
      testing: ["Unseen object 일반화 / semantic reasoning 평가"],
      gpu: { hardware: "TPU v4 / A100", count: 64, vramGb: 80, vramUsedGb: 70, trainDays: 7, note: "대형 VLM — 자원 요구량 매우 큼. 추정치." },
    },
  },
};
window.findAnalysis = (id) => window.ANALYSIS[id] || window.ANALYSIS.p1;

// ============================================
// Presentation assets / history / comments
// ============================================
window.PRES_EXTRA = {
  pres1: {
    assets: [
      { name: "MoD-주간세미나.pptx", type: "ppt", size: "4.2MB" },
      { name: "MoD-주간세미나.pdf", type: "pdf", size: "2.1MB" },
      { name: "발표노트.md", type: "note", size: "12KB" },
    ],
    history: [
      { ver: "v3", date: "오늘 15:40", by: "jo", note: "Q&A 슬라이드 추가, Next steps 업데이트" },
      { ver: "v2", date: "어제 22:10", by: "jo", note: "Result 그래프 교체, 오타 수정" },
      { ver: "v1", date: "2일 전 18:00", by: "jo", note: "초안 업로드" },
    ],
  },
  pres2: {
    assets: [
      { name: "DiffusionForcing.pdf", type: "pdf", size: "3.0MB" },
    ],
    history: [
      { ver: "v2", date: "어제", by: "bak", note: "안정성 실험 결과 반영" },
      { ver: "v1", date: "3일 전", by: "bak", note: "초안" },
    ],
  },
  pres3: {
    assets: [
      { name: "Q2-로드맵.pptx", type: "ppt", size: "6.4MB" },
      { name: "Q2-로드맵.pdf", type: "pdf", size: "3.3MB" },
    ],
    history: [
      { ver: "v1", date: "5월 12일", by: "ha", note: "로드맵 초안 공유" },
    ],
  },
};
window.PRES_COMMENTS = {
  pres1: [
    { id: "pc1", user: "ha", text: "Result 2 그래프에서 batch size 영향 부분 한 장 더 있으면 좋겠어요 @조성민", time: "1시간 전", slide: 7 },
    { id: "pc2", user: "jo", text: "@하수현 v3에 추가했어요! 7번 슬라이드 확인 부탁", time: "40분 전", slide: 7 },
    { id: "pc3", user: "paeng", text: "MoDE 부분 우리 RL 정책망에도 적용 가능할지 궁금하네요", time: "30분 전", slide: 8 },
  ],
  pres2: [
    { id: "pc4", user: "ha", text: "long-rollout 데모 영상 링크도 첨부해주세요 🙏", time: "어제", slide: null },
  ],
  pres3: [],
};

// ============================================
// 라운지 — 단일 팀 채팅
// ============================================
window.LOUNGE = [
  { user: "paeng", text: "다들 점심 ㄱㄱ? 🍚", time: "11:58" },
  { user: "bak", text: "저는 실험 돌려놓고 갈게요", time: "12:01" },
  { user: "jo", text: "이번 주 토요일 10시 세미나 자료 v3로 올려놨어요. 미리 보고 오면 좋을 듯", time: "13:20" },
  { user: "ha", text: "확인했어요 👍 Q&A 슬라이드 좋네요", time: "13:25" },
  { user: "paeng", text: "MoDE 부분 질문 준비해갈게요", time: "13:31" },
];

// ============================================
// 세미나 스케줄 — 토요일 10:00, 주차별 로테이션
// ============================================
// 세미나 일정 — 매달 새로 편성
window.SCHEDULE = {
  day: "토요일",
  month: 6, // 현재 편성된 달
  year: 2026,
  weeks: [
    { week: 1, date: "6월 7일", time: "10:00", presenter: "jo", topic: "Mixture-of-Depths 리뷰", status: "done", presId: "pres1" },
    { week: 2, date: "6월 14일", time: "10:00", presenter: "bak", topic: "Diffusion Forcing", status: "upcoming", presId: "pres2" },
    { week: 3, date: "6월 21일", time: "10:00", presenter: "paeng", topic: "RT-2 / VLA 정리", status: "upcoming", presId: null },
    { week: 4, date: "6월 28일", time: "10:00", presenter: "ha", topic: "Q2 로드맵 점검", status: "upcoming", presId: "pres3" },
  ],
};
// 멤버 가용 상태 기본값 (active | vacation)
window.AVAILABILITY = { ha: "active", bak: "active", jo: "active", paeng: "active" };

// 연도별 세미나 현황 — 참여 횟수 / 불참 / 납부
// 벌금: 발표자 불참 finePresenter, 일반 불참 fineAbsent
window.SEMINAR_STATS = {
  year: 2026,
  finePresenter: 30000, // 발표 차례인데 불참
  fineAbsent: 10000,    // 일반 참석 불참
  members: {
    ha:    { count: 6, missedPresenter: 0, missedAbsent: 1, paid: 10000 },
    bak:   { count: 5, missedPresenter: 0, missedAbsent: 0, paid: 0 },
    jo:    { count: 7, missedPresenter: 1, missedAbsent: 1, paid: 30000 },
    paeng: { count: 4, missedPresenter: 0, missedAbsent: 1, paid: 0 },
  },
};
