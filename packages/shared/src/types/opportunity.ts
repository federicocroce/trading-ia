import type { AnalysisBreakdown, SignalAction } from './signal.js';
import type { AssetClassification } from './discovery.js';

export type OpportunitySector =
  | 'argentina-energy'
  | 'argentina-finance'
  | 'argentina-cedears'
  | 'us-energy'
  | 'us-tech'
  | 'crypto'
  | 'bonds'
  | 'etfs-sectors'
  | 'commodities'
  | 'emerging-markets';

export interface ConfluenceDetail {
  bullishSignals: string[];
  bearishSignals: string[];
  neutralSignals: string[];
  confluencePercent: number;
  direction: 'bullish' | 'bearish' | 'mixed';
}

export interface ReturnEstimate {
  lowPercent: number;
  midPercent: number;
  highPercent: number;
  confidence: number;
  keyDrivers: string[];
}

export interface ActionCondition {
  holdUntil: string;              // "Hasta que las divergencias diarias se resuelvan (~3 días)"
  reEvaluateAt?: number;          // precio donde re-evaluar (soporte)
  reEvaluateReason?: string;      // "Si corrige a $65 (soporte), re-evaluar como BUY"
  exitAt: number;                 // precio de salida (stop)
  exitReason: string;             // "Si rompe $53.78 → SELL inmediato"
  estimatedDays?: number;         // días estimados para resolución
}

export interface TradeLevels {
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  riskRewardRatio: number;
  entryReason: string;
  stopReason: string;
  targetReason: string;
  suggestedQuantity?: number;
  suggestedAmount?: number;
  sizingReason?: string;
}

export interface SignalConflict {
  signalA: string;
  signalB: string;
  directionA: 'bullish' | 'bearish';
  directionB: 'bullish' | 'bearish';
  explanation: string;
  implication: 'wait' | 'caution' | 'confirm';
}

export interface TimingView {
  action: 'BUY' | 'SELL' | 'WAIT';
  timing: 'now' | 'soon' | 'approaching';
  confidence: number;
  triggers: {
    type: string;
    description: string;
    /** Dirección explícita de la señal — NO derivar del texto de description. */
    direction: 'bullish' | 'bearish' | 'neutral';
    estimatedDays: number | null;
    impact: 'high' | 'medium';
  }[];
}

export interface Opportunity {
  symbol: string;
  sector: OpportunitySector;
  sectorLabel: string;
  currentPrice: number;
  opportunityScore: number;
  action: SignalAction; // BUY, SELL, HOLD, WATCH — señal compuesta
  technicalAction: SignalAction; // solo análisis técnico
  fundamentalAction: SignalAction; // solo análisis fundamental
  sentimentAction: SignalAction; // solo sentimiento/noticias
  confidence: number;
  shortTerm: ReturnEstimate;
  mediumTerm: ReturnEstimate;
  reasoning: string;
  simpleReasoning?: string;
  catalysts: string[];
  risks: string[];
  breakdown: AnalysisBreakdown;
  inPortfolio: boolean;
  portfolioQuantity?: number;
  timestamp: number;
  scoringMethod?: 'hybrid' | 'ai-full' | 'algorithmic';
  horizonScores?: { shortTerm: number; mediumTerm: number };
  passedAntiHype?: boolean;
  confluenceDetail?: ConfluenceDetail;
  tradeLevels?: TradeLevels;
  /** Stop dinámico (trailing chandelier) — calculado una vez en el scan, leído por la vista "Hoy". */
  trailingStop?: number | null;
  timingView?: TimingView;
  signalConflicts?: SignalConflict[];
  entryScore?: number;
  narrativeDigest?: string;
  actionCondition?: ActionCondition;
  classification?: AssetClassification;
  divergences?: import('./technical.js').DivergenceSignal[];
  weekly?: import('./technical.js').WeeklyAnalysis;
  deepAnalysis?: DeepAnalysis;
  convictionTier?: ConvictionTier;
  unifiedAnalysis?: UnifiedAssetAnalysis;
  radarInfluence?: {
    bonus: number;        // sentiment score bonus applied (-25..+25)
    sources: string[];    // e.g. ["ticker:TLT=+1.5", "sector:bonos_largos=+1.2"]
    conflict?: string;    // base sentiment vs radar disagreement note
  };
  /** Evidencia empírica (PEAD, insider, options flow, sector momentum). 4to eje del composite. */
  evidenceInfluence?: {
    score: number;        // -100..+100 (alineado con escala tech/fund)
    drivers: string[];    // razones humanas: "PEAD activo: beat +14%", "Insider: $4M de 3 buyers"
    conviction: 'high' | 'medium' | 'low' | 'none';
    activeSignals: number; // 0..3
    hasData: boolean;     // true si hay cache vigente, false si símbolo no fue escaneado
  };
  /** Cadena de decisión trazable: por qué este símbolo terminó con esta acción final. */
  verdict?: VerdictChain;
  /** Si algún eje gatilló un veto que cambió la acción (sent muy negativo, fund muy débil, etc). */
  axisVeto?: AxisVeto;
  /** Ajuste macro aplicado al composite (causalChains → -15..+15). */
  macroAdjustment?: MacroAdjustment;
  /** Conflictos entre dimensiones (no solo intra-técnico). */
  crossConflicts?: CrossConflict[];
  /** Cómo se relaciona el candidato con la cartera actual (correlación/concentración). */
  portfolioAdjustment?: import('./portfolio-risk.js').PortfolioAdjustment;
}

export interface VerdictChain {
  /** Acción final mostrada al usuario tras todas las capas. */
  finalAction: SignalAction;
  /** Cada capa de decisión con su resultado. */
  layers: {
    algoAction: SignalAction;            // basada en composite + score, antes de overrides
    algoScore: number;                   // composite numérico
    smartAction: SignalAction;           // post smartAction (divergencias / niveles)
    smartReason?: string;                // explicación del override smart si difiere de algo
    llmAction?: SignalAction;            // resultado del LLM Stage 5b si aplica
    llmReason?: string;                  // thesis breve del LLM
  };
  /** Trazabilidad textual: ["algo:BUY(72)", "smart:WATCH (div bajista RSI diario)", "llm:BUY"] */
  trace: string[];
  /** Quién mandó al final: 'algo' | 'smart' | 'llm'. */
  source: 'algo' | 'smart' | 'llm';
}

export type AxisVetoType =
  | 'sentiment-extreme-negative'
  | 'fundamental-weak-with-tech-flat'
  | 'evidence-bearish-with-bull-bias'
  | 'technical-extreme-bearish';

export interface AxisVeto {
  type: AxisVetoType;
  axis: 'sentiment' | 'fundamental' | 'technical' | 'evidence';
  value: number;        // score actual del eje vetante
  threshold: number;    // umbral cruzado
  forcedAction: SignalAction;  // acción que el veto fuerza (típicamente WATCH o SELL)
  reason: string;       // explicación humana
}

export interface MacroAdjustment {
  delta: number;        // -15..+15 puntos sumados al composite
  drivers: Array<{
    eventId: string;
    event: string;
    category: string;
    direction: 'positive' | 'negative';
    impact: 'direct' | 'indirect';
  }>;
}

export type CrossConflictType =
  | 'tech-bull-vs-fund-weak'    // value trap warning
  | 'tech-bull-vs-sent-bear'    // hype sin confirmación / divergencia narrativa
  | 'fund-strong-vs-tech-bear'  // possible bottom fishing
  | 'evidence-bull-vs-tech-bear' // smart money entering antes que tape
  | 'sent-bull-vs-tech-bear';    // FOMO sin precio

export interface CrossConflict {
  type: CrossConflictType;
  severity: 'high' | 'medium' | 'low';
  axes: Array<'technical' | 'fundamental' | 'sentiment' | 'evidence'>;
  explanation: string;
  suggestion: string;
}

export type ConvictionTier = 'strong' | 'standard' | 'speculative';

export interface DeepAnalysis {
  positives: string[];
  concerns: string[];
  recommendation: string;
  wouldDo: string[];
  wouldNotDo: string[];
  generatedBy: 'deepseek' | 'groq' | 'qwen' | 'algorithmic';
}

export interface UnifiedAssetAnalysis {
  action: 'BUY' | 'SELL' | 'HOLD' | 'WATCH';
  thesis: string;                // 2-3 oraciones con datos concretos
  catalysts: string[];           // 2-3 items
  risks: string[];               // 1-2 items
  wouldDo: string[];             // 1-2 acciones con precio
  wouldNotDo: string[];          // 1 acción a evitar
  narrative: string;             // 2-3 oraciones para UI (reemplaza narrativeDigest)
  macroTheme: string | null;     // tema macro asignado (ej: "Semiconductores / IA")
  generatedBy: 'deepseek' | 'groq' | 'qwen' | 'gemini' | 'openrouter';
}

export interface SectorSummary {
  sector: OpportunitySector;
  label: string;
  symbolCount: number;
  avgScore: number;
  topOpportunity: string | null;
  sectorOutlook: string;
}

export type AnalysisEngine = 'lmstudio' | 'groq' | 'openrouter' | 'claude' | 'algorithmic' | 'hybrid';

export type ScanSource = 'live' | 'db';

export interface OpportunityScanResult {
  scannedAt: number;
  totalSymbolsScanned: number;
  opportunities: Opportunity[];
  sectorSummary: SectorSummary[];
  analysisEngine: AnalysisEngine;
  analysisDetail: string;
  source: ScanSource; // 'live' = recién escaneado, 'db' = recuperado de BD
  antiHypeRejected?: Array<{ symbol: string; reasons: string[] }>;  // for audit/persistence
  antiHypeMode?: 'strict' | 'relaxed';
}

export type WeeklyPickTier = 'HIGH' | 'MEDIUM';
export type SectorCategory = 'LEADING' | 'NEUTRAL' | 'LAGGING';

export interface WeeklyPick {
  symbol: string;
  tier: WeeklyPickTier;
  evidence: {
    type: 'PEAD' | 'INSIDER' | 'OPTIONS' | 'PEAD_INSIDER' | 'FUNDAMENTAL';
    detail: string;
  };
  entryLow: number;
  entryHigh: number;
  stop: number;
  target: number;
  rrRatio: number;
  regime: import('./evidence-signals.js').EvidenceMarketRegime;
  sectorCategory: SectorCategory;
  aiVerdict?: import('./evidence-signals.js').DeepVerdict;
  fundamentalScore: number;
  technicalScore: number;
  scanDate: string;
  historicalWinRate: number | null;
}

export interface SectorRotationData {
  etf: string;
  sectorName: string;
  return1m: number;
  return3m: number;
  relativeStrength1m: number;
  relativeStrength3m: number;
  category: SectorCategory;
  updatedAt: string;
}

export interface MacroDashboard {
  regime: import('./evidence-signals.js').MarketRegimeData;
  sectors: SectorRotationData[];
  argentinaSignal: 'STABLE' | 'VOLATILE';
  picks: WeeklyPick[];
}
