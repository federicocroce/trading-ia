import { describe, it, expect } from 'vitest';
import { validateThesis, type RawThesis } from './thesis-validator.js';

const NARRATIVE_ALCISTA =
  'La Fed viene señalando una pausa prolongada en el ciclo de tasas y el mercado de bonos ya empezó ' +
  'a descontar recortes hacia fin de año, lo que favorece a los bancos con mayor sensibilidad a la curva ' +
  'de rendimientos y a la reactivación del crédito.';

const NARRATIVE_BAJISTA =
  'La oferta de crudo de shale en Estados Unidos volvió a niveles récord mientras la demanda global se ' +
  'desacelera por el enfriamiento industrial en China, generando un desbalance estructural que presiona ' +
  'los precios a la baja durante los próximos trimestres.';

function validRawAlcista(): RawThesis {
  return {
    title: 'Bancos US: giro de tasas',
    direction: 'alcista',
    narrative: NARRATIVE_ALCISTA,
    catalyst: 'Recorte de tasas de la Fed en septiembre',
    primarySymbol: 'JPM',
    symbols: ['JPM', 'BAC', 'XLF'],
    entryConditionText: 'Ruptura de máximos de 3 meses con volumen',
    entryTriggerPrice: 205,
    entryComparator: 'above',
    invalidationPrice: 180,
    invalidationReason: 'Pérdida del soporte de 180 invalida la tesis de reflación bancaria',
    horizonDays: 30,
  };
}

function validRawBajista(): RawThesis {
  return {
    title: 'Petróleo: sobreoferta estructural',
    direction: 'bajista',
    narrative: NARRATIVE_BAJISTA,
    catalyst: null,
    primarySymbol: 'USO',
    symbols: ['USO', 'XLE'],
    entryConditionText: 'Ruptura de mínimos de 6 meses',
    entryTriggerPrice: 68,
    entryComparator: 'below',
    invalidationPrice: 82,
    invalidationReason: 'Recuperación sobre 82 invalida la tesis de sobreoferta',
    horizonDays: 45,
  };
}

function omit<T extends Record<string, unknown>>(obj: T, key: keyof T): Record<string, unknown> {
  const clone: Record<string, unknown> = { ...obj };
  delete clone[key as string];
  return clone;
}

describe('validateThesis — happy paths', () => {
  it('acepta una tesis alcista válida y devuelve el ValidThesis normalizado', () => {
    const livePrices = new Map([['JPM', 200]]);
    const result = validateThesis(validRawAlcista(), livePrices);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.thesis.primarySymbol).toBe('JPM');
      expect(result.thesis.direction).toBe('alcista');
      expect(result.thesis.entryTriggerPrice).toBe(205);
      expect(result.thesis.invalidationPrice).toBe(180);
      expect(result.thesis.symbols).toEqual(['JPM', 'BAC', 'XLF']);
    }
  });

  it('acepta una tesis bajista válida (catalyst null permitido) y devuelve el ValidThesis normalizado', () => {
    const livePrices = new Map([['USO', 75]]);
    const result = validateThesis(validRawBajista(), livePrices);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.thesis.direction).toBe('bajista');
      expect(result.thesis.catalyst).toBeNull();
      expect(result.thesis.entryComparator).toBe('below');
    }
  });
});

describe('validateThesis — grupo 1: campos obligatorios', () => {
  it('rechaza cuando falta cualquier campo requerido, nombrando el campo en el motivo', () => {
    const requiredFields: (keyof RawThesis)[] = [
      'title', 'direction', 'narrative', 'primarySymbol', 'symbols',
      'entryConditionText', 'entryTriggerPrice', 'entryComparator',
      'invalidationPrice', 'invalidationReason', 'horizonDays',
    ];
    const livePrices = new Map([['JPM', 200]]);

    for (const field of requiredFields) {
      const raw = omit(validRawAlcista() as unknown as Record<string, unknown>, field);
      const result = validateThesis(raw, livePrices);
      expect(result.ok, `campo faltante: ${String(field)}`).toBe(false);
      if (!result.ok) {
        expect(result.reason, `reason debe nombrar el campo ${String(field)}`).toMatch(new RegExp(String(field), 'i'));
      }
    }
  });
});

describe('validateThesis — grupo 2: enums y horizonDays', () => {
  it('rechaza direction inválida, entryComparator inválido y horizonDays fuera de 5-120 o no entero', () => {
    const livePrices = new Map([['JPM', 200]]);

    const badDirection = validateThesis({ ...validRawAlcista(), direction: 'neutral' }, livePrices);
    expect(badDirection.ok).toBe(false);
    if (!badDirection.ok) expect(badDirection.reason).toMatch(/direction/i);

    const badComparator = validateThesis({ ...validRawAlcista(), entryComparator: 'equals' }, livePrices);
    expect(badComparator.ok).toBe(false);
    if (!badComparator.ok) expect(badComparator.reason).toMatch(/comparator/i);

    const horizonTooLow = validateThesis({ ...validRawAlcista(), horizonDays: 3 }, livePrices);
    expect(horizonTooLow.ok).toBe(false);
    if (!horizonTooLow.ok) expect(horizonTooLow.reason).toMatch(/horizon/i);

    const horizonTooHigh = validateThesis({ ...validRawAlcista(), horizonDays: 200 }, livePrices);
    expect(horizonTooHigh.ok).toBe(false);
    if (!horizonTooHigh.ok) expect(horizonTooHigh.reason).toMatch(/horizon/i);

    const horizonNotInteger = validateThesis({ ...validRawAlcista(), horizonDays: 30.5 }, livePrices);
    expect(horizonNotInteger.ok).toBe(false);
    if (!horizonNotInteger.ok) expect(horizonNotInteger.reason).toMatch(/horizon/i);
  });
});

describe('validateThesis — grupo 3: coherencia de niveles vs precio vivo', () => {
  it('rechaza invalidationPrice del lado equivocado y entryTriggerPrice fuera de ±25%', () => {
    const livePrices = new Map([['JPM', 200], ['USO', 75]]);

    // alcista: invalidationPrice debe ser < precio vivo
    const alcistaInvalidMal = validateThesis({ ...validRawAlcista(), invalidationPrice: 210 }, livePrices);
    expect(alcistaInvalidMal.ok).toBe(false);
    if (!alcistaInvalidMal.ok) expect(alcistaInvalidMal.reason).toMatch(/invalidaci[oó]n/i);

    // bajista: invalidationPrice debe ser > precio vivo
    const bajistaInvalidMal = validateThesis({ ...validRawBajista(), invalidationPrice: 70 }, livePrices);
    expect(bajistaInvalidMal.ok).toBe(false);
    if (!bajistaInvalidMal.ok) expect(bajistaInvalidMal.reason).toMatch(/invalidaci[oó]n/i);

    // trigger a 3x el precio (alucinación de niveles) — fuera de ±25%
    const triggerLejosAlcista = validateThesis({ ...validRawAlcista(), entryTriggerPrice: 600 }, livePrices);
    expect(triggerLejosAlcista.ok).toBe(false);
    if (!triggerLejosAlcista.ok) expect(triggerLejosAlcista.reason).toMatch(/trigger|entrada|entry/i);

    const triggerLejosBajista = validateThesis({ ...validRawBajista(), entryTriggerPrice: 5 }, livePrices);
    expect(triggerLejosBajista.ok).toBe(false);
    if (!triggerLejosBajista.ok) expect(triggerLejosBajista.reason).toMatch(/trigger|entrada|entry/i);
  });
});

describe('validateThesis — sin precio vivo del primarySymbol', () => {
  it('rechaza fail-closed cuando no hay precio vivo para primarySymbol', () => {
    const livePrices = new Map<string, number>(); // vacío: JPM no está
    const result = validateThesis(validRawAlcista(), livePrices);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/precio/i);
  });
});

describe('validateThesis — grupo 4: symbols/longitudes', () => {
  it('rechaza primarySymbol fuera de symbols, symbols > 5, title > 120 chars y narrative < 100 chars', () => {
    const livePrices = new Map([['JPM', 200]]);

    const symbolFueraDeLista = validateThesis({ ...validRawAlcista(), symbols: ['BAC', 'XLF'] }, livePrices);
    expect(symbolFueraDeLista.ok).toBe(false);
    if (!symbolFueraDeLista.ok) expect(symbolFueraDeLista.reason).toMatch(/symbol/i);

    const demasiadosSymbols = validateThesis(
      { ...validRawAlcista(), symbols: ['JPM', 'A', 'B', 'C', 'D', 'E'] },
      livePrices,
    );
    expect(demasiadosSymbols.ok).toBe(false);
    if (!demasiadosSymbols.ok) expect(demasiadosSymbols.reason).toMatch(/symbol/i);

    const tituloLargo = validateThesis({ ...validRawAlcista(), title: 'A'.repeat(130) }, livePrices);
    expect(tituloLargo.ok).toBe(false);
    if (!tituloLargo.ok) expect(tituloLargo.reason).toMatch(/title|t[ií]tulo/i);

    const narrativeCorta = validateThesis({ ...validRawAlcista(), narrative: 'Muy corto.' }, livePrices);
    expect(narrativeCorta.ok).toBe(false);
    if (!narrativeCorta.ok) expect(narrativeCorta.reason).toMatch(/narrative|narrativa/i);
  });
});

describe('validateThesis — grupo 5: números no finitos/negativos', () => {
  it('rechaza entryTriggerPrice/invalidationPrice NaN, Infinity o negativos', () => {
    const livePrices = new Map([['JPM', 200]]);

    const nanTrigger = validateThesis({ ...validRawAlcista(), entryTriggerPrice: NaN }, livePrices);
    expect(nanTrigger.ok).toBe(false);

    const infinityInvalidation = validateThesis({ ...validRawAlcista(), invalidationPrice: Infinity }, livePrices);
    expect(infinityInvalidation.ok).toBe(false);

    const negativeTrigger = validateThesis({ ...validRawAlcista(), entryTriggerPrice: -205 }, livePrices);
    expect(negativeTrigger.ok).toBe(false);

    const negativeInvalidation = validateThesis({ ...validRawAlcista(), invalidationPrice: -1 }, livePrices);
    expect(negativeInvalidation.ok).toBe(false);
  });
});
