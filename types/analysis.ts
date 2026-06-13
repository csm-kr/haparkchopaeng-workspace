// Analysis.payload(Json)의 구조. DB.md: 연구(problem/contributions/io/comparison/ablation) ·
// 재구현(data/model/loss/metrics/training/gpu). 값이 아니라 모양만 src/data.js의 window.ANALYSIS 참고.
import type { Lens } from "./enums";

/** 표 형식 분석 블록 (comparison/ablation/data 등 공통) */
export interface TableRow {
  cells: string[];
  highlight: boolean;
}

export interface TableBlock {
  caption: string;
  columns: string[];
  rows: TableRow[];
}

/** Input/Output 항목 */
export interface IOItem {
  name: string;
  type: string;
  desc: string;
}

/** name/desc 쌍 (model items, metrics 등) */
export interface NamedItem {
  name: string;
  desc: string;
}

// --- 연구 관점 (research) ---

export interface ProblemSetting {
  oneLine: string;
  setting: string;
  assumptions: string[];
}

export interface IOSpec {
  inputs: IOItem[];
  outputs: IOItem[];
}

export interface ResearchPayload {
  problem: ProblemSetting;
  contributions: string[];
  io: IOSpec;
  comparison: TableBlock;
  ablation: TableBlock;
}

// --- 재구현 관점 (repro) ---

export interface ModelSpec {
  params: string;
  items: NamedItem[];
}

export interface LossItem {
  name: string;
  expr: string;
  desc: string;
}

/** 학습 하이퍼파라미터 스펙 시트 — rows는 [키, 값] 쌍 목록 */
export interface TrainingSpec {
  caption: string;
  rows: string[][];
}

export interface GpuSpec {
  hardware: string;
  count: number;
  vramGb: number;
  vramUsedGb: number;
  trainDays: number;
  note: string;
}

export interface ReproPayload {
  data: TableBlock;
  model: ModelSpec;
  loss: LossItem[];
  metrics: NamedItem[];
  training: TrainingSpec;
  gpu: GpuSpec;
}

/** lens → payload 매핑 (Analysis 엔티티에서 사용) */
export interface AnalysisPayloadMap {
  research: ResearchPayload;
  repro: ReproPayload;
}

/** 어느 관점이든 받는 분석 페이로드 */
export type AnalysisPayload = AnalysisPayloadMap[Lens];
