import type { SectorReport } from '@trading/shared';
import { callAI } from '../shared/ai-router.js';
import {
  insertSectorImpacts,
  deleteSectorImpactsByDate,
  getSectorImpactsByDate,
  getFilteredArticlesForSectorSynthesis,
  getAllSectorTickers,
} from '../db/repository.js';

interface ArticleInput {
  title: string;
  summary: string | null;
  sentiment: string | null;
  impact: string | null;
  triangulationConfidence: string | null;
  source: string;
}

function buildArticleBlock(articles: ArticleInput[]): string {
  return articles.map((a, i) => {
    const conf = a.triangulationConfidence === 'high' ? '[ALTA]' : '[MEDIA]';
    const sentiment = a.sentiment ? ` | sentimiento: ${a.sentiment}` : '';
    const summary = a.summary ? `\n  Resumen: ${a.summary.slice(0, 200)}` : '';
    return `${i + 1}. ${conf} ${a.title} (${a.source}${sentiment})${summary}`;
  }).join('\n');
}

/**
 * Single-call sector synthesis from filtered/triangulated articles.
 * Returns up to 8 sector reports with causal analysis.
 */
export async function synthesizeSectorIntelligence(articles: ArticleInput[]): Promise<SectorReport[]> {
  if (articles.length === 0) return [];

  const allSectorTickers = getAllSectorTickers();
  const sectorExamples = Object.entries(
    allSectorTickers.reduce((acc, st) => {
      if (!acc[st.sector]) acc[st.sector] = [];
      acc[st.sector].push(st.ticker);
      return acc;
    }, {} as Record<string, string[]>),
  ).map(([sector, tickers]) => `- ${sector}: ${tickers.join(', ')}`).join('\n');

  const prompt = `IMPORTANTE: Responde EXCLUSIVAMENTE en español. Todos los textos deben estar en español. Prohibido usar inglés.

Sos un analista de mercado senior. Te doy artículos de noticias financieras filtrados por calidad (marcados [ALTA] = 3+ fuentes, [MEDIA] = 2 fuentes).

Tu trabajo: identificar los sectores financieros más impactados y generar un análisis causal completo de CADA UNO.

Para cada sector impactado, genera un objeto con:
- "sector": nombre en español (ej: "Defensa", "Petróleo y Gas", "Semiconductores", "Banca", "Crypto", "Tech/IA", "Salud/Pharma", "Commodities", "Energía Renovable", "E-commerce", "Automotriz", "Ciberseguridad")
- "impact": "positive" | "negative" | "mixed"
- "event": evento principal que causa el impacto (1 oración)
- "summary": 2-3 oraciones explicando QUÉ pasa y POR QUÉ importa para invertir. Sé específico.
- "catalysts": lista de 2-3 catalizadores concretos que impulsan el movimiento (ej: "Datos de empleo mejores de lo esperado", "Tensión arancelaria con China")
- "keyNews": los 2-3 titulares más relevantes del sector (copiar literalmente de las noticias)
- "suggestedTickers": 3-5 tickers reales (NYSE/NASDAQ) que se benefician o perjudican
- "riskFactors": 1-2 riesgos específicos de este sector ahora mismo
- "conviccion": "alta" si múltiples noticias [ALTA] confirman | "media" si mezcla de [ALTA]+[MEDIA] | "baja" si solo [MEDIA]
- "tension": si hay señales contradictorias en el sector, describir en 1 oración. null si no hay tensión.
- "confidence": "high" | "medium"

REGLAS:
- Solo incluir sectores con impacto REAL y VERIFICABLE en las noticias
- No inventar impactos que no estén en los artículos
- Máximo 8 sectores, ordenados por relevancia
- Los catalizadores deben ser causas concretas, no genéricas

REFERENCIA DE TICKERS POR SECTOR:
${sectorExamples || '(usar conocimiento propio)'}

Responde SOLO con JSON válido:
{"sectors":[{"sector":"Semiconductores","impact":"positive","event":"...","summary":"...","catalysts":["..."],"keyNews":["..."],"suggestedTickers":["NVDA","AMD"],"riskFactors":["..."],"conviccion":"alta","tension":null,"confidence":"high"}]}`;

  const userMsg = `ARTÍCULOS FILTRADOS (${articles.length} con confianza alta/media):\n\n${buildArticleBlock(articles)}`;

  try {
    const raw = await callAI('reasoning', userMsg, prompt, 6000);
    const parsed = JSON.parse(raw);
    const now = Date.now();
    return (parsed.sectors ?? []).map((r: any): SectorReport => ({
      sector: r.sector ?? '',
      impact: (r.impact ?? 'mixed') as SectorReport['impact'],
      summary: r.summary ?? '',
      keyNews: Array.isArray(r.keyNews) ? r.keyNews : [],
      suggestedTickers: Array.isArray(r.suggestedTickers) ? r.suggestedTickers : [],
      riskFactors: Array.isArray(r.riskFactors) ? r.riskFactors : [],
      catalysts: Array.isArray(r.catalysts) ? r.catalysts : [],
      conviccion: (['alta', 'media', 'baja'].includes(r.conviccion) ? r.conviccion : 'media') as SectorReport['conviccion'],
      tension: r.tension ?? null,
      generatedAt: now,
    }));
  } catch (err) {
    console.warn('[SectorIntelligence] Synthesis failed:', (err as Error).message?.slice(0, 100));
    return [];
  }
}

/**
 * Full sector intelligence pipeline: fetch filtered articles → synthesize → persist.
 * Called by pipeline.service.ts runSectorIntelligenceStage().
 */
export async function runSectorIntelligence(): Promise<{ reports: SectorReport[]; articleCount: number }> {
  console.log('[SectorIntelligence] Fetching filtered articles...');
  const articles = getFilteredArticlesForSectorSynthesis(60);
  console.log(`[SectorIntelligence] ${articles.length} high/medium confidence articles`);

  if (articles.length === 0) {
    return { reports: [], articleCount: 0 };
  }

  const reports = await synthesizeSectorIntelligence(articles);
  console.log(`[SectorIntelligence] ${reports.length} sector reports generated`);

  if (reports.length > 0) {
    const today = new Date().toISOString().split('T')[0];
    try {
      deleteSectorImpactsByDate(today);
      insertSectorImpacts(today, reports.map(r => ({
        sector: r.sector,
        impact: r.impact,
        event: r.summary.split('.')[0] ?? r.summary,
        summary: r.summary,
        keyNews: r.keyNews,
        suggestedTickers: r.suggestedTickers,
        riskFactors: r.riskFactors,
        catalysts: r.catalysts,
        conviccion: r.conviccion,
        tension: r.tension,
        confidence: r.conviccion === 'alta' ? 'high' : 'medium',
      })));
    } catch (err) {
      console.warn('[SectorIntelligence] Persist failed:', err);
    }
  }

  return { reports, articleCount: articles.length };
}

/**
 * Get sector reports from DB (for today).
 */
export function getStoredSectorReports(): SectorReport[] {
  const today = new Date().toISOString().split('T')[0];
  const rows = getSectorImpactsByDate(today);
  return rows.map(r => ({
    sector: r.sector,
    impact: r.impact as SectorReport['impact'],
    summary: r.summary,
    keyNews: r.keyNews,
    suggestedTickers: r.suggestedTickers,
    riskFactors: r.riskFactors,
    catalysts: r.catalysts,
    conviccion: (r.conviccion ?? 'media') as SectorReport['conviccion'],
    tension: r.tension ?? null,
    generatedAt: new Date(r.createdAt).getTime(),
  }));
}

/**
 * Get all suggested tickers from sector reports (for discovery).
 */
export function getTickersFromSectorReports(): string[] {
  const reports = getStoredSectorReports();
  return [...new Set(reports.flatMap(r => r.suggestedTickers))];
}
