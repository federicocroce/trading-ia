import type { PlazaSummary, SecondOrderEffect } from '@trading/shared';
import { SECOND_ORDER_ANALYSIS_PROMPT, SECTOR_CORRELATIONS } from '@trading/shared';
import { askLMStudio } from '../shared/lmstudio.js';

// --- JSON extraction helper ---

function extractJSON(text: string): string {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();
  const braceStart = text.indexOf('{');
  const braceEnd = text.lastIndexOf('}');
  if (braceStart !== -1 && braceEnd > braceStart) {
    return text.slice(braceStart, braceEnd + 1);
  }
  return text;
}

// --- Build context message for LLM ---

function buildContextMessage(
  plazas: PlazaSummary[],
  topHeadlines: string[],
): string {
  const lines: string[] = [];

  lines.push('=== SENTIMIENTO POR PLAZA ===');
  for (const plaza of plazas) {
    lines.push(`${plaza.label}: ${plaza.overallSentiment} (score: ${plaza.sentimentScore.toFixed(2)})`);
    for (const trend of plaza.symbolTrends.slice(0, 3)) {
      lines.push(`  ${trend.symbol}: ${trend.sentiment} (${trend.sentimentScore.toFixed(2)}, ${trend.newsCount} noticias)`);
    }
  }

  lines.push('');
  lines.push('=== TOP NOTICIAS ===');
  for (const h of topHeadlines.slice(0, 10)) {
    lines.push(`- ${h}`);
  }

  lines.push('');
  lines.push('=== CORRELACIONES CONOCIDAS ===');
  for (const corr of SECTOR_CORRELATIONS) {
    lines.push(`${corr.trigger}: ${corr.from} → ${corr.to.join(', ')} (${corr.direction}, fuerza ${corr.strength})`);
  }

  return lines.join('\n');
}

// --- Fallback: static correlation-based effects ---

function buildStaticEffects(plazas: PlazaSummary[]): SecondOrderEffect[] {
  const effects: SecondOrderEffect[] = [];
  const plazaMap = new Map(plazas.map((p) => [p.plaza, p]));

  for (const corr of SECTOR_CORRELATIONS) {
    const sourcePlaza = plazaMap.get(corr.from);
    if (!sourcePlaza) continue;

    // Only trigger if the source plaza has strong sentiment
    const absScore = Math.abs(sourcePlaza.sentimentScore);
    if (absScore < 0.3) continue;

    const isPositiveSource = sourcePlaza.sentimentScore > 0;
    let impactDirection: SecondOrderEffect['impactDirection'];

    if (corr.direction === 'mixed') {
      impactDirection = 'mixed';
    } else if (
      (corr.direction === 'positive' && isPositiveSource) ||
      (corr.direction === 'negative' && !isPositiveSource)
    ) {
      impactDirection = 'positive';
    } else {
      impactDirection = 'negative';
    }

    // Collect affected tickers from target plazas
    const affectedTickers: string[] = [];
    for (const target of corr.to) {
      const targetPlaza = plazaMap.get(target);
      if (targetPlaza) {
        affectedTickers.push(...targetPlaza.symbolTrends.slice(0, 2).map((t) => t.symbol));
      }
    }

    if (affectedTickers.length === 0) continue;

    const sentimentWord = isPositiveSource ? 'positivo' : 'negativo';
    effects.push({
      triggerEvent: `Sentimiento ${sentimentWord} en ${sourcePlaza.label} (${corr.trigger})`,
      causalChain: [
        `${sourcePlaza.label} muestra sentimiento ${sentimentWord} (score: ${sourcePlaza.sentimentScore.toFixed(2)})`,
        `Correlacion conocida: ${corr.trigger} (fuerza ${corr.strength})`,
        `Impacto ${impactDirection} en ${corr.to.join(', ')}`,
      ],
      affectedTickers: [...new Set(affectedTickers)],
      impactDirection,
      confidence: absScore > 0.5 && corr.strength > 0.6 ? 'high' : 'medium',
      reasoning: `El sentimiento ${sentimentWord} en ${sourcePlaza.label} sugiere un efecto ${impactDirection} en los sectores ${corr.to.join(', ')} basado en la correlacion historica "${corr.trigger}".`,
    });
  }

  // Dedup and limit
  return effects.slice(0, 5);
}

// --- Main analysis function ---

export async function analyzeSecondOrderEffects(
  plazas: PlazaSummary[],
  topHeadlines: string[],
): Promise<SecondOrderEffect[]> {
  // Try LLM first
  try {
    const contextMessage = buildContextMessage(plazas, topHeadlines);
    console.log(`[second-order] Analizando efectos de segundo orden (${contextMessage.length} chars de contexto)`);

    const raw = await askLMStudio(contextMessage, SECOND_ORDER_ANALYSIS_PROMPT, 2048);
    const jsonStr = extractJSON(raw);
    const parsed = JSON.parse(jsonStr);

    if (parsed.effects && Array.isArray(parsed.effects)) {
      const effects: SecondOrderEffect[] = parsed.effects
        .filter((e: Record<string, unknown>) =>
          e.triggerEvent && e.causalChain && e.affectedTickers && e.reasoning,
        )
        .slice(0, 5);

      console.log(`[second-order] LLM identificó ${effects.length} efectos de segundo orden`);
      return effects;
    }
  } catch (err) {
    console.warn(`[second-order] LLM failed: ${(err as Error).message.slice(0, 120)}`);
  }

  // Fallback: static correlation-based effects
  console.log('[second-order] Usando fallback estático basado en correlaciones');
  const staticEffects = buildStaticEffects(plazas);
  console.log(`[second-order] Fallback generó ${staticEffects.length} efectos`);
  return staticEffects;
}
