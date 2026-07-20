export type InstrumentType = 'accion' | 'cedear' | 'etf' | 'crypto' | 'bono' | 'commodity';

export interface AssetClassification {
  instrumentType: InstrumentType;
  sector: string;       // "Defensa", "Semiconductores", "Petróleo", "Fintech", etc.
  industry: string;     // Yahoo raw: "Aerospace & Defense", "Semiconductors", etc.
  market: 'argentina' | 'us' | 'global';
  exchange?: string;    // "NYSE", "NASDAQ", "BYMA"
  name: string;         // "Lockheed Martin Corporation"
}

export interface DiscoveredTickerInfo {
  symbol: string;
  classification: AssetClassification;
  discoveredFrom: 'finnhub' | 'yahoo' | 'llm' | 'screener' | 'radar' | 'base_sweep';
  newsCount: number;
  relevanceScore: number;
  firstSeen: string;
  lastSeen: string;
  expiresAt: string;
  active: boolean;
}
