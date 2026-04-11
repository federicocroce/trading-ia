import type { TechnicalIndicators, SignalConflict, TimingTrigger } from '@trading/shared';

/**
 * Detecta contradicciones entre indicadores técnicos y sentimiento.
 * Cada conflicto incluye una explicación en lenguaje accesible.
 */
export function detectSignalConflicts(
  ind: TechnicalIndicators,
  sentiment?: { score: number },
  options?: {
    weeklyDivergences?: Array<{ type: 'bullish' | 'bearish'; indicator: string }>;
    earningsInDays?: number | null;
    sectorSentiment?: number | null;
    timingTriggers?: TimingTrigger[];
    baseAction?: 'BUY' | 'SELL' | 'HOLD' | 'WATCH';
  },
): SignalConflict[] {
  const { weeklyDivergences, earningsInDays, sectorSentiment, timingTriggers, baseAction } = options ?? {};
  const conflicts: SignalConflict[] = [];

  // 1. BB Squeeze + OBV Divergencia bajista
  if (ind.bbSqueeze && ind.bbSqueezeIntensity && ind.bbSqueezeIntensity > 60 && ind.obvDivergence) {
    const squeezeBullish = ind.priceVsSma20 > 0;
    const obvBearish = ind.obvTrend === 'falling';

    if (squeezeBullish && obvBearish) {
      conflicts.push({
        signalA: `BB Squeeze (intensidad ${ind.bbSqueezeIntensity.toFixed(0)}%)`,
        signalB: 'OBV en distribucion',
        directionA: 'bullish',
        directionB: 'bearish',
        explanation: 'Las Bandas de Bollinger estan comprimidas como un resorte — sugiere un movimiento fuerte pronto. Pero el OBV muestra que los grandes jugadores estan vendiendo en la suba. Estas senales se CONTRADICEN: una dice "va a explotar al alza", la otra dice "la suba es falsa". Cuando las senales pelean, mejor esperar confirmacion con volumen.',
        implication: 'wait',
      });
    } else if (!squeezeBullish && ind.obvTrend === 'rising') {
      conflicts.push({
        signalA: `BB Squeeze bajista (intensidad ${ind.bbSqueezeIntensity.toFixed(0)}%)`,
        signalB: 'OBV en acumulacion',
        directionA: 'bearish',
        directionB: 'bullish',
        explanation: 'El squeeze de Bollinger apunta a la baja, pero el volumen muestra acumulacion — alguien esta comprando en silencio. La caida podria ser una trampa antes de un rebote. Cautela: no vendas en panico si el OBV no confirma la caida.',
        implication: 'caution',
      });
    }
  }

  // 2. RSI Sobreventa + Death Cross
  if (ind.rsi14 != null && ind.rsi14 < 30 && ind.crossovers?.deathCross) {
    conflicts.push({
      signalA: `RSI en sobreventa (${ind.rsi14.toFixed(0)})`,
      signalB: 'Death Cross activo (SMA50 < SMA200)',
      directionA: 'bullish',
      directionB: 'bearish',
      explanation: 'El RSI dice que el precio esta "barato" y deberia rebotar. Pero el cruce de medias (Death Cross) indica que la tendencia de fondo giro a bajista. Cuidado: que algo este barato no significa que no pueda seguir bajando. Espera a que el RSI empiece a subir antes de entrar.',
      implication: 'wait',
    });
  }

  // 3. MACD Alcista + Precio debajo de SMA200
  if (ind.macd && ind.macd.histogram > 0 && ind.priceVsSma200 < -5) {
    conflicts.push({
      signalA: 'MACD positivo (momentum corto plazo)',
      signalB: `Precio ${Math.abs(ind.priceVsSma200).toFixed(1)}% debajo de SMA200`,
      directionA: 'bullish',
      directionB: 'bearish',
      explanation: 'El MACD muestra que el momentum de corto plazo esta mejorando — el precio intenta recuperarse. Pero sigue lejos de la media de 200 dias, lo que indica que la tendencia de fondo es bajista. Puede ser un rebote tecnico dentro de una caida mayor. Confirma con volumen antes de entrar.',
      implication: 'caution',
    });
  }

  // 4. Stochastic Sobrecompra + MACD Alcista fuerte
  if (ind.stochastic && ind.stochastic.k > 80 && ind.stochastic.k < ind.stochastic.d
      && ind.macd && ind.macd.histogram > 0) {
    conflicts.push({
      signalA: 'Stochastic en sobrecompra con cruce bajista',
      signalB: 'MACD con histograma positivo',
      directionA: 'bearish',
      directionB: 'bullish',
      explanation: 'El Stochastic dice que el precio ya subio demasiado rapido y esta por corregir. Pero el MACD dice que el momentum sigue siendo positivo. Puede ser una pausa temporal dentro de una tendencia alcista, o el inicio de una correccion. Precaucion en la entrada.',
      implication: 'caution',
    });
  }

  // 5. Alto volumen + OBV en distribución
  if (ind.volumeRatio > 1.5 && ind.obvTrend === 'falling' && ind.priceVsSma20 > 0) {
    conflicts.push({
      signalA: `Volumen alto (${ind.volumeRatio.toFixed(1)}x promedio)`,
      signalB: 'OBV cayendo (distribucion)',
      directionA: 'bullish',
      directionB: 'bearish',
      explanation: 'Hay mucho volumen, lo que normalmente confirma un movimiento. Pero el OBV muestra distribucion — el precio sube pero los grandes estan vendiendo. Volumen alto + distribucion = posible techo. Los institucionales podrian estar saliendo mientras el retail compra.',
      implication: 'caution',
    });
  }

  // 6. Técnico positivo + Sentimiento negativo (o viceversa)
  if (sentiment) {
    const techPositive = ind.rsi14 != null && ind.rsi14 < 40 && ind.macd && ind.macd.histogram > 0;
    const techNegative = ind.rsi14 != null && ind.rsi14 > 65 && ind.macd && ind.macd.histogram < 0;
    const sentNegative = sentiment.score < -0.3;
    const sentPositive = sentiment.score > 0.3;

    if (techPositive && sentNegative) {
      conflicts.push({
        signalA: 'Tecnico positivo (RSI bajo + MACD mejorando)',
        signalB: 'Noticias negativas',
        directionA: 'bullish',
        directionB: 'bearish',
        explanation: 'Los graficos dicen que es momento de comprar — precio castigado con momentum mejorando. Pero las noticias son negativas. A veces el mercado se adelanta a las noticias (compra en el miedo), pero a veces las malas noticias siguen pesando. Si las noticias son de corto plazo (resultados trimestrales), el tecnico suele ganar. Si son estructurales (regulacion, deuda), cuidado.',
        implication: 'caution',
      });
    } else if (techNegative && sentPositive) {
      conflicts.push({
        signalA: 'Tecnico debil (RSI alto + MACD negativo)',
        signalB: 'Noticias positivas',
        directionA: 'bearish',
        directionB: 'bullish',
        explanation: 'Las noticias son positivas pero el grafico muestra debilidad — el precio esta sobrecomprado y perdiendo momentum. Las buenas noticias ya podrian estar "descontadas" en el precio. No compres solo porque las noticias son buenas si el tecnico no acompana.',
        implication: 'wait',
      });
    }
  }

  // 7. Weekly divergence vs Daily signal alignment
  // Weekly bearish divergence but daily MACD positive → the weekly timeframe dominates for swing
  if (ind.macd && ind.macd.histogram > 0) {
    // We need weekly divergence info — check via additional parameter
    if (weeklyDivergences && weeklyDivergences.some(d => d.type === 'bearish')) {
      conflicts.push({
        signalA: 'MACD diario positivo (momentum corto plazo)',
        signalB: 'Divergencia bajista semanal',
        directionA: 'bullish',
        directionB: 'bearish',
        explanation: 'El MACD diario muestra momentum positivo — en el corto plazo parece que sube. Pero el grafico semanal tiene una divergencia bajista, que es una senal mas pesada y confiable. Para swing trading, el semanal manda. Es como un rio que parece calmo en la superficie pero tiene corriente fuerte abajo. Precaucion: no compres guiandote solo por el diario.',
        implication: 'wait',
      });
    }
  }

  // 8. Earnings proximity conflict — buying right before earnings is risky
  if (earningsInDays != null && earningsInDays >= 0 && earningsInDays <= 14) {
    const techBullish = ind.rsi14 != null && ind.rsi14 < 40 && ind.macd && ind.macd.histogram > 0;
    if (techBullish) {
      conflicts.push({
        signalA: 'Tecnico positivo (RSI bajo + MACD mejorando)',
        signalB: `Earnings en ${earningsInDays} dias`,
        directionA: 'bullish',
        directionB: 'bearish',
        explanation: `El tecnico dice que es momento de comprar — precio castigado con momentum mejorando. Pero los earnings estan a ${earningsInDays} dias, lo que significa alta volatilidad. Un mal reporte puede abrir con un gap de -10% que ningun stop te protege. Si vas a entrar, hacelo con posicion chica o espera al reporte.`,
        implication: 'caution',
      });
    }
  }

  // 9. Death Cross inminente (≤5 días) mientras la señal base es BUY
  if (timingTriggers && (baseAction === 'BUY' || ind.rsi14 == null || ind.rsi14 > 40)) {
    const deathCrossTrigger = timingTriggers.find(
      t => t.type === 'sma_cross' && t.description.includes('Death Cross') && t.impact === 'high',
    );
    if (deathCrossTrigger) {
      const days = deathCrossTrigger.estimatedDays;
      const label = days === 0 ? 'ya ocurrió' : `estimado en ~${days} dias`;
      conflicts.push({
        signalA: 'Señal de compra (score alto)',
        signalB: `Death Cross ${label} — SMA50 cruza SMA200 a la baja`,
        directionA: 'bullish',
        directionB: 'bearish',
        explanation: days === 0
          ? 'El Death Cross acaba de ocurrir: la media de 50 días cruzó hacia abajo la de 200 días. Esto confirma que la tendencia de fondo giró a bajista. Aunque los indicadores de corto plazo digan compra, el contexto estructural es negativo. No entrar hasta que el precio recupere la SMA50.'
          : `En ~${days} días la SMA50 va a cruzar la SMA200 hacia abajo (Death Cross), señal bajista de largo plazo. Aunque ahora los indicadores de corto plazo son positivos, entrar justo antes de un Death Cross es de alto riesgo: el precio típicamente cae después del cruce. Esperar a que el cruce ocurra y ver si el precio aguanta o cae más.`,
        implication: days === 0 ? 'wait' : 'caution',
      });
    }
  }

  // 10. Golden Cross inminente mientras la señal base es SELL/bearish
  if (timingTriggers) {
    const goldenCrossTrigger = timingTriggers.find(
      t => t.type === 'sma_cross' && t.description.includes('Golden Cross') && t.impact === 'high',
    );
    if (goldenCrossTrigger && ind.rsi14 != null && ind.rsi14 > 65) {
      const days = goldenCrossTrigger.estimatedDays;
      const label = days === 0 ? 'acaba de ocurrir' : `en ~${days} dias`;
      conflicts.push({
        signalA: `RSI en ${ind.rsi14.toFixed(0)} — zona de sobrecompra`,
        signalB: `Golden Cross ${label} — señal alcista estructural`,
        directionA: 'bearish',
        directionB: 'bullish',
        explanation: `El RSI está alto y sugiere corrección, pero el Golden Cross (${label}) es una señal alcista estructural fuerte. Puede que el precio corrija levemente antes de continuar la tendencia alcista. No vender apresurado: el Golden Cross suele sostener el precio en correcciones.`,
        implication: 'caution',
      });
    }
  }

  // 11. BB Squeeze con dirección bajista + señal BUY
  if (timingTriggers && (baseAction === 'BUY')) {
    const bearishSqueeze = timingTriggers.find(
      t => t.type === 'bb_squeeze' && t.description.includes('bajista'),
    );
    if (bearishSqueeze) {
      conflicts.push({
        signalA: 'Señal de compra (indicadores alcistas)',
        signalB: `Bollinger Squeeze bajista (breakout hacia abajo inminente)`,
        directionA: 'bullish',
        directionB: 'bearish',
        explanation: 'Las Bandas de Bollinger están muy comprimidas y el precio está debajo de la SMA20, lo que sugiere que el breakout cuando salga de la compresión sería hacia abajo. Comprar ahora significa entrar justo antes de una posible caída fuerte. Esperar a que el breakout confirme dirección antes de entrar.',
        implication: 'wait',
      });
    }
  }

  // 12. Timing 'now' / 'soon' SELL mientras acción es BUY — conflicto de timing
  if (timingTriggers) {
    const highImpactSellTriggers = timingTriggers.filter(t =>
      t.impact === 'high' && (
        (t.type === 'rsi_zone' && t.description.includes('sobrecompra')) ||
        (t.type === 'stoch_cross' && t.description.includes('venta')) ||
        (t.type === 'obv_divergence' && t.description.includes('bajista'))
      ),
    );
    const highImpactBuyTriggers = timingTriggers.filter(t =>
      t.impact === 'high' && (
        (t.type === 'rsi_zone' && t.description.includes('sobreventa')) ||
        (t.type === 'stoch_cross' && t.description.includes('compra')) ||
        (t.type === 'obv_divergence' && t.description.includes('alcista'))
      ),
    );
    // Solo marcar como conflicto si hay más triggers de venta que de compra de alto impacto
    if (baseAction === 'BUY' && highImpactSellTriggers.length > highImpactBuyTriggers.length) {
      conflicts.push({
        signalA: 'Score compuesto bullish (indicadores combinados)',
        signalB: `${highImpactSellTriggers.length} trigger(s) de venta de alto impacto en timing`,
        directionA: 'bullish',
        directionB: 'bearish',
        explanation: `El score combinado dice comprar, pero el análisis de timing detecta ${highImpactSellTriggers.length} señal(es) de salida de alta importancia: ${highImpactSellTriggers.map(t => t.description).join('; ')}. El timing y el score se contradicen. Esperar a que el timing acompañe antes de entrar.`,
        implication: 'caution',
      });
    }
  }

  // 14. Sector vs Individual sentiment conflict
  if (sentiment && sectorSentiment != null) {
    const sentPositive = sentiment.score > 0.2;
    const sectorNegative = sectorSentiment < -0.2;
    const sentNegative = sentiment.score < -0.2;
    const sectorPositive = sectorSentiment > 0.2;

    if (sentPositive && sectorNegative) {
      conflicts.push({
        signalA: 'Sentimiento individual positivo',
        signalB: 'Sector con sentimiento negativo',
        directionA: 'bullish',
        directionB: 'bearish',
        explanation: 'Las noticias del activo son positivas, pero el sector en general esta bajo presion negativa. El sector suele arrastrar — es como nadar contra la corriente. El activo puede tener buenas noticias propias, pero si todo el sector cae, es dificil que se desacople. Verifica si la noticia positiva es lo suficientemente fuerte como para romper la tendencia sectorial.',
        implication: 'caution',
      });
    } else if (sentNegative && sectorPositive) {
      conflicts.push({
        signalA: 'Sentimiento individual negativo',
        signalB: 'Sector con sentimiento positivo',
        directionA: 'bearish',
        directionB: 'bullish',
        explanation: 'El activo tiene noticias negativas, pero el sector esta en tendencia positiva. Puede que el activo se recupere arrastrado por el sector, o que las malas noticias individuales sean mas fuertes. Evalua si la noticia negativa es un problema temporal o estructural antes de actuar.',
        implication: 'caution',
      });
    }
  }

  return conflicts;
}
