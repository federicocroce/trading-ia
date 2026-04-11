import type { Signal } from '@trading/shared';
import { ANALYST_SYSTEM_PROMPT } from '@trading/shared';
import { askLMStudio } from '../shared/lmstudio.js';
import { getPriceBySymbol } from '../prices/prices.service.js';
import { getPortfolioPositions } from '../db/repository.js';

export async function getSignalForSymbol(symbol: string): Promise<Signal> {
  const price = await getPriceBySymbol(symbol);

  const prompt = `Símbolo: ${symbol}
Precio actual: $${price.current}
Cambio hoy: ${price.changePercent >= 0 ? '+' : ''}${price.changePercent.toFixed(2)}%
Máximo: $${price.high}, Mínimo: $${price.low}

Respondé SOLO en formato JSON:
{"action": "BUY|SELL|HOLD|WATCH", "confidence": 0-100, "reason": "razón concisa"}`;

  const raw = await askLMStudio(prompt, ANALYST_SYSTEM_PROMPT);

  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return {
        symbol,
        action: parsed.action ?? 'HOLD',
        confidence: parsed.confidence ?? 50,
        reason: parsed.reason ?? raw,
        timestamp: Date.now(),
      };
    }
  } catch {
    // fallback if JSON parsing fails
  }

  return {
    symbol,
    action: 'HOLD',
    confidence: 50,
    reason: raw,
    timestamp: Date.now(),
  };
}

export async function getAllSignals(): Promise<Signal[]> {
  const symbols = getPortfolioPositions().map((p) => p.symbol);
  const results = await Promise.allSettled(symbols.map(getSignalForSymbol));

  return results
    .filter((r): r is PromiseFulfilledResult<Signal> => r.status === 'fulfilled')
    .map((r) => r.value);
}
