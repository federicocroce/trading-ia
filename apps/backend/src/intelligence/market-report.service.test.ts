import { describe, it, expect } from 'vitest';
import { moveSellsOutOfTopOpportunities } from './market-report.service.js';

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
