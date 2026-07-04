import { describe, it, expect } from 'vitest';
import {
  moveSellsOutOfTopOpportunities,
  hasAllZeroWeights,
  matchesSourceHeadline,
  normalizeScenarios,
  computeNoTradeMode,
  computeSuggestedWeight,
  buildConcentrationWarnings,
} from './market-report.service.js';
import type { Opportunity, DigestRecommendation, SignalAction } from '@trading/shared';

describe('moveSellsOutOfTopOpportunities — el digest nunca puede recomendar salir como oportunidad', () => {
  it('caso real NEM: SELL en el scan actual se saca de topOpportunities y pasa a warning con prefijo SALIDA:', () => {
    const topOpportunities = [
      { symbol: 'NEM', action: 'SELL', narrative: 'Rompe soporte clave, momentum negativo.' },
      { symbol: 'NVDA', action: 'BUY', narrative: 'Ruptura alcista con volumen.' },
    ];
    const scanOpportunities = [
      { symbol: 'NEM', action: 'SELL' },
      { symbol: 'NVDA', action: 'BUY' },
    ];

    const { topOpportunities: kept, sellWarnings } = moveSellsOutOfTopOpportunities(topOpportunities, scanOpportunities);

    expect(kept).toHaveLength(1);
    expect(kept[0].symbol).toBe('NVDA');
    expect(sellWarnings).toHaveLength(1);
    expect(sellWarnings[0]).toContain('SALIDA:');
    expect(sellWarnings[0]).toContain('NEM');
    expect(sellWarnings[0]).toContain('Rompe soporte clave');
  });

  it('no toca items cuyo símbolo NO es SELL en el scan actual, aunque el LLM los haya marcado action SELL', () => {
    // El filtro usa el scan real, no lo que diga el propio item del LLM — evita que un item
    // mal etiquetado por el LLM se filtre solo, y evita falsos positivos por símbolos ausentes.
    const topOpportunities = [{ symbol: 'AAPL', action: 'SELL', narrative: 'narrativa del LLM' }];
    const scanOpportunities = [{ symbol: 'AAPL', action: 'BUY' }];

    const { topOpportunities: kept, sellWarnings } = moveSellsOutOfTopOpportunities(topOpportunities, scanOpportunities);

    expect(kept).toHaveLength(1);
    expect(sellWarnings).toHaveLength(0);
  });

  it('sin SELLs en el scan, devuelve la lista intacta', () => {
    const topOpportunities = [{ symbol: 'MSFT', action: 'BUY', narrative: 'n' }];
    const { topOpportunities: kept, sellWarnings } = moveSellsOutOfTopOpportunities(topOpportunities, [{ symbol: 'MSFT', action: 'BUY' }]);
    expect(kept).toEqual(topOpportunities);
    expect(sellWarnings).toEqual([]);
  });
});

describe('hasAllZeroWeights — detecta pesos-fantasma (45% de reports históricos tienen TODOS en 0)', () => {
  it('true cuando todos los weights son 0', () => {
    expect(hasAllZeroWeights([
      { weight: 0 }, { weight: 0 }, { weight: 0 },
    ])).toBe(true);
  });

  it('false cuando al menos un weight es distinto de 0', () => {
    expect(hasAllZeroWeights([
      { weight: 0 }, { weight: 40 }, { weight: 0 },
    ])).toBe(false);
  });

  it('false cuando la distribución está vacía — no hay nada que vaciar', () => {
    expect(hasAllZeroWeights([])).toBe(false);
  });

  it('false cuando distribution es null/undefined', () => {
    expect(hasAllZeroWeights(null)).toBe(false);
    expect(hasAllZeroWeights(undefined)).toBe(false);
  });

  it('trata weight undefined/null como 0 (LLM a veces omite el campo)', () => {
    expect(hasAllZeroWeights([{ weight: undefined as unknown as number }, { weight: null as unknown as number }])).toBe(true);
  });
});

describe('normalizeScenarios — escenarios sin pesos-fantasma', () => {
  it('vacía distribution y agrega distributionNote cuando todos los weights son 0', () => {
    const scenarios = normalizeScenarios([
      {
        name: 'Bull macro',
        probability: 60,
        distribution: [
          { symbol: 'NVDA', weight: 0, reason: 'tech leadership' },
          { symbol: 'TLT', weight: 0, reason: 'rate cuts' },
        ],
      },
      {
        name: 'Bear macro',
        probability: 40,
        distribution: [
          { symbol: 'GLD', weight: 70, reason: 'flight to safety' },
          { symbol: 'VIX', weight: 30, reason: 'vol spike' },
        ],
      },
    ]);

    expect(scenarios[0].distribution).toEqual([]);
    expect(scenarios[0].distributionNote).toBe('sin asignación — el modelo no la produjo');
    // El escenario con pesos reales no se toca (además de la normalización de suma existente).
    expect(scenarios[1].distribution).toHaveLength(2);
    expect(scenarios[1].distributionNote).toBeUndefined();
  });

  it('deja pasar escenarios sin distribution (array vacío) sin agregar la nota', () => {
    const scenarios = normalizeScenarios([
      { name: 'Sin data', probability: 100, distribution: [] },
    ]);
    expect(scenarios[0].distribution).toEqual([]);
    expect(scenarios[0].distributionNote).toBeUndefined();
  });
});

describe('matchesSourceHeadline — anti-hype: topImpactNews debe citar un titular real', () => {
  const provided = [
    'Fed sube tasas 25 bps por sorpresa, mercados caen',
    'NVDA reporta earnings por encima de expectativas',
  ];

  it('matchea cuando sourceHeadline es substring exacto (case-insensitive) de una headline provista', () => {
    expect(matchesSourceHeadline('fed sube tasas 25 bps por sorpresa', provided)).toBe(true);
  });

  it('matchea en la dirección inversa: headline provista es substring del sourceHeadline citado', () => {
    expect(matchesSourceHeadline('Según reporta la prensa: NVDA reporta earnings por encima de expectativas hoy', provided)).toBe(true);
  });

  it('no matchea una cita inventada que no aparece en ninguna headline provista', () => {
    expect(matchesSourceHeadline('El BCRA sube la tasa de referencia al 80%', provided)).toBe(false);
  });

  it('no matchea sourceHeadline vacío o ausente', () => {
    expect(matchesSourceHeadline('', provided)).toBe(false);
    expect(matchesSourceHeadline(undefined, provided)).toBe(false);
    expect(matchesSourceHeadline(null, provided)).toBe(false);
  });

  it('rechaza citas triviales (<15 chars) aunque sean substring de una headline real — "Fed" no identifica una noticia', () => {
    // Sin el guard, "Fed" matchea "Fed sube tasas 25 bps..." y valida cualquier item inventado.
    expect(matchesSourceHeadline('Fed', provided)).toBe(false);
    expect(matchesSourceHeadline('NVDA reporta', provided)).toBe(false); // 12 chars, substring real pero corto
  });

  it('acepta una cita real de 15+ chars que sí identifica la noticia', () => {
    expect(matchesSourceHeadline('NVDA reporta earnings', provided)).toBe(true);
  });
});

// "La paciencia es la posición": si el scan de hoy no deja suficientes setups operables,
// el digest tiene que decirlo — no estirar un pick débil para llenar el widget.
describe('computeNoTradeMode — hoy no se opera cuando faltan setups operables', () => {
  const buyValid = (symbol: string) => ({ symbol, action: 'BUY', tradeLevels: { setupQuality: 'valid' as const } });
  const buyInvalid = (symbol: string) => ({ symbol, action: 'BUY', tradeLevels: { setupQuality: 'invalid' as const } });
  const hold = (symbol: string) => ({ symbol, action: 'HOLD' });

  it('con 1 BUY válido (por debajo del mínimo default de 3) → active true', () => {
    const result = computeNoTradeMode([buyValid('AAPL'), hold('MSFT'), buyInvalid('TSLA')]);
    expect(result.active).toBe(true);
    expect(result.reason).toContain('Solo 1 setup(s) operable(s)');
    expect(result.reason).toContain('watchlist de re-armado');
  });

  it('con 5 BUY válidos (por encima del mínimo) → active false, reason vacío', () => {
    const opps = ['A', 'B', 'C', 'D', 'E'].map(buyValid);
    const result = computeNoTradeMode(opps);
    expect(result.active).toBe(false);
    expect(result.reason).toBe('');
  });

  it('un BUY con setup invalid no cuenta como operable', () => {
    const result = computeNoTradeMode([buyInvalid('AAPL'), buyInvalid('MSFT'), buyInvalid('TSLA')]);
    expect(result.active).toBe(true);
    expect(result.reason).toContain('Solo 0 setup(s) operable(s)');
  });

  it('régimen volátil se menciona en el reason cuando el modo está activo', () => {
    const result = computeNoTradeMode([buyValid('AAPL')], 'volatile');
    expect(result.reason).toContain('en régimen volátil');
  });

  it('régimen no-volátil no agrega la coletilla', () => {
    const result = computeNoTradeMode([buyValid('AAPL')], 'trending_bull');
    expect(result.reason).not.toContain('régimen volátil');
  });

  it('respeta override de NO_TRADE_MIN_SETUPS en runtime (env lazy)', () => {
    const prev = process.env.NO_TRADE_MIN_SETUPS;
    process.env.NO_TRADE_MIN_SETUPS = '2';
    try {
      const result = computeNoTradeMode([buyValid('AAPL'), buyValid('MSFT')]);
      expect(result.active).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.NO_TRADE_MIN_SETUPS;
      else process.env.NO_TRADE_MIN_SETUPS = prev;
    }
  });

  // Dato faltante (sin scan de hoy) ≠ 0 setups (scan real que no encontró ninguno operable).
  // El caller pasa `null` explícito cuando no hay scan — distinto del array vacío real.
  it('sin scan de hoy (opportunities null) → reason honesto de falta de datos, no "0 setups"', () => {
    const result = computeNoTradeMode(null);
    expect(result.active).toBe(true);
    expect(result.reason).toBe('Sin scan de hoy — no hay datos para decidir si se opera.');
    expect(result.reason).not.toContain('setup(s) operable(s)');
  });

  it('scan real con 0 opportunities (array vacío, no null) usa el reason de "0 setups" — sí hubo scan', () => {
    const result = computeNoTradeMode([]);
    expect(result.active).toBe(true);
    expect(result.reason).toContain('Solo 0 setup(s) operable(s)');
  });
});

// Peso sugerido por convicción: un BUY score 90 y un BUY score 63 no son la misma señal
// aunque ambos crucen el gate — graduar en vez de fijar 10 para cualquier BUY.
describe('computeSuggestedWeight — peso graduado por convicción', () => {
  it('BUY con score >= 65 y setup valid → 10', () => {
    expect(computeSuggestedWeight('BUY', { opportunityScore: 65, tradeLevels: { setupQuality: 'valid' } })).toBe(10);
    expect(computeSuggestedWeight('BUY', { opportunityScore: 90, tradeLevels: { setupQuality: 'valid' } })).toBe(10);
  });

  it('BUY con score < 65 → 6', () => {
    expect(computeSuggestedWeight('BUY', { opportunityScore: 64, tradeLevels: { setupQuality: 'valid' } })).toBe(6);
    expect(computeSuggestedWeight('BUY', { opportunityScore: 40, tradeLevels: { setupQuality: 'valid' } })).toBe(6);
  });

  it('BUY con setup invalid → 5 (defensivo, no debería existir post-gate)', () => {
    expect(computeSuggestedWeight('BUY', { opportunityScore: 90, tradeLevels: { setupQuality: 'invalid' } })).toBe(5);
  });

  it('SELL → 0', () => {
    expect(computeSuggestedWeight('SELL', { opportunityScore: 90 })).toBe(0);
  });

  it('HOLD/WATCH → 5', () => {
    expect(computeSuggestedWeight('HOLD', { opportunityScore: 80 })).toBe(5);
    expect(computeSuggestedWeight('WATCH', { opportunityScore: 80 })).toBe(5);
  });

  it('BUY sin match en el scan (sin score) → conservador, 6', () => {
    expect(computeSuggestedWeight('BUY', undefined)).toBe(6);
  });
});

// El aviso de concentración debe medirse sobre lo que el digest EFECTIVAMENTE muestra
// (portfolioRecommendations + marketRecommendations, ya recortadas a sus límites de 12 + 6),
// no sobre el array completo de `opportunities` del scan — bug real: 8/10 scans recientes
// tenían más BUYs que ese límite combinado, y el aviso viejo refería a BUYs que el usuario
// nunca llegaba a ver en pantalla.
describe('buildConcentrationWarnings — mide sobre las recomendaciones mostradas, no sobre el scan completo', () => {
  function opp(symbol: string, sectorLabel: string): Opportunity {
    return { symbol, sectorLabel, action: 'BUY' } as unknown as Opportunity;
  }
  function rec(symbol: string, action: SignalAction = 'BUY'): DigestRecommendation {
    return { symbol, action, reason: '', currentPrice: 1, score: 1 };
  }

  it('ignora BUYs del scan que el límite del digest dejó afuera', () => {
    // 3 BUYs de Energía en el scan, pero solo 2 llegaron al digest (el 3ro no entró por el límite).
    const opportunities = [opp('PAM', 'Energía'), opp('YPF', 'Energía'), opp('VIST', 'Energía')];
    const digestRecs = [rec('PAM'), rec('YPF')]; // VIST no está en lo que el digest muestra
    expect(buildConcentrationWarnings(opportunities, digestRecs)).toEqual([]);
  });

  it('avisa cuando los 3 BUYs concentrados SÍ están entre las recomendaciones mostradas', () => {
    const opportunities = [opp('PAM', 'Energía'), opp('YPF', 'Energía'), opp('VIST', 'Energía'), opp('TSM', 'Tech')];
    const digestRecs = [rec('PAM'), rec('YPF'), rec('VIST'), rec('TSM')];
    const warnings = buildConcentrationWarnings(opportunities, digestRecs);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Energía');
    expect(warnings[0]).toContain('3 de tus 4');
  });

  it('cruza por símbolo (case-insensitive) contra opportunities para obtener sectorLabel — DigestRecommendation no trae sector propio', () => {
    const opportunities = [opp('PAM', 'Argentina/Energía'), opp('YPF', 'Argentina/Energía'), opp('VIST', 'Argentina/Energía')];
    const digestRecs = [rec('pam'), rec('YPF'), rec('vist')];
    const warnings = buildConcentrationWarnings(opportunities, digestRecs);
    expect(warnings[0]).toContain('Argentina/Energía');
  });

  it('fail-closed: una recomendación del digest sin match en opportunities no cuenta para ningún grupo', () => {
    const opportunities = [opp('PAM', 'Energía'), opp('YPF', 'Energía')];
    // VIST está en el digest pero no aparece en `opportunities` — no debería pasar en runtime
    // real (mismo scan), pero si pasa no debe inflar la concentración de Energía a 3.
    const digestRecs = [rec('PAM'), rec('YPF'), rec('VIST')];
    expect(buildConcentrationWarnings(opportunities, digestRecs)).toEqual([]);
  });

  it('sin recomendaciones en el digest, no hay warning aunque el scan tenga concentración', () => {
    const opportunities = [opp('PAM', 'Energía'), opp('YPF', 'Energía'), opp('VIST', 'Energía')];
    expect(buildConcentrationWarnings(opportunities, [])).toEqual([]);
  });
});
