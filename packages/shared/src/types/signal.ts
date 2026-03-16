import type { TASignal } from './technical.js';
import type { FASignal } from './fundamental.js';
import type { SentimentType } from './news.js';

export type SignalAction = 'BUY' | 'SELL' | 'HOLD' | 'WATCH';

export interface Signal {
  symbol: string;
  action: SignalAction;
  confidence: number;
  reason: string;
  timestamp: number;
}

export interface AnalysisBreakdown {
  technical: {
    signal: TASignal;
    score: number;
    keyFactors: string[];
  };
  fundamental: {
    signal: FASignal;
    score: number;
    keyFactors: string[];
  };
  sentiment: {
    signal: SentimentType;
    score: number;
    keyFactors: string[];
  };
}

export interface IntegratedSignal {
  symbol: string;
  action: SignalAction;
  confidence: number;
  reasoning: string;
  breakdown: AnalysisBreakdown;
  timestamp: number;
}
