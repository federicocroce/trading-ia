import type { AssetClassification, InstrumentType } from '@trading/shared';
import { getAssetProfile } from '../shared/yahoo.js';

// --- Industry → Sector en español ---
const INDUSTRY_TO_SECTOR: Record<string, string> = {
  'Aerospace & Defense': 'Defensa',
  'Semiconductors': 'Semiconductores',
  'Semiconductor Equipment & Materials': 'Semiconductores',
  'Software—Infrastructure': 'Software',
  'Software—Application': 'Software',
  'Internet Content & Information': 'Tech',
  'Internet Retail': 'E-commerce',
  'Consumer Electronics': 'Electrónica',
  'Information Technology Services': 'Tech',
  'Oil & Gas Integrated': 'Petróleo',
  'Oil & Gas E&P': 'Petróleo',
  'Oil & Gas Midstream': 'Gas & Petróleo',
  'Oil & Gas Equipment & Services': 'Servicios Petróleo',
  'Banks—Regional': 'Banca',
  'Banks—Diversified': 'Banca',
  'Capital Markets': 'Finanzas',
  'Financial Data & Stock Exchanges': 'Finanzas',
  'Insurance—Diversified': 'Seguros',
  'Drug Manufacturers—General': 'Farmacéutica',
  'Biotechnology': 'Biotecnología',
  'Medical Devices': 'Salud',
  'Auto Manufacturers': 'Automotriz',
  'Utilities—Regulated Electric': 'Energía Eléctrica',
  'Utilities—Diversified': 'Energía',
  'Telecom Services': 'Telecomunicaciones',
  'REIT—Diversified': 'Real Estate',
  'Gold': 'Oro',
  'Silver': 'Plata',
  'Copper': 'Cobre',
  'Steel': 'Acero',
  'Restaurants': 'Consumo',
  'Specialty Retail': 'Retail',
  'Packaged Foods': 'Alimentos',
  'Beverages—Non-Alcoholic': 'Bebidas',
  'Entertainment': 'Entretenimiento',
  'Electronic Gaming & Multimedia': 'Gaming',
  'Solar': 'Energía Solar',
  'Uranium': 'Energía Nuclear',
};

// --- Yahoo sector → sector fallback en español ---
const SECTOR_TO_SPANISH: Record<string, string> = {
  'Technology': 'Tecnología',
  'Energy': 'Energía',
  'Industrials': 'Industrial',
  'Financial Services': 'Finanzas',
  'Healthcare': 'Salud',
  'Consumer Cyclical': 'Consumo Cíclico',
  'Consumer Defensive': 'Consumo Defensivo',
  'Communication Services': 'Comunicaciones',
  'Basic Materials': 'Materiales',
  'Real Estate': 'Real Estate',
  'Utilities': 'Servicios Públicos',
};

// --- Bonds known symbols ---
const BOND_SYMBOLS = new Set(['TLT', 'HYG', 'EMB', 'AGG', 'BND', 'LQD', 'SHY', 'IEF', 'TIP']);

// --- Commodity symbols ---
const COMMODITY_SYMBOLS = new Set(['GLD', 'SLV', 'USO', 'UNG', 'COPX', 'GDX', 'GDXJ', 'IAU']);

// Cache de clasificaciones
const classificationCache = new Map<string, AssetClassification>();

export function getCachedClassification(symbol: string): AssetClassification | undefined {
  return classificationCache.get(symbol);
}

export function setCachedClassification(symbol: string, classification: AssetClassification): void {
  classificationCache.set(symbol, classification);
}

export async function classifyAsset(symbol: string): Promise<AssetClassification | null> {
  // Check cache first
  const cached = classificationCache.get(symbol);
  if (cached) return cached;

  // Quick classification for known patterns
  if (symbol.includes('-USD')) {
    const classification: AssetClassification = {
      instrumentType: 'crypto',
      sector: 'Crypto',
      industry: 'Cryptocurrency',
      market: 'global',
      name: symbol.replace('-USD', ''),
    };
    classificationCache.set(symbol, classification);
    return classification;
  }

  if (BOND_SYMBOLS.has(symbol)) {
    const classification: AssetClassification = {
      instrumentType: 'bono',
      sector: 'Bonos',
      industry: 'Fixed Income',
      market: 'us',
      name: symbol,
    };
    classificationCache.set(symbol, classification);
    return classification;
  }

  if (COMMODITY_SYMBOLS.has(symbol)) {
    const classification: AssetClassification = {
      instrumentType: 'commodity',
      sector: 'Commodities',
      industry: 'Commodities',
      market: 'global',
      name: symbol,
    };
    classificationCache.set(symbol, classification);
    return classification;
  }

  // Fetch from Yahoo Finance
  try {
    const profile = await getAssetProfile(symbol);
    if (!profile) return null;

    const instrumentType = determineInstrumentType(profile.quoteType, profile.exchange, symbol);
    const market = determineMarket(profile.exchange);
    const sector = determineSector(profile.industry, profile.sector);

    const classification: AssetClassification = {
      instrumentType,
      sector,
      industry: profile.industry ?? profile.sector ?? 'Desconocido',
      market,
      exchange: profile.exchange || undefined,
      name: profile.longName,
    };

    classificationCache.set(symbol, classification);
    return classification;
  } catch (err) {
    console.warn(`[AssetClassifier] Error clasificando ${symbol}:`, err);
    return null;
  }
}

// Exchange codes are standard ISO — independent of user portfolio.
// Changes here require adding a new exchange, which is an infrastructure change.
const ARG_EXCHANGES = ['BUE', 'BCBA', 'BA'] as const;
const US_EXCHANGES = ['NMS', 'NYQ', 'NGM', 'NCM', 'PCX', 'BTS', 'ASE'] as const;

function determineInstrumentType(quoteType: string, exchange: string, symbol: string): InstrumentType {
  if (quoteType === 'ETF' || quoteType === 'MUTUALFUND') return 'etf';
  if (quoteType === 'CRYPTOCURRENCY' || symbol.includes('-USD')) return 'crypto';

  // Argentina exchanges
  if ((ARG_EXCHANGES as readonly string[]).includes(exchange)) return 'cedear';

  return 'accion';
}

function determineMarket(exchange: string): 'argentina' | 'us' | 'global' {
  if ((ARG_EXCHANGES as readonly string[]).includes(exchange)) return 'argentina';
  if ((US_EXCHANGES as readonly string[]).includes(exchange)) return 'us';

  return 'global';
}

function determineSector(industry: string | null, sector: string | null): string {
  // Try industry first (more specific)
  if (industry && INDUSTRY_TO_SECTOR[industry]) {
    return INDUSTRY_TO_SECTOR[industry];
  }

  // Try sector
  if (sector && SECTOR_TO_SPANISH[sector]) {
    return SECTOR_TO_SPANISH[sector];
  }

  // Return Yahoo sector as-is if available
  if (sector) return sector;
  if (industry) return industry;

  return 'Otros';
}

/**
 * Batch classify multiple symbols. Returns only successful classifications.
 */
export async function classifyAssets(symbols: string[]): Promise<Map<string, AssetClassification>> {
  const results = new Map<string, AssetClassification>();
  const toClassify = symbols.filter(s => !classificationCache.has(s));

  // Classify uncached in parallel (batches of 5)
  for (let i = 0; i < toClassify.length; i += 5) {
    const batch = toClassify.slice(i, i + 5);
    const classifications = await Promise.all(batch.map(s => classifyAsset(s)));
    for (let j = 0; j < batch.length; j++) {
      if (classifications[j]) {
        results.set(batch[j], classifications[j]!);
      }
    }
  }

  // Add cached ones
  for (const s of symbols) {
    const cached = classificationCache.get(s);
    if (cached && !results.has(s)) results.set(s, cached);
  }

  return results;
}
