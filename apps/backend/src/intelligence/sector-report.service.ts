import type { SectorImpact, SectorReport } from '@trading/shared';
import { callAI } from '../shared/ai-router.js';
import {
  insertSectorImpacts,
  deleteSectorImpactsByDate,
  getSectorImpactsByDate,
  getNewsArticlesSince,
  getAllSectorTickers,
} from '../db/repository.js';

/**
 * Identify which sectors are impacted by current news.
 * Called during "Actualizar noticias" process.
 */
export async function identifySectorImpacts(headlines: string[]): Promise<SectorImpact[]> {
  if (headlines.length === 0) return [];

  const prompt = `IMPORTANTE: Responde EXCLUSIVAMENTE en español. Todos los textos (sector, event, etc.) deben estar en español. Prohibido usar inglés.

Sos un analista de mercado. Te doy los titulares de noticias financieras de las ultimas 48hs.

Tu trabajo: identificar los SECTORES FINANCIEROS que estan siendo impactados por estas noticias.

Para cada sector impactado, determina:
- "sector": nombre del sector (ej: "Defensa", "Petroleo y Gas", "Semiconductores", "Banca", "Crypto", "Tech/IA", "Salud/Pharma", "Commodities", "Energia Renovable", "E-commerce", "Automotriz", "Cybersecurity")
- "impact": "positive" si las noticias lo benefician, "negative" si lo perjudican, "mixed" si hay ambas
- "event": el evento principal que causa el impacto (1 oracion)
- "confidence": "high" si hay multiples noticias confirmando, "medium" si es una sola noticia fuerte
- "affectedPlazas": mercados afectados (ej: ["NYSE", "NASDAQ", "BYMA", "Crypto"])

REGLAS:
- Solo incluir sectores con impacto REAL y VERIFICABLE en las noticias
- No inventar impactos que no esten en las noticias
- Maximo 8 sectores
- Ordena por relevancia (mayor impacto primero)

Responde SOLO con JSON:
{"sectors":[{"sector":"Defensa","impact":"positive","event":"Guerra con Iran escala demanda de armamento","confidence":"high","affectedPlazas":["NYSE"]}]}`;

  const userMsg = `NOTICIAS DE LAS ULTIMAS 48HS:\n${headlines.join('\n')}`;

  try {
    const raw = await callAI('reasoning',userMsg, prompt, 4096);
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.sectors) ? parsed.sectors : [];
  } catch (err) {
    console.warn('[SectorReport] Failed to identify impacts:', (err as Error).message?.slice(0, 100));
    return [];
  }
}

/**
 * Generate detailed reports per sector with ticker suggestions.
 * Called after identifySectorImpacts().
 */
export async function generateSectorReports(
  impacts: SectorImpact[],
  headlines: string[],
): Promise<SectorReport[]> {
  if (impacts.length === 0) return [];

  // Build sector → tickers reference from DB so the LLM has up-to-date context.
  const allSectorTickers = getAllSectorTickers();
  const sectorExamples = Object.entries(
    allSectorTickers.reduce((acc, st) => {
      if (!acc[st.sector]) acc[st.sector] = [];
      acc[st.sector].push(st.ticker);
      return acc;
    }, {} as Record<string, string[]>),
  ).map(([sector, tickers]) => `- ${sector}: ${tickers.join(', ')}`).join('\n');

  const prompt = `IMPORTANTE: Responde EXCLUSIVAMENTE en español. Todos los textos (summary, keyNews, riskFactors) deben estar en español. Prohibido usar inglés.

Sos un analista de inversiones senior. Para cada sector impactado, genera un informe con:
- "sector": nombre del sector
- "impact": "positive", "negative", o "mixed"
- "summary": 2-3 oraciones explicando QUE PASA en este sector y POR QUE importa para invertir. Se especifico.
- "keyNews": las 2-3 noticias mas relevantes del sector (copiar literalmente de los titulares)
- "suggestedTickers": 3-5 tickers CONCRETOS (NYSE/NASDAQ) que se benefician o perjudican. Usa tickers reales. Para cada sector piensa en los lideres del mercado.
- "riskFactors": 1-2 riesgos especificos de este sector

IMPORTANTE: Los tickers deben ser REALES y que coticen en bolsa. Referencia de sectores y tickers conocidos:
${sectorExamples || '- (sin referencia disponible — usar conocimiento propio)'}

Responde SOLO con JSON:
{"reports":[{"sector":"...","impact":"positive","summary":"...","keyNews":["..."],"suggestedTickers":["LMT","RTX"],"riskFactors":["..."]}]}`;

  const impactContext = impacts.map(i =>
    `SECTOR: ${i.sector} | IMPACTO: ${i.impact} | EVENTO: ${i.event} | CONFIANZA: ${i.confidence}`
  ).join('\n');

  const userMsg = [
    'SECTORES IDENTIFICADOS:',
    impactContext,
    '',
    'NOTICIAS DE REFERENCIA:',
    ...headlines.slice(0, 15),
  ].join('\n');

  try {
    const raw = await callAI('reasoning',userMsg, prompt, 4096);
    const parsed = JSON.parse(raw);
    const reports: SectorReport[] = (parsed.reports ?? []).map((r: any) => ({
      sector: r.sector ?? '',
      impact: r.impact ?? 'mixed',
      summary: r.summary ?? '',
      keyNews: Array.isArray(r.keyNews) ? r.keyNews : [],
      suggestedTickers: Array.isArray(r.suggestedTickers) ? r.suggestedTickers : [],
      riskFactors: Array.isArray(r.riskFactors) ? r.riskFactors : [],
      generatedAt: Date.now(),
    }));
    return reports;
  } catch (err) {
    console.warn('[SectorReport] Failed to generate reports:', (err as Error).message?.slice(0, 100));
    return [];
  }
}

/**
 * Full sector analysis pipeline: identify impacts + generate reports + persist.
 * Called by "Actualizar noticias" process.
 */
export async function runSectorAnalysis(headlines: string[]): Promise<SectorReport[]> {
  console.log('[SectorReport] Running sector analysis...');

  // 1. Identify impacted sectors
  const impacts = await identifySectorImpacts(headlines);
  console.log(`[SectorReport] ${impacts.length} sectors identified: ${impacts.map(i => `${i.sector} (${i.impact})`).join(', ')}`);

  if (impacts.length === 0) return [];

  // 2. Generate detailed reports with ticker suggestions
  const reports = await generateSectorReports(impacts, headlines);
  console.log(`[SectorReport] ${reports.length} sector reports generated`);

  // 3. Persist to DB (delete old ones first to avoid duplicates)
  const today = new Date().toISOString().split('T')[0];
  try {
    deleteSectorImpactsByDate(today);
    insertSectorImpacts(today, reports.map(r => ({
      sector: r.sector,
      impact: r.impact,
      event: impacts.find(i => i.sector === r.sector)?.event ?? '',
      summary: r.summary,
      keyNews: r.keyNews,
      suggestedTickers: r.suggestedTickers,
      riskFactors: r.riskFactors,
      confidence: impacts.find(i => i.sector === r.sector)?.confidence ?? 'medium',
    })));
  } catch (err) {
    console.warn('[SectorReport] Persist failed:', err);
  }

  return reports;
}

/**
 * Get sector reports from BD (for today).
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
