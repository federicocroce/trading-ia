export type RiskFactor =
  | 'oil' | 'gas' | 'argentina' | 'emerging-markets' | 'crypto' | 'semis'
  | 'gold' | 'safe-haven' | 'rates' | 'us-equity' | 'china' | 'risk-on';

export const ALL_RISK_FACTORS: RiskFactor[] = [
  'oil', 'gas', 'argentina', 'emerging-markets', 'crypto', 'semis',
  'gold', 'safe-haven', 'rates', 'us-equity', 'china', 'risk-on',
];

/** Hedge factors — what protects when risk-on falls. */
export const HEDGE_FACTORS: RiskFactor[] = ['safe-haven', 'rates', 'gold'];

/** Per-scan portfolio snapshot, computed once and shared across candidates. */
export interface PortfolioContext {
  /** Value-weighted factor concentration of current holdings. factor → 0..1 */
  factorWeights: Partial<Record<RiskFactor, number>>;
  /** Holdings grouped by factor for explanations. factor → symbols */
  factorSymbols: Partial<Record<RiskFactor, string[]>>;
  /** symbol → daily return series (most recent last), for correlation. */
  returns: Record<string, number[]>;
  /** Total portfolio value; 0 means empty portfolio. */
  totalValue: number;
}

export interface PortfolioConcentration {
  factor: RiskFactor;
  portfolioWeight: number;  // 0..1
  avgCorrelation: number;   // candidate vs holdings in that factor; NaN if unknown
}

export interface PortfolioAdjustment {
  delta: number;        // applied to composite (rawDelta × intensity)
  rawDelta: number;     // before intensity scaling
  intensity: number;    // 0..1 dial
  concentration: PortfolioConcentration[];
  verdict: 'stacks' | 'diversifies' | 'neutral';
  reason: string;
}

export interface MissingHedge {
  hedge: RiskFactor;
  reason: string;
  candidates: string[];
}

export interface PortfolioDiagnostic {
  factorExposure: Array<{ factor: RiskFactor; weight: number; symbols: string[] }>;
  concentrationFlags: string[];
  missingHedges: MissingHedge[];
  diversifiers: string[];
  stackers: string[];
}
