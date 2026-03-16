import { ANALYST_SYSTEM_PROMPT } from '@trading/shared';
import { chatWithClaude } from '../shared/claude.js';
import { getPortfolio } from '../portfolio/portfolio.service.js';

export async function chat(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
) {
  const portfolio = await getPortfolio();
  const portfolioContext = portfolio.positions
    .map((p) => `${p.symbol}: ${p.quantity} @ $${p.avgCost} → $${p.currentPrice.toFixed(2)} (${p.pnlPercent >= 0 ? '+' : ''}${p.pnlPercent.toFixed(1)}%)`)
    .join('\n');

  const enrichedSystem = `${ANALYST_SYSTEM_PROMPT}

Estado actual del portfolio (valor total: $${portfolio.totalValue.toFixed(0)}, P&L: ${portfolio.totalPnlPercent >= 0 ? '+' : ''}${portfolio.totalPnlPercent.toFixed(1)}%):
${portfolioContext}`;

  const response = await chatWithClaude(messages, enrichedSystem);
  return { role: 'assistant' as const, content: response, timestamp: Date.now() };
}
