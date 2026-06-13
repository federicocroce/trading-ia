import { callAI } from '../shared/ai-router.js';
import { validateTickers } from '../discovery/ticker-validator.js';
import type { MacroEventRow } from '../db/repository.js';

const VALID_CATEGORIES = [
  'Política Monetaria', 'Semiconductores/IA', 'Energía/Oil', 'Argentina/CEDEARs',
  'Cripto', 'Banca US', 'Salud/Biotech', 'Commodities', 'Comercio/Aranceles',
  'Consumo/Retail', 'Defensa/Geopolítica',
] as const;

const EVENT_EXTRACTION_PROMPT = `Sos un analista de mercados financieros.
Te doy los titulares de noticias del día. Identificá los 5-8 EVENTOS MACRO más relevantes para los mercados financieros.

Para cada evento:
- "id": "evt_1", "evt_2", etc. (secuencial)
- "event": una oración clara describiendo qué pasó
- "category": una de estas categorías exactas: ${VALID_CATEGORIES.join(', ')}
- "magnitude": "high" | "medium" | "low"

Solo incluí eventos con impacto real y verificable en precios de activos. Ignorá ruido y clickbait.

Respondé SOLO con JSON válido: {"events": [...]}`;

const CAUSAL_CHAINS_PROMPT = `Sos un estratega de inversiones senior.
Te doy una lista de eventos macro del día. Para cada evento, razoná las cadenas causales y determiná qué tickers de bolsa están impactados.

Para cada ticker en una cadena:
- "ticker": símbolo válido NYSE/NASDAQ/ADR (ej: "AMD", "GGAL", "YPF")
- "category": sector del ticker (ej: "Semiconductores/IA", "Banca US", "Energía/Oil", "Argentina/CEDEARs")
- "direction": "positive" | "negative"
- "impact": "direct" (el evento afecta directamente a esta empresa) | "indirect" (efecto de segundo orden)
- "reason": una oración explicando la cadena causal

Reglas:
- Sé específico: nombrá tickers concretos, no sectores genéricos
- Incluí efectos de segundo orden: si AMD supera earnings → NVDA se beneficia por validación de demanda IA
- Incluí impactos negativos: si AMD gana market share → INTC sufre
- Vinculá eventos relacionados en "relatedEventIds" (ej: Fed + CPI son eventos relacionados de Política Monetaria)
- Máximo 6 tickers por evento
- Solo tickers con impacto claro y justificable

Respondé SOLO con JSON válido:
{"events": [{"id": "evt_1", "relatedEventIds": [], "chains": [...]}]}`;

interface RawEvent {
  id: string;
  event: string;
  category: string;
  magnitude: string;
}

interface RawChain {
  ticker: string;
  category: string;
  direction: string;
  impact: string;
  reason: string;
}

interface RawChainEvent {
  id: string;
  relatedEventIds: string[];
  chains: RawChain[];
}

export async function runMacroIntelligence(headlines: string[]): Promise<MacroEventRow[]> {
  if (headlines.length === 0) return [];

  // Paso 1: Extract macro events
  const headlinesBlock = headlines.slice(0, 40).map((h, i) => `${i + 1}. ${h}`).join('\n');
  let rawEvents: RawEvent[] = [];

  try {
    const paso1 = await callAI('reasoning', `TITULARES DEL DÍA:\n${headlinesBlock}`, EVENT_EXTRACTION_PROMPT, 2048);
    const parsed = JSON.parse(paso1);
    rawEvents = Array.isArray(parsed.events) ? parsed.events : [];
    console.log(`[macro-intelligence] Paso 1: ${rawEvents.length} eventos extraídos`);
  } catch (err) {
    console.warn('[macro-intelligence] Paso 1 falló:', (err as Error).message?.slice(0, 100));
    return [];
  }

  if (rawEvents.length === 0) return [];

  // Paso 2: Reason causal chains
  const eventsBlock = rawEvents.map(e =>
    `${e.id}: [${e.category}] ${e.event} (magnitud: ${e.magnitude})`
  ).join('\n');

  let rawChainEvents: RawChainEvent[] = [];

  try {
    const paso2 = await callAI('reasoning', `EVENTOS MACRO DE HOY:\n${eventsBlock}`, CAUSAL_CHAINS_PROMPT, 4096);
    const parsed = JSON.parse(paso2);
    rawChainEvents = Array.isArray(parsed.events) ? parsed.events : [];
    console.log(`[macro-intelligence] Paso 2: cadenas causales para ${rawChainEvents.length} eventos`);
  } catch (err) {
    console.warn('[macro-intelligence] Paso 2 falló:', (err as Error).message?.slice(0, 100));
    return [];
  }

  // Merge paso1 metadata with paso2 chains
  const chainMap = new Map<string, RawChainEvent>(rawChainEvents.map(e => [e.id, e]));

  const events: MacroEventRow[] = rawEvents.map(evt => {
    const chainEvt = chainMap.get(evt.id);
    return {
      eventId: evt.id,
      event: evt.event,
      category: evt.category,
      magnitude: (['high', 'medium', 'low'].includes(evt.magnitude) ? evt.magnitude : 'medium') as 'high' | 'medium' | 'low',
      relatedEventIds: chainEvt?.relatedEventIds ?? [],
      chains: (chainEvt?.chains ?? [])
        .filter(c => c.ticker && c.direction && c.impact)
        .map(c => ({
          eventId: evt.id,
          ticker: c.ticker.trim().toUpperCase(),
          category: c.category ?? 'General',
          direction: (c.direction === 'positive' || c.direction === 'negative' ? c.direction : 'positive') as 'positive' | 'negative',
          impact: (c.impact === 'direct' || c.impact === 'indirect' ? c.impact : 'indirect') as 'direct' | 'indirect',
          reason: c.reason ?? '',
        })),
    };
  });

  // Anclaje anti-alucinación: el LLM inventa tickers. Validamos contra Yahoo y descartamos
  // las cadenas cuyo ticker no existe (era el peor ofensor, ~52% de acierto medido).
  const allTickers = [...new Set(events.flatMap(e => e.chains.map(c => c.ticker)))];
  const valid = new Set(await validateTickers(allTickers));
  const dropped = allTickers.length - valid.size;
  if (dropped > 0) console.log(`[macro-intelligence] ${dropped} tickers inválidos descartados (Yahoo)`);
  for (const e of events) e.chains = e.chains.filter(c => valid.has(c.ticker));

  return events;
}
