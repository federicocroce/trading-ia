import { NEWS_ANALYSIS_PROMPT, SIGNAL_GENERATION_PROMPT } from '@trading/shared';
// import { askClaude } from '../shared/claude.js';
import { askLMStudio } from '../shared/lmstudio.js';
import { getPortfolio } from '../portfolio/portfolio.service.js';

export async function analyzeNews(title: string, content?: string) {
  const portfolio = await getPortfolio();
  const portfolioContext = portfolio.positions
    .map((p) => `${p.symbol}: ${p.quantity} acciones, P&L: ${p.pnlPercent.toFixed(1)}%`)
    .join('\n');

  const prompt = `Portfolio actual:
${portfolioContext}

Noticia: ${title}
${content ? `Detalle: ${content}` : ''}`;

  const analysis = await askLMStudio(prompt, NEWS_ANALYSIS_PROMPT);
  return { title, analysis };
}

export async function generateSignal(symbol: string) {
  const portfolio = await getPortfolio();
  const position = portfolio.positions.find((p) => p.symbol === symbol);

  const prompt = `Símbolo: ${symbol}
${position ? `Posición actual: ${position.quantity} acciones, avg cost $${position.avgCost}, P&L: ${position.pnlPercent.toFixed(1)}%` : 'Sin posición en portfolio'}

Portfolio total: $${portfolio.totalValue.toFixed(0)}, P&L total: ${portfolio.totalPnlPercent.toFixed(1)}%`;

  const analysis = await askLMStudio(prompt, SIGNAL_GENERATION_PROMPT);
  return { symbol, analysis };
}
