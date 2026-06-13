import type { SectorReport } from '@trading/shared';
import { callAI } from '../shared/ai-router.js';
import { validateTickers } from '../discovery/ticker-validator.js';
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

// Lista canónica: siempre se muestra una tarjeta por cada uno, con criticidad.
// Si no hay noticias relevantes hoy → impact='neutral', conviccion='baja'.
export const CANONICAL_INTEL_SECTORS = [
  'Tech/IA',
  'Semiconductores',
  'Banca',
  'Petróleo y Gas',
  'Energía Renovable',
  'Defensa',
  'Salud/Pharma',
  'Crypto',
  'Commodities',
  'Consumo/Retail',
  'Real Estate',
  'Automotriz',
] as const;

function buildNeutralSector(sectorName: string, generatedAt: number): SectorReport {
  return {
    sector: sectorName,
    impact: 'neutral',
    summary: 'Sin movimientos relevantes en las noticias del último ciclo.',
    keyNews: [],
    suggestedTickers: [],
    riskFactors: [],
    catalysts: [],
    conviccion: 'baja',
    tension: null,
    generatedAt,
  };
}

function normalizeSectorName(name: string): string {
  return name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
}

function mergeWithCanonical(llmReports: SectorReport[], generatedAt: number): SectorReport[] {
  const byNorm = new Map<string, SectorReport>();
  for (const r of llmReports) {
    if (r.sector) byNorm.set(normalizeSectorName(r.sector), r);
  }
  return CANONICAL_INTEL_SECTORS.map(canonical => {
    const found = byNorm.get(normalizeSectorName(canonical));
    if (found) return { ...found, sector: canonical };
    return buildNeutralSector(canonical, generatedAt);
  });
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

  const canonicalList = CANONICAL_INTEL_SECTORS.map(s => `  - ${s}`).join('\n');

  const prompt = `IMPORTANTE: Responde EXCLUSIVAMENTE en español. Todos los textos deben estar en español. Prohibido usar inglés.

Sos un analista de mercado senior. Te doy artículos de noticias financieras filtrados por calidad (marcados [ALTA] = 3+ fuentes, [MEDIA] = 2 fuentes).

Tu trabajo: evaluar el impacto de las noticias sobre CADA UNO de los sectores canónicos listados abajo. Devolvés un objeto por cada sector — incluso si no hay impacto (impact="neutral").

SECTORES A EVALUAR (uno por uno, NO omitir ninguno, usar EXACTAMENTE estos nombres):
${canonicalList}

Para cada sector, genera un objeto con:
- "sector": nombre EXACTO de la lista de arriba
- "impact": "positive" | "negative" | "mixed" | "neutral" ("neutral" = no hay noticias relevantes hoy)
- "event": evento principal que causa el impacto (1 oración). Si impact="neutral" → "Sin eventos relevantes en el ciclo actual"
- "summary": 2-3 oraciones explicando QUÉ pasa y POR QUÉ importa para invertir. Si impact="neutral" → "Sin movimientos relevantes en las noticias del último ciclo."
- "catalysts": lista de 2-3 catalizadores concretos. [] si neutral.
- "keyNews": 2-3 titulares más relevantes (copiar literalmente). [] si neutral.
- "suggestedTickers": 3-5 tickers reales (NYSE/NASDAQ). [] si neutral.
- "riskFactors": 1-2 riesgos específicos. [] si neutral.
- "conviccion": "alta" | "media" | "baja". Si impact="neutral" → "baja".
- "tension": si hay señales contradictorias, 1 oración. null si no.
- "confidence": "high" | "medium"

REGLAS:
- DEBES devolver EXACTAMENTE ${CANONICAL_INTEL_SECTORS.length} objetos en "sectors", uno por sector canónico (incluí los neutrales).
- No inventar impactos que no estén en los artículos. Si dudás → impact="neutral".
- Para impactados, los catalizadores deben ser causas concretas, no genéricas.
- Ordená por relevancia: los de impact distinto de "neutral" primero, dentro de esos por conviccion alta→baja.

REFERENCIA DE TICKERS POR SECTOR:
${sectorExamples || '(usar conocimiento propio)'}

Responde SOLO con JSON válido:
{"sectors":[{"sector":"Semiconductores","impact":"positive","event":"...","summary":"...","catalysts":["..."],"keyNews":["..."],"suggestedTickers":["NVDA","AMD"],"riskFactors":["..."],"conviccion":"alta","tension":null,"confidence":"high"}]}`;

  const userMsg = `ARTÍCULOS FILTRADOS (${articles.length} con confianza alta/media):\n\n${buildArticleBlock(articles)}`;

  try {
    const raw = await callAI('reasoning', userMsg, prompt, 6000);
    const parsed = JSON.parse(raw);
    const now = Date.now();
    const llmReports: SectorReport[] = (parsed.sectors ?? []).map((r: any): SectorReport => ({
      sector: r.sector ?? '',
      impact: (['positive', 'negative', 'mixed', 'neutral'].includes(r.impact) ? r.impact : 'neutral') as SectorReport['impact'],
      summary: r.summary ?? '',
      keyNews: Array.isArray(r.keyNews) ? r.keyNews : [],
      suggestedTickers: Array.isArray(r.suggestedTickers) ? r.suggestedTickers : [],
      riskFactors: Array.isArray(r.riskFactors) ? r.riskFactors : [],
      catalysts: Array.isArray(r.catalysts) ? r.catalysts : [],
      conviccion: (['alta', 'media', 'baja'].includes(r.conviccion) ? r.conviccion : 'media') as SectorReport['conviccion'],
      tension: r.tension ?? null,
      generatedAt: now,
    }));
    // Anclaje anti-alucinación: validar suggestedTickers contra Yahoo, descartar inventados.
    const allTickers = [...new Set(llmReports.flatMap((r) => r.suggestedTickers.map((t) => String(t).trim().toUpperCase())))];
    const valid = new Set(await validateTickers(allTickers));
    for (const rep of llmReports) {
      rep.suggestedTickers = rep.suggestedTickers.filter((t) => valid.has(String(t).trim().toUpperCase()));
    }
    return mergeWithCanonical(llmReports, now);
  } catch (err) {
    throw err;
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
    const now = Date.now();
    const neutralReports = mergeWithCanonical([], now);
    const today = new Date().toISOString().split('T')[0];
    try {
      deleteSectorImpactsByDate(today);
      insertSectorImpacts(today, neutralReports.map(r => ({
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
        confidence: 'medium',
      })));
    } catch (err) {
      console.warn('[SectorIntelligence] Persist neutral failed:', err);
    }
    return { reports: neutralReports, articleCount: 0 };
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
  const stored: SectorReport[] = rows.map(r => ({
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
  return mergeWithCanonical(stored, Date.now());
}

/**
 * Get all suggested tickers from sector reports (for discovery).
 */
export function getTickersFromSectorReports(): string[] {
  const reports = getStoredSectorReports();
  return [...new Set(reports.flatMap(r => r.suggestedTickers))];
}
