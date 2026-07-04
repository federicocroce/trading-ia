import { getQuote } from '../shared/yahoo.js';

// Common false positives from news text
const BLOCKLIST = new Set([
  'CEO', 'CFO', 'COO', 'CTO', 'IPO', 'ETF', 'NYSE', 'SEC', 'GDP', 'CPI',
  'FBI', 'USA', 'FED', 'ECB', 'IMF', 'NATO', 'OPEC', 'WHO', 'API', 'EIA',
  'DOJ', 'IRS', 'FDA', 'EPA', 'ICE', 'AI', 'VP', 'PM', 'UK', 'EU', 'UN',
  'BUY', 'SELL', 'HOLD', 'NEW', 'TOP', 'ALL', 'FOR', 'THE', 'AND', 'NOT',
  'USD', 'EUR', 'GBP', 'JPY', 'CNY', 'ARS', 'BRL', 'CAD', 'AUD', 'NZD',
  'Q1', 'Q2', 'Q3', 'Q4', 'YTD', 'QOQ', 'YOY', 'PE', 'EPS', 'ROE', 'ROA',
  'ESG', 'DEI', 'HR', 'IT', 'PR', 'IR', 'CEO', 'CIO', 'CMO',
  'BREAKING', 'UPDATE', 'ALERT', 'NEWS', 'REPORT', 'ANALYSIS',
]);

// Tickers reales de 1 letra (NYSE) — whitelist fail-closed: cualquier otra letra suelta es ruido de texto. Vigente a 2026-07; la validación Yahoo aguas abajo cubre delistings.
const SINGLE_LETTER_TICKERS = new Set([
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M',
  'O', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Z',
]);

// Cache of validated / rejected tickers
const validatedCache = new Map<string, boolean>();

export function isValidTickerFormat(symbol: string): boolean {
  if (!symbol || symbol.length > 10) return false;
  if (!/^[A-Z0-9.-]+$/.test(symbol)) return false;
  // 1 letra: solo tickers reales conocidos — el resto se rechaza (fail-closed)
  if (symbol.length === 1) return SINGLE_LETTER_TICKERS.has(symbol);
  if (BLOCKLIST.has(symbol)) return false;
  // Solo números
  if (/^\d+$/.test(symbol)) return false;
  return true;
}

export async function validateTicker(symbol: string): Promise<boolean> {
  // Check cache
  const cached = validatedCache.get(symbol);
  if (cached !== undefined) return cached;

  // Format check
  if (!isValidTickerFormat(symbol)) {
    validatedCache.set(symbol, false);
    return false;
  }

  // Verify with Yahoo quote
  try {
    const quote = await getQuote(symbol);
    const valid = quote.current > 0;
    validatedCache.set(symbol, valid);
    return valid;
  } catch {
    validatedCache.set(symbol, false);
    return false;
  }
}

/**
 * Batch validate tickers. Returns only valid ones.
 */
export async function validateTickers(symbols: string[]): Promise<string[]> {
  const toValidate = symbols.filter(s => {
    if (!isValidTickerFormat(s)) return false;
    const cached = validatedCache.get(s);
    if (cached === false) return false;
    if (cached === true) return false; // already known valid, we'll add it below
    return true;
  });

  // Already known valid
  const alreadyValid = symbols.filter(s => validatedCache.get(s) === true);

  // Validate unknown (batch of 5, parallel)
  const newlyValid: string[] = [];
  for (let i = 0; i < toValidate.length; i += 5) {
    const batch = toValidate.slice(i, i + 5);
    const results = await Promise.all(batch.map(s => validateTicker(s)));
    for (let j = 0; j < batch.length; j++) {
      if (results[j]) newlyValid.push(batch[j]);
    }
  }

  return [...alreadyValid, ...newlyValid];
}
