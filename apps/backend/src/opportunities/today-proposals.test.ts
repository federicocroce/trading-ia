import { describe, it, expect } from 'vitest';
import {
  selectTodayProposals,
  verbFor,
  chronicAdjustment,
  chronicThreshold,
  stopBreachAdjustment,
  thesisConflictCaveat,
  stopBreachLookbackDays,
} from './today-proposals.js';

function opp(symbol: string, action: string, score: number) {
  return { symbol, action, opportunityScore: score };
}

describe('selectTodayProposals (misma selección para la vista y el registro)', () => {
  // CAMBIO 2026-07-27 (test de atribución, prompt maestro §4): el ranking por score
  // NO le gana a sortear del mismo universo (A−D: −0.79% t=−1.50 a 7d; −1.48% t=−1.63
  // a 30d) y rankear dentro del piso es significativamente PEOR (E−C: t=−2.22). Por eso
  // desaparecen el orden por score y el corte en 6: mostrar un "top" ordenado comunicaba
  // una jerarquía que la medición dice que no existe. Ahora: todo lo que pasa los filtros,
  // en orden alfabético (neutral por construcción).
  it('filtra a BUY/WATCH, excluye tenidos, y devuelve TODO en orden alfabético', () => {
    const opps = [
      opp('CCC', 'WATCH', 70),
      opp('AAA', 'BUY', 50),
      opp('BBB', 'SELL', 99),   // SELL afuera
      opp('DDD', 'HOLD', 95),   // HOLD afuera
      opp('EEE', 'BUY', 90),    // tenida → afuera
    ];
    const out = selectTodayProposals(opps, new Set(['EEE']));
    expect(out.map((o) => o.symbol)).toEqual(['AAA', 'CCC']);
  });

  it('el orden es alfabético, JAMÁS por score (el score no ordena nada)', () => {
    const opps = [
      opp('ZZZ', 'BUY', 99),
      opp('AAA', 'WATCH', 10),
      opp('MMM', 'BUY', 55),
    ];
    expect(selectTodayProposals(opps, new Set()).map((o) => o.symbol)).toEqual(['AAA', 'MMM', 'ZZZ']);
  });

  it('no hay corte: 10 candidatos elegibles devuelven 10', () => {
    const many = Array.from({ length: 10 }, (_, i) => opp(`S${i}`, 'WATCH', 100 - i));
    expect(selectTodayProposals(many, new Set()).length).toBe(10);
  });

  it('BUY y WATCH conviven en la lista, ordenados solo por símbolo (el verbo los separa después)', () => {
    const opps = [opp('AAA', 'WATCH', 10), opp('BBB', 'BUY', 99)];
    expect(selectTodayProposals(opps, new Set()).map((o) => o.action)).toEqual(['WATCH', 'BUY']);
  });

  it('la exclusión de tenidos es case-insensitive', () => {
    const out = selectTodayProposals([opp('dal', 'BUY', 80)], new Set(['DAL']));
    expect(out).toEqual([]);
  });

  it('devuelve las mismas filas que recibe (genérico, sin remap)', () => {
    const rich = [{ ...opp('AAA', 'BUY', 50), tradeLevels: { entryPrice: 10 } }];
    expect(selectTodayProposals(rich, new Set())[0].tradeLevels.entryPrice).toBe(10);
  });
});

describe('verbFor', () => {
  // El verbo COMPRAR se apagó (sugería fuerza esperada que la medición no sostiene), pero la
  // separación BUY/WATCH se CONSERVA porque es un hecho verificable, no una predicción:
  // BUY = hay setup de entrada válido hoy; WATCH = todavía no. Colapsarlas rotulaba como
  // "operable" a ~99 papeles por scan que no tenían punto de entrada (objetivo #3: cero humo).
  it('BUY tiene setup de entrada → OPERABLE; WATCH todavía no → EN SEGUIMIENTO', () => {
    expect(verbFor('BUY')).toBe('OPERABLE');
    expect(verbFor('WATCH')).toBe('EN SEGUIMIENTO');
  });
});

describe('chronicAdjustment (evidencia: 4ª+ aparición = 40.4% win, −0.05R, n=260)', () => {
  it('debajo del umbral: no toca el verbo ni agrega caveat', () => {
    expect(chronicAdjustment('OPERABLE', 3, 4)).toEqual({ verb: 'OPERABLE' });
  });

  it('en el umbral: OPERABLE pasa a EN ESPERA con caveat que nombra la enésima aparición', () => {
    const adj = chronicAdjustment('OPERABLE', 4, 4);
    expect(adj.verb).toBe('EN ESPERA');
    expect(adj.caveat).toContain('4ª aparición');
  });

  it('un EN SEGUIMIENTO crónico también se marca EN ESPERA', () => {
    const adj = chronicAdjustment('EN SEGUIMIENTO', 9, 4);
    expect(adj.verb).toBe('EN ESPERA');
    expect(adj.caveat).toBeDefined();
  });

  it('ya EN ESPERA: se mantiene (jamás sube) y lleva caveat', () => {
    const adj = chronicAdjustment('EN ESPERA', 9, 4);
    expect(adj.verb).toBe('EN ESPERA');
    expect(adj.caveat).toBeDefined();
  });

  it('fail-closed: sin dato de apariciones (null) no degrada ni inventa caveat', () => {
    expect(chronicAdjustment('OPERABLE', null, 4)).toEqual({ verb: 'OPERABLE' });
  });
});

describe('chronicThreshold (envNumber lazy)', () => {
  it('default 4; respeta HOY_CHRONIC_THRESHOLD', () => {
    delete process.env.HOY_CHRONIC_THRESHOLD;
    expect(chronicThreshold()).toBe(4);
    try {
      process.env.HOY_CHRONIC_THRESHOLD = '7';
      expect(chronicThreshold()).toBe(7);
    } finally {
      // sin finally, un fallo intermedio filtraría el env al resto del archivo
      delete process.env.HOY_CHRONIC_THRESHOLD;
    }
  });
});

describe('stopBreachAdjustment — precio bajo un stop reciente perforado (patología NEM)', () => {
  it('precio bajo el stop reciente: OPERABLE pasa a EN ESPERA citando la evidencia', () => {
    const adj = stopBreachAdjustment('OPERABLE', 98.99, 102.78);
    expect(adj.verb).toBe('EN ESPERA');
    expect(adj.caveat).toMatch(/stop/i);
    expect(adj.caveat).toContain('32%'); // win rate causal medido del BUY bajo stop perforado
  });

  it('precio por encima del stop reciente: sin ajuste', () => {
    expect(stopBreachAdjustment('OPERABLE', 105, 102.78)).toEqual({ verb: 'OPERABLE' });
  });

  it('precio exactamente en el stop: sin ajuste (la perforación es estricta)', () => {
    expect(stopBreachAdjustment('OPERABLE', 102.78, 102.78)).toEqual({ verb: 'OPERABLE' });
  });

  it('sin stop reciente registrado (null): sin ajuste — ausencia es el caso normal', () => {
    expect(stopBreachAdjustment('OPERABLE', 98.99, null)).toEqual({ verb: 'OPERABLE' });
  });

  it('un EN SEGUIMIENTO bajo stop perforado también se marca EN ESPERA', () => {
    const adj = stopBreachAdjustment('EN SEGUIMIENTO', 98.99, 102.78);
    expect(adj.verb).toBe('EN ESPERA');
    expect(adj.caveat).toBeDefined();
  });

  it('ya EN ESPERA bajo stop perforado: mantiene verbo (jamás sube) pero lleva caveat', () => {
    const adj = stopBreachAdjustment('EN ESPERA', 98.99, 102.78);
    expect(adj.verb).toBe('EN ESPERA');
    expect(adj.caveat).toBeDefined();
  });

  it('precio no finito (NaN): sin ajuste — no se puede verificar la perforación', () => {
    expect(stopBreachAdjustment('OPERABLE', Number.NaN, 102.78)).toEqual({ verb: 'OPERABLE' });
  });
});

describe('stopBreachLookbackDays (envNumber lazy)', () => {
  it('default 30; respeta HOY_STOP_BREACH_LOOKBACK_DAYS', () => {
    delete process.env.HOY_STOP_BREACH_LOOKBACK_DAYS;
    expect(stopBreachLookbackDays()).toBe(30);
    try {
      process.env.HOY_STOP_BREACH_LOOKBACK_DAYS = '15';
      expect(stopBreachLookbackDays()).toBe(15);
    } finally {
      delete process.env.HOY_STOP_BREACH_LOOKBACK_DAYS;
    }
  });
});

describe('thesisConflictCaveat — arbitraje tesis vs scan en Hoy (jerarquía: el scan manda)', () => {
  it('tesis alcista + scan VENDER/REVISAR: caveat que nombra la jerarquía', () => {
    for (const verb of ['VENDER', 'REVISAR']) {
      const c = thesisConflictCaveat('alcista', verb);
      expect(c).toBeTruthy();
      expect(c!).toMatch(/scan|técnic/i);
    }
  });

  it('tesis alcista + scan OPERABLE: sin caveat (acuerdo, no conflicto)', () => {
    expect(thesisConflictCaveat('alcista', 'OPERABLE')).toBeNull();
  });

  it('tesis alcista + EN ESPERA/MANTENER: sin caveat (neutralidad no es conflicto)', () => {
    expect(thesisConflictCaveat('alcista', 'EN ESPERA')).toBeNull();
    expect(thesisConflictCaveat('alcista', 'MANTENER')).toBeNull();
  });

  it('tesis bajista + scan OPERABLE: caveat (conflicto inverso)', () => {
    expect(thesisConflictCaveat('bajista', 'OPERABLE')).toBeTruthy();
  });

  it('símbolo sin veredicto del scan (null): sin caveat — ausencia no es conflicto', () => {
    expect(thesisConflictCaveat('alcista', null)).toBeNull();
  });
});
