import { ANALYST_SYSTEM_PROMPT, type Opportunity } from '@trading/shared';
import { chatWithClaude } from '../shared/claude.js';
import { getPortfolio } from '../portfolio/portfolio.service.js';
import { getLatestOpportunityScan } from '../db/repository.js';

const ENGINE_ACTIONS_CAP = 20;

/**
 * Bloque de contexto con las acciones actuales del motor (último scan), para que el chat
 * no contradiga libremente al resto de las superficies (Hoy, Oportunidades). Toma los
 * símbolos con acción BUY/SELL del scan + los símbolos en cartera (con la acción que el
 * motor les asigna, sea cual sea), cap ~20. Puro — testeable sin DB ni red.
 */
export function buildEngineActionsBlock(
  scanOpportunitiesJson: string | null | undefined,
  portfolioSymbols: string[],
  cap: number = ENGINE_ACTIONS_CAP,
): string | null {
  if (!scanOpportunitiesJson) return null;

  let opps: Array<Pick<Opportunity, 'symbol' | 'action'>>;
  try {
    const parsed = JSON.parse(scanOpportunitiesJson);
    if (!Array.isArray(parsed)) return null;
    opps = parsed;
  } catch {
    return null;
  }

  const portfolioSet = new Set(portfolioSymbols.map((s) => s.toUpperCase()));
  const bySymbol = new Map<string, string>();
  for (const o of opps) {
    if (!o?.symbol || !o.action) continue;
    const sym = o.symbol.toUpperCase();
    if (o.action === 'BUY' || o.action === 'SELL' || portfolioSet.has(sym)) {
      bySymbol.set(sym, o.action);
    }
  }
  if (bySymbol.size === 0) return null;

  // Portfolio SIEMPRE primero, después el resto (que ya viene por score desc del scan) hasta
  // llenar el cap. Sin esto, ≥20 BUY/SELL de score alto podían dejar afuera una posición real —
  // justo el caso que el bloque existe para evitar (que el chat contradiga TUS posiciones).
  const entries = [...bySymbol.entries()];
  const ordered = [
    ...entries.filter(([sym]) => portfolioSet.has(sym)),
    ...entries.filter(([sym]) => !portfolioSet.has(sym)),
  ];
  const list = ordered
    .slice(0, cap)
    .map(([sym, action]) => `${sym}=${action}`)
    .join(', ');
  return `ACCIONES ACTUALES DEL MOTOR (si las contradecís, decilo explícitamente y explicá por qué): ${list}`;
}

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

  // Acciones actuales del motor (último scan) — sin esto el chat contradice libremente
  // a "Hoy"/"Oportunidades", que sí leen del scan. Omitido si todavía no hay scan.
  let engineActionsContext = '';
  try {
    const scan = getLatestOpportunityScan();
    const block = buildEngineActionsBlock(
      scan?.opportunities,
      portfolio.positions.map((p) => p.symbol),
    );
    if (block) engineActionsContext = `\n\n${block}`;
  } catch { /* non-critical */ }

  const enrichedSystem = `${ANALYST_SYSTEM_PROMPT}

Estado actual del portfolio (valor total: $${portfolio.totalValue.toFixed(0)}, P&L: ${portfolio.totalPnlPercent >= 0 ? '+' : ''}${portfolio.totalPnlPercent.toFixed(1)}%):
${portfolioContext}${marketContext}${engineActionsContext}`;

  const response = await chatWithClaude(messages, enrichedSystem);
  return { role: 'assistant' as const, content: response, timestamp: Date.now() };
}
