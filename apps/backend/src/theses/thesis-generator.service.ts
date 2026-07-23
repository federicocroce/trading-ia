// apps/backend/src/theses/thesis-generator.service.ts
/**
 * Generador semanal de tesis (LLM). Lee el estado del mercado (radar de ciclos, eventos macro
 * recientes, top oportunidades del scan, régimen), se lo pasa a un LLM con instrucciones
 * estrictas sobre el shape y las restricciones de `validateThesis`, y persiste solo las tesis
 * que sobreviven esa validación.
 *
 * FRONTERA: este servicio LEE de opportunities/radar/macro a través de los getters de
 * `db/repository.ts` y del régimen de mercado vía `evidence-signals/market-regime.service.ts` —
 * jamás importa nada hacia esos dominios. La relación es unidireccional: theses/ conoce el
 * scan/radar/macro/régimen, esos dominios no conocen theses/.
 *
 * Fail-closed: LLM caído, JSON malformado, o sin insumos suficientes → siempre devuelve
 * `{generated:0, discarded:0, reasons:[...]}` con log — nunca lanza hacia el cron.
 */
import { callAIWithModel } from '../shared/ai-router.js';
import { getQuotes } from '../shared/yahoo.js';
import { getMarketRegime } from '../evidence-signals/market-regime.service.js';
import {
  getLatestCycleRadarDate,
  getCycleRadarSnapshots,
  getLatestOpportunityScan,
  getSnapshotsForScan,
  getRecentMacroEvents,
  getThesesByCreatedDate,
  insertThesis,
} from '../db/repository.js';
import { envNumber } from '../shared/env-number.js';
import { validateThesis } from './thesis-validator.js';

export interface GenerateWeeklyThesesResult {
  generated: number;
  discarded: number;
  reasons: string[];
}

// Guard in-flight contra invocaciones concurrentes de generateWeeklyTheses en el mismo proceso.
let generacionEnCurso = false;

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoStr(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

const THESIS_SYSTEM_PROMPT = `Sos un analista de tesis de inversión de mediano plazo (5 a 120 días) para un swing trader argentino. Trabajás con evidencia narrativa/macro — NO predecís movimientos de corto plazo, proponés tesis con niveles verificables de entrada e invalidación.

Te paso: régimen de mercado, radar de ciclos por país/sector, eventos macro recientes, top oportunidades del último scan técnico, y los PRECIOS VIVOS de los símbolos candidatos.

Devolvé EXCLUSIVAMENTE un array JSON (sin texto adicional, sin markdown, sin fences \`\`\`) de 1 a 3 tesis. Cada tesis es un objeto con EXACTAMENTE estos campos, EN ESTE ORDEN (los campos numéricos/estructurales van primero para que sobrevivan si el output se corta antes de terminar; "narrative" va último por ser el más largo):

{
  "title": string (máx 120 caracteres),
  "direction": "alcista" | "bajista",
  "primarySymbol": string (DEBE ser uno de los símbolos con precio vivo listado; DEBE estar incluido en "symbols"),
  "symbols": string[] (máximo 5 símbolos, DEBEN venir de la lista de precios vivos — nunca inventes tickers),
  "entryConditionText": string (condición de entrada en lenguaje legible, ej "ruptura de máximos de 3 meses con volumen"),
  "entryTriggerPrice": number (nivel de precio que gatilla la entrada),
  "entryComparator": "above" | "below" (si el trigger se toca subiendo o bajando),
  "invalidationPrice": number (nivel que mata la tesis),
  "invalidationReason": string (por qué ese nivel invalida la tesis),
  "horizonDays": integer (entre 5 y 120),
  "catalyst": string | null (catalizador esperado, opcional),
  "narrative": string (entre 100 y 500 caracteres — el "por qué". OBLIGATORIO citar por nombre AL MENOS un insumo concreto de los que te di: un símbolo con su score/veredicto del scan, un estado+categoría del radar de ciclos, o un evento macro con su fecha. Prohibido usar generalidades tipo "el sector muestra fortaleza" sin anclarlas a un dato concreto de la lista)
}

REGLAS DURAS (una tesis que las viola se descarta entera, no se corrige):
1. entryTriggerPrice debe quedar dentro de ±25% del precio vivo de primarySymbol (te doy los precios vivos exactos — usalos, no los redondees a niveles fantasía).
2. En tesis alcista: invalidationPrice < precio vivo Y invalidationPrice < entryTriggerPrice.
3. En tesis bajista: invalidationPrice > precio vivo Y invalidationPrice > entryTriggerPrice.
4. horizonDays entero entre 5 y 120.
5. primarySymbol y todos los símbolos de "symbols" deben venir de la lista de PRECIOS VIVOS que te doy — nunca inventes un ticker que no esté ahí.
6. narrative entre 100 y 500 caracteres, con sustancia real (no relleno) y citando por nombre al menos un insumo concreto (símbolo+score del scan, estado+categoría del radar, o evento macro con fecha) — no alcanza con vaguedades genéricas.
7. Generá el JSON completo y compacto: sé conciso en narrative (no superes los 500 caracteres) para no cortar el output antes de cerrar el array — un output truncado descarta la tesis entera.

Si con los insumos dados no hay ninguna tesis de calidad, devolvé un array vacío []. Preferí devolver menos tesis (o ninguna) antes que inventar niveles o símbolos.`;

function formatRadarLine(row: {
  symbol: string; label: string; categoria: string; close: number;
  distSma200Pct: number | null; ret3m: number | null; ret6m: number | null;
  cycleState: string | null; stateReason: string | null;
}): string {
  const pct = (v: number | null) => (v != null ? `${v > 0 ? '+' : ''}${v.toFixed(1)}%` : 'n/d');
  return `- ${row.label} (${row.symbol}, ${row.categoria}): close=${row.close.toFixed(2)}, dist SMA200=${pct(row.distSma200Pct)}, ret3m=${pct(row.ret3m)}, ret6m=${pct(row.ret6m)}, estado=${row.cycleState ?? 'n/d'}${row.stateReason ? ` (${row.stateReason})` : ''}`;
}

function formatMacroLine(row: { date: string; event: string; category: string; magnitude: string }): string {
  return `- ${row.date} [${row.magnitude}] ${row.category}: ${row.event}`;
}

function formatOpportunityLine(row: {
  symbol: string; sector: string; opportunityScore: number; recommendation: string;
  currentPrice: number; confidence: number; reasoning: string;
}): string {
  return `- ${row.symbol} (${row.sector}): score=${row.opportunityScore}, veredicto=${row.recommendation}, precio=${row.currentPrice}, confianza=${row.confidence}%. ${row.reasoning}`;
}

function buildUserMessage(input: {
  radarDate: string | null;
  radarSnapshots: ReturnType<typeof getCycleRadarSnapshots>;
  macroEvents: ReturnType<typeof getRecentMacroEvents>;
  topOpportunities: ReturnType<typeof getSnapshotsForScan>;
  regime: Awaited<ReturnType<typeof getMarketRegime>>;
  livePrices: Map<string, number>;
}): string {
  const lines: string[] = [];
  lines.push(`FECHA: ${todayStr()}`, '');
  lines.push(
    `RÉGIMEN DE MERCADO: ${input.regime.regime}${input.regime.degraded ? ' (DEGRADADO — usar con cautela, evitar tesis alcistas agresivas)' : ''} — ` +
    `SPY=${input.regime.spyPrice} vs SMA200=${input.regime.sma200} (${input.regime.priceVsSma200Pct}%)`,
    '',
  );
  lines.push(`RADAR DE CICLOS${input.radarDate ? ` (${input.radarDate})` : ''}:`);
  lines.push(input.radarSnapshots.length > 0 ? input.radarSnapshots.map(formatRadarLine).join('\n') : '(sin datos)', '');
  lines.push('EVENTOS MACRO (recientes):');
  lines.push(input.macroEvents.length > 0 ? input.macroEvents.map(formatMacroLine).join('\n') : '(sin eventos)', '');
  lines.push('TOP OPORTUNIDADES DEL ÚLTIMO SCAN:');
  lines.push(input.topOpportunities.length > 0 ? input.topOpportunities.map(formatOpportunityLine).join('\n') : '(sin datos)', '');
  lines.push('PRECIOS VIVOS (únicos símbolos válidos para primarySymbol/symbols):');
  const priceLines = [...input.livePrices.entries()].map(([sym, price]) => `- ${sym}: ${price}`);
  lines.push(priceLines.length > 0 ? priceLines.join('\n') : '(sin precios)');
  return lines.join('\n');
}

export async function generateWeeklyTheses(): Promise<GenerateWeeklyThesesResult> {
  const today = todayStr();

  // Guard in-flight contra invocaciones concurrentes. El backend es un solo proceso Node —
  // esto cierra completamente la race condition sin necesidad de locks distribuidos.
  if (generacionEnCurso) {
    const msg = 'Generación ya en curso — invocación concurrente ignorada';
    console.warn(`[thesis-generator] ${msg}`);
    return { generated: 0, discarded: 0, reasons: [msg] };
  }

  // Idempotencia entre corridas: ya hay tesis de hoy (re-corrida manual posterior o doble
  // disparo del cron) → skip. Combinado con el guard in-flight arriba, garantiza que
  // solo una generación ocurre por createdDate.
  const existingToday = getThesesByCreatedDate(today);
  if (existingToday.length > 0) {
    const msg = `ya existen ${existingToday.length} tesis con createdDate=${today} — skip (idempotencia entre corridas)`;
    console.log(`[thesis-generator] ${msg}`);
    return { generated: 0, discarded: 0, reasons: [msg] };
  }

  generacionEnCurso = true;
  try {
    const macroLookbackDays = envNumber('THESIS_MACRO_LOOKBACK_DAYS', 7);
    const topOpportunitiesLimit = envNumber('THESIS_TOP_OPPORTUNITIES_LIMIT', 10);
    // 4096 no alcanzaba: Gemini 2.5 gasta parte del presupuesto de maxOutputTokens en "thinking"
    // interno (no hay thinkingConfig en gemini.ts) antes de emitir el JSON visible — la corrida
    // real del 2026-07-23 se truncó a mitad de la primera narrative y perdió todos los campos
    // posteriores (primarySymbol incluido). 10000 da margen para thinking + hasta 3 tesis completas.
    const maxTokens = envNumber('THESIS_LLM_MAX_TOKENS', 10000);
    const maxThesesPerRun = envNumber('THESIS_MAX_PER_RUN', 3);

    // --- 1. Insumos ---
    const radarDate = getLatestCycleRadarDate();
    const radarSnapshots = radarDate ? getCycleRadarSnapshots(radarDate) : [];
    const macroEvents = getRecentMacroEvents(daysAgoStr(macroLookbackDays));
    const latestScan = getLatestOpportunityScan();
    const topOpportunities = latestScan
      ? getSnapshotsForScan(latestScan.id).slice(0, topOpportunitiesLimit)
      : [];
    const regime = await getMarketRegime();

    const candidateSymbols = [...new Set([
      ...radarSnapshots.map((r) => r.symbol),
      ...topOpportunities.map((o) => o.symbol),
    ])];

    if (candidateSymbols.length === 0) {
      const msg = 'sin símbolos candidatos (radar y scan vacíos) — skip';
      console.warn(`[thesis-generator] ${msg}`);
      return { generated: 0, discarded: 0, reasons: [msg] };
    }

    const quotes = await getQuotes(candidateSymbols);
    const livePrices = new Map(quotes.map((q) => [q.symbol, q.current]));

    if (livePrices.size === 0) {
      const msg = 'sin precios vivos para ningún símbolo candidato — skip';
      console.warn(`[thesis-generator] ${msg}`);
      return { generated: 0, discarded: 0, reasons: [msg] };
    }

    // --- 2. Prompt ---
    const userMessage = buildUserMessage({ radarDate, radarSnapshots, macroEvents, topOpportunities, regime, livePrices });

    // --- 3. LLM (callAIWithModel ya resuelve fences/reintentos/jsonrepair — ver ai-router.ts) ---
    const result = await callAIWithModel('reasoning', userMessage, THESIS_SYSTEM_PROMPT, maxTokens);
    const parsed: unknown = JSON.parse(result.content);
    if (!Array.isArray(parsed)) {
      const msg = `respuesta del LLM no es un array JSON (typeof=${typeof parsed})`;
      console.warn(`[thesis-generator] ${msg}`);
      return { generated: 0, discarded: 0, reasons: [msg] };
    }
    const candidates = parsed.slice(0, maxThesesPerRun);

    // --- 4. Validación + persistencia ---
    const sourceEvidence = JSON.stringify({
      radarDate,
      radarSymbolCount: radarSnapshots.length,
      macroEventCount: macroEvents.length,
      macroLookbackDays,
      topOpportunitySymbols: topOpportunities.map((o) => o.symbol),
      regime: regime.regime,
      regimeDegraded: regime.degraded,
    });

    let generated = 0;
    const reasons: string[] = [];

    if (parsed.length > maxThesesPerRun) {
      const truncatedCount = parsed.length - maxThesesPerRun;
      const msg = `LLM devolvió ${parsed.length} tesis, se truncaron ${truncatedCount} (límite THESIS_MAX_PER_RUN=${maxThesesPerRun})`;
      console.warn(`[thesis-generator] ${msg}`);
      reasons.push(msg);
    }

    for (const raw of candidates) {
      const validated = validateThesis(raw, livePrices);
      if (!validated.ok) {
        reasons.push(validated.reason);
        console.warn(`[thesis-generator] Tesis descartada: ${validated.reason}`);
        continue;
      }
      insertThesis({
        createdDate: today,
        title: validated.thesis.title,
        direction: validated.thesis.direction,
        narrative: validated.thesis.narrative,
        catalyst: validated.thesis.catalyst,
        primarySymbol: validated.thesis.primarySymbol,
        symbols: JSON.stringify(validated.thesis.symbols),
        entryConditionText: validated.thesis.entryConditionText,
        entryTriggerPrice: validated.thesis.entryTriggerPrice,
        entryComparator: validated.thesis.entryComparator,
        invalidationPrice: validated.thesis.invalidationPrice,
        invalidationReason: validated.thesis.invalidationReason,
        horizonDays: validated.thesis.horizonDays,
        sourceEvidence,
        llmProvider: result.model,
      });
      generated++;
      console.log(`[thesis-generator] Tesis generada: "${validated.thesis.title}" (${validated.thesis.primarySymbol}, ${validated.thesis.direction})`);
    }

    const discarded = candidates.length - generated;
    console.log(`[thesis-generator] ${generated} generadas, ${discarded} descartadas (modelo: ${result.model})`);
    return { generated, discarded, reasons };
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    console.error('[thesis-generator] Falló:', msg);
    return { generated: 0, discarded: 0, reasons: [msg] };
  } finally {
    generacionEnCurso = false;
  }
}
