import { describe, it, expect } from 'vitest';
import { moveSellsOutOfTopOpportunities, hasAllZeroWeights, matchesSourceHeadline, normalizeScenarios } from './market-report.service.js';

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
