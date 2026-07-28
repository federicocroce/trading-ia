import type {
  Opportunity,
  SignalAction,
  VerdictChain,
  AxisVeto,
  CrossConflict,
  MacroAdjustment,
  PortfolioAdjustment,
} from '@trading/shared';

/**
 * Aplica vetos por eje: si un eje individual está en zona extrema crítica,
 * sobreescribe la acción aunque el composite diga otra cosa. Esto evita
 * que un BUY salga con sentiment -65 solo porque tech+fund compensaron.
 */
export function applyAxisVetos(
  baseAction: SignalAction,
  techScore: number,
  fundScore: number,
  sentScore: number,      // -1..+1
  evidenceScore: number,  // -100..+100
  inPortfolio: boolean,
): { action: SignalAction; veto?: AxisVeto } {
  const sentScaled = sentScore * 100;  // -100..+100 para comparar

  // Veto 1: sentimiento crítico → no BUY (mantener WATCH o SELL si está en portfolio)
  if (sentScaled <= -60 && baseAction === 'BUY') {
    return {
      action: inPortfolio ? 'HOLD' : 'WATCH',
      veto: {
        type: 'sentiment-extreme-negative',
        axis: 'sentiment',
        value: sentScaled,
        threshold: -60,
        forcedAction: inPortfolio ? 'HOLD' : 'WATCH',
        reason: `Sentimiento crítico (${sentScaled.toFixed(0)}/100). No entrar aunque el composite sea favorable — riesgo de seguir cayendo por flujo de noticias.`,
      },
    };
  }

  // Veto 2: fundamentales débiles + técnico no fuerte → no BUY
  if (fundScore <= -40 && techScore < 40 && baseAction === 'BUY') {
    return {
      action: 'WATCH',
      veto: {
        type: 'fundamental-weak-with-tech-flat',
        axis: 'fundamental',
        value: fundScore,
        threshold: -40,
        forcedAction: 'WATCH',
        reason: `Fundamentales muy débiles (${fundScore}) y técnico sin confirmación fuerte (${techScore}). Esperar setup técnico más claro antes de entrar.`,
      },
    };
  }

  // Veto 3: técnico extremo bearish + no en portfolio → no BUY
  if (techScore <= -50 && baseAction === 'BUY' && !inPortfolio) {
    return {
      action: 'WATCH',
      veto: {
        type: 'technical-extreme-bearish',
        axis: 'technical',
        value: techScore,
        threshold: -50,
        forcedAction: 'WATCH',
        reason: `Técnico extremo bearish (${techScore}). No anticipar reversión sin confirmación de precio.`,
      },
    };
  }

  // Veto 4: evidence dominante bearish (-50 o menos) + BUY → degradar a WATCH
  if (evidenceScore <= -50 && baseAction === 'BUY') {
    return {
      action: 'WATCH',
      veto: {
        type: 'evidence-bearish-with-bull-bias',
        axis: 'evidence',
        value: evidenceScore,
        threshold: -50,
        forcedAction: 'WATCH',
        reason: `Evidence empírica bearish (${evidenceScore}). Probable insider selling o flujo de puts dominante — esperar limpieza de la señal.`,
      },
    };
  }

  return { action: baseAction };
}

/**
 * Detecta conflictos cross-dimensión que indican setups peligrosos o
 * complementarios. No reemplaza la detección intra-técnica de signal-conflicts;
 * la complementa con la vista 4D.
 */
export function detectCrossConflicts(
  techScore: number,
  fundScore: number,
  sentScore: number,      // -1..+1
  evidenceScore: number,  // -100..+100
): CrossConflict[] {
  const conflicts: CrossConflict[] = [];
  const sentScaled = sentScore * 100;

  // 1. Value trap: técnico bullish pero fundamental débil
  if (techScore >= 40 && fundScore <= -30) {
    conflicts.push({
      type: 'tech-bull-vs-fund-weak',
      severity: techScore >= 60 ? 'high' : 'medium',
      axes: ['technical', 'fundamental'],
      explanation: `Precio sube (tech ${techScore}) pero fundamentales débiles (fund ${fundScore}). Posible value trap o rally técnico sin sustento.`,
      suggestion: 'Operar solo con stops ajustados. No mantener swing largo. Re-evaluar si rompe SMA50.',
    });
  }

  // 2. Hype sin confirmación: sentimiento positivo pero técnico bearish
  if (sentScaled >= 40 && techScore <= -20) {
    conflicts.push({
      type: 'sent-bull-vs-tech-bear',
      severity: 'medium',
      axes: ['sentiment', 'technical'],
      explanation: `Noticias positivas (sent +${sentScaled.toFixed(0)}) pero precio en tendencia bajista (tech ${techScore}). Hype sin confirmación del tape — riesgo de fade.`,
      suggestion: 'Esperar a que el precio confirme. No comprar el rumor.',
    });
  }

  // 3. Posible bottom fishing: fundamental fuerte pero técnico débil
  if (fundScore >= 40 && techScore <= -20) {
    conflicts.push({
      type: 'fund-strong-vs-tech-bear',
      severity: 'low',
      axes: ['fundamental', 'technical'],
      explanation: `Empresa sólida (fund ${fundScore}) en zona técnica débil (tech ${techScore}). Oportunidad de acumulación si confirma reversión.`,
      suggestion: 'Esperar divergencia alcista + ruptura de resistencia clave antes de comprar.',
    });
  }

  // 4. Smart money antes del precio: evidence fuerte pero técnico aún bearish
  if (evidenceScore >= 30 && techScore <= -20) {
    conflicts.push({
      type: 'evidence-bull-vs-tech-bear',
      severity: evidenceScore >= 50 ? 'high' : 'medium',
      axes: ['evidence', 'technical'],
      explanation: `Insider/options flow alcistas (evidence +${evidenceScore}) pero precio aún bajista (tech ${techScore}). Smart money parece entrar antes que el tape — anticipo posible.`,
      suggestion: 'Posición chica especulativa. Stop debajo del mínimo reciente. Confirmar con volumen.',
    });
  }

  return conflicts;
}

/**
 * Convierte algoAction (post-vetos) + smartAction (post-divergencias) +
 * llmAction (Stage 5b opcional) en una sola VerdictChain trazable.
 * Cada capa sobreescribe a la anterior con justificación.
 */
export function resolveFinalVerdict(opts: {
  algoAction: SignalAction;
  algoScore: number;
  smartAction: SignalAction;
  smartReason?: string;
  llmAction?: SignalAction;
  llmReason?: string;
  veto?: AxisVeto;
  portfolioAdjustment?: PortfolioAdjustment;
}): VerdictChain {
  const { algoAction, algoScore, smartAction, smartReason, llmAction, llmReason, veto, portfolioAdjustment } = opts;

  const trace: string[] = [];
  trace.push(`algo:${algoAction}(${algoScore})`);

  let source: 'algo' | 'smart' | 'llm' = 'algo';
  let finalAction: SignalAction = algoAction;

  if (veto) {
    trace.push(`veto:${veto.forcedAction}(${veto.axis}=${veto.value.toFixed(0)})`);
    finalAction = veto.forcedAction;
    source = 'algo'; // veto se considera parte de la capa algorítmica
  }

  // Capa cartera: informativa en el trace. El delta ya se aplicó al composite en
  // buildAlgorithmicOpportunity, así que no toca finalAction/source aquí.
  if (portfolioAdjustment && portfolioAdjustment.verdict !== 'neutral') {
    const sign = portfolioAdjustment.rawDelta >= 0 ? '+' : '';
    trace.push(
      `portfolio:${portfolioAdjustment.verdict} ` +
      `(${portfolioAdjustment.reason.replace(/\.$/, '')}) ` +
      `Δ${sign}${portfolioAdjustment.rawDelta}×${portfolioAdjustment.intensity}=${portfolioAdjustment.delta}`,
    );
  }

  if (smartAction !== finalAction) {
    const gatedSmart = applySmartAction(finalAction, smartAction) as SignalAction;
    if (gatedSmart !== finalAction) {
      trace.push(`smart:${smartAction}${smartReason ? ` (${smartReason.slice(0, 60)})` : ''}`);
      finalAction = gatedSmart;
      source = 'smart';
    } else {
      trace.push(`smart:sugirió ${smartAction} — bloqueado (solo degrada)`);
    }
  }

  if (llmAction && llmAction !== finalAction) {
    // Defensa en profundidad: el LLM solo puede degradar, nunca subir la acción.
    const gated = applyLlmAction(finalAction, llmAction) as SignalAction;
    if (gated !== finalAction) {
      trace.push(`llm:${llmAction}${llmReason ? ` (${llmReason.slice(0, 60)})` : ''}`);
      finalAction = gated;
      source = 'llm';
    } else {
      trace.push(`llm:sugirió ${llmAction} — bloqueado (solo degrada)`);
    }
  } else if (llmAction) {
    trace.push(`llm:confirma`);
  }

  return {
    finalAction,
    layers: {
      algoAction,
      algoScore,
      smartAction,
      smartReason,
      llmAction,
      llmReason,
    },
    trace,
    source,
  };
}

/**
 * Calcula ajuste macro al composite a partir de causal chains.
 * Direct positive = +5, indirect positive = +2, direct negative = -5,
 * indirect negative = -2. Cap a ±15.
 */
export function computeMacroAdjustment(
  symbol: string,
  causalChains: Array<{
    eventId: string;
    event?: string;
    ticker: string;
    category: string;
    direction: 'positive' | 'negative';
    impact: 'direct' | 'indirect';
  }>,
): MacroAdjustment | undefined {
  const relevant = causalChains.filter(c => c.ticker.toUpperCase() === symbol.toUpperCase());
  if (relevant.length === 0) return undefined;

  let delta = 0;
  const drivers: MacroAdjustment['drivers'] = [];

  for (const chain of relevant) {
    const sign = chain.direction === 'positive' ? 1 : -1;
    const weight = chain.impact === 'direct' ? 5 : 2;
    delta += sign * weight;
    drivers.push({
      eventId: chain.eventId,
      event: chain.event ?? chain.eventId,
      category: chain.category,
      direction: chain.direction,
      impact: chain.impact,
    });
  }

  if (delta > 15) delta = 15;
  if (delta < -15) delta = -15;

  return { delta, drivers };
}

/**
 * Orden de "bullishness" de las acciones. El LLM (capa narrativa) solo puede
 * DEGRADAR la acción algorítmica hacia menos alcista — nunca subirla. Un modelo
 * entusiasmado con una narrativa no puede convertir WATCH en COMPRAR (caso SDOT).
 */
const ACTION_BULLISH_RANK: Record<string, number> = { SELL: 0, WATCH: 1, HOLD: 2, BUY: 3 };

export function applyLlmAction(algoAction: string, llmAction: string): string {
  const algoRank = ACTION_BULLISH_RANK[algoAction];
  const llmRank = ACTION_BULLISH_RANK[llmAction];
  if (algoRank === undefined || llmRank === undefined) return algoAction;
  return llmRank < algoRank ? llmAction : algoAction;
}

/** ¿La capa `smart` puede SUBIR la acción? Apagado por default — ver applySmartAction. */
export function smartUpgradeEnabled(): boolean {
  return process.env.SMART_CAN_UPGRADE?.trim() === '1';
}

/**
 * Gate de la capa `smart` (divergencias técnicas), simétrico al del LLM.
 *
 * ⚠️ AGREGADO 2026-07-28 tras el review adversarial. La regla dura #2 gatea al LLM y ese
 * gate funciona bien — pero `smart` reemplazaba el veredicto SIN restricción:
 *   `if (smartAction !== finalAction) finalAction = smartAction`
 * En los datos había **9 subidas WATCH→BUY**, la más reciente 5 días antes del hallazgo.
 * Es el patrón del caso SDOT entrando por otra puerta: una capa entusiasmada convirtiendo
 * "mirar" en "comprar". Y está prácticamente sin medir — solo 10 de 37 veredictos `smart`
 * tienen alpha calculado, así que no hay evidencia de que la subida pague.
 *
 * Degradar sigue libre (dirección segura). Subir queda bloqueado por default y detrás de
 * `SMART_CAN_UPGRADE=1`, para poder re-habilitarlo y medirlo en vez de perder la capacidad.
 */
export function applySmartAction(algoAction: string, smartAction: string): string {
  const algoRank = ACTION_BULLISH_RANK[algoAction];
  const smartRank = ACTION_BULLISH_RANK[smartAction];
  if (algoRank === undefined || smartRank === undefined) return algoAction;
  if (smartRank < algoRank) return smartAction;           // degrada: siempre
  return smartUpgradeEnabled() ? smartAction : algoAction; // sube: solo con la flag
}
