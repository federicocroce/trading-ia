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

  // Add market intelligence if available
  let marketContext = '';
  try {
    const { getIntelligenceFromDB } = await import('../news/news-intelligence.service.js');
    const intelligence = await getIntelligenceFromDB();
    if (intelligence.plazas.length > 0) {
      const plazaSummaries = intelligence.plazas
        .filter(p => Math.abs(p.sentimentScore) > 0.1) // Only meaningful sentiments
        .slice(0, 5)
        .map(p => `${p.label}: ${p.overallSentiment} (${p.sentimentScore > 0 ? '+' : ''}${p.sentimentScore.toFixed(2)})`)
        .join(', ');
      if (plazaSummaries) {
        marketContext = `\nSentimiento de mercado actual: ${plazaSummaries}.`;
      }
    }
    if (intelligence.alerts.length > 0) {
      const topAlerts = intelligence.alerts
        .filter(a => a.severity === 'critical' || a.severity === 'warning')
        .slice(0, 3)
        .map(a => a.message)
        .join('. ');
      if (topAlerts) {
        marketContext += `\nAlertas: ${topAlerts}.`;
      }
    }
  } catch { /* non-critical */ }

  const enrichedSystem = `${ANALYST_SYSTEM_PROMPT}

Estado actual del portfolio (valor total: $${portfolio.totalValue.toFixed(0)}, P&L: ${portfolio.totalPnlPercent >= 0 ? '+' : ''}${portfolio.totalPnlPercent.toFixed(1)}%):
${portfolioContext}${marketContext}`;

  const response = await chatWithClaude(messages, enrichedSystem);
  return { role: 'assistant' as const, content: response, timestamp: Date.now() };
}
