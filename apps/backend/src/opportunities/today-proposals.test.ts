import { describe, it, expect } from 'vitest';
import {
  selectTodayProposals,
  verbFor,
  chronicAdjustment,
  chronicThreshold,
  stopBreachAdjustment,
  thesisConflictCaveat,
  stopBreachLookbackDays,
  TODAY_PROPOSAL_LIMIT,
} from './today-proposals.js';

function opp(symbol: string, action: string, score: number) {
  return { symbol, action, opportunityScore: score };
}

describe('selectTodayProposals (misma selección para la vista y el registro)', () => {
  // INVARIANTE (2026-07-23): ningún BUY del motor queda fuera de Hoy. BUYs primero
  // (todos, por score), después los mejores WATCH hasta completar el límite. Antes se
  // mezclaba por score y un BUY score 55 podía perder el lugar contra WATCHs 56+ —
  // "Hoy" decía "nada para comprar" mientras Oportunidades mostraba un BUY.
  it('filtra a BUY/WATCH, excluye tenidos; BUYs primero aunque tengan menos score', () => {
    const opps = [
      opp('AAA', 'BUY', 50),
      opp('BBB', 'SELL', 99),   // SELL afuera
      opp('CCC', 'WATCH', 70),
      opp('DDD', 'HOLD', 95),   // HOLD afuera
      opp('EEE', 'BUY', 90),    // tenida → afuera
    ];
    const out = selectTodayProposals(opps, new Set(['EEE']));
    expect(out.map((o) => o.symbol)).toEqual(['AAA', 'CCC']);
  });

  it('un BUY jamás queda afuera aunque el límite se llene de WATCHs con más score', () => {
    const opps = [
      ...Array.from({ length: 8 }, (_, i) => opp(`W${i}`, 'WATCH', 90 - i)), // 8 WATCH 90..83
      opp('XLC', 'BUY', 55), // el caso real: BUY con score menor a todos los WATCH
    ];
    const out = selectTodayProposals(opps, new Set());
    expect(out[0].symbol).toBe('XLC'); // BUY primero
    expect(out.length).toBe(TODAY_PROPOSAL_LIMIT); // 1 BUY + 5 mejores WATCH
    expect(out.filter((o) => o.action === 'WATCH').map((o) => o.symbol)).toEqual(['W0', 'W1', 'W2', 'W3', 'W4']);
  });

  it('si hay más BUYs que el límite, se muestran TODOS los BUYs (el límite cede)', () => {
    const opps = Array.from({ length: 8 }, (_, i) => opp(`B${i}`, 'BUY', 100 - i));
    const out = selectTodayProposals(opps, new Set());
    expect(out.length).toBe(8);
    expect(out.every((o) => o.action === 'BUY')).toBe(true);
  });

  it('la exclusión de tenidos es case-insensitive', () => {
    const out = selectTodayProposals([opp('dal', 'BUY', 80)], new Set(['DAL']));
    expect(out).toEqual([]);
  });

  it('corta en TODAY_PROPOSAL_LIMIT por default (los WATCH llenan hasta el límite; los BUY no se cortan)', () => {
    const many = Array.from({ length: 10 }, (_, i) => opp(`S${i}`, 'WATCH', 100 - i));
    expect(selectTodayProposals(many, new Set()).length).toBe(TODAY_PROPOSAL_LIMIT);
  });

  it('devuelve las mismas filas que recibe (genérico, sin remap)', () => {
    const rich = [{ ...opp('AAA', 'BUY', 50), tradeLevels: { entryPrice: 10 } }];
    expect(selectTodayProposals(rich, new Set())[0].tradeLevels.entryPrice).toBe(10);
  });
});

describe('verbFor', () => {
  it('BUY → COMPRAR; cualquier otra cosa → OBSERVAR', () => {
    expect(verbFor('BUY')).toBe('COMPRAR');
    expect(verbFor('WATCH')).toBe('OBSERVAR');
  });
});

describe('chronicAdjustment (evidencia: 4ª+ aparición = 40.4% win, −0.05R, n=260)', () => {
  it('debajo del umbral: no toca el verbo ni agrega caveat', () => {
    expect(chronicAdjustment('COMPRAR', 3, 4)).toEqual({ verb: 'COMPRAR' });
  });

  it('en el umbral: COMPRAR degrada a OBSERVAR con caveat que nombra la enésima aparición', () => {
    const adj = chronicAdjustment('COMPRAR', 4, 4);
    expect(adj.verb).toBe('OBSERVAR');
    expect(adj.caveat).toContain('4ª aparición');
  });

  it('OBSERVAR crónico: mantiene el verbo (jamás sube) pero lleva caveat', () => {
    const adj = chronicAdjustment('OBSERVAR', 9, 4);
    expect(adj.verb).toBe('OBSERVAR');
    expect(adj.caveat).toBeDefined();
  });

  it('fail-closed: sin dato de apariciones (null) no degrada ni inventa caveat', () => {
    expect(chronicAdjustment('COMPRAR', null, 4)).toEqual({ verb: 'COMPRAR' });
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

describe('stopBreachAdjustment — BUY con precio bajo un stop reciente perforado (patología NEM)', () => {
  it('precio bajo el stop reciente: COMPRAR degrada a OBSERVAR con caveat que cita la evidencia', () => {
    const adj = stopBreachAdjustment('COMPRAR', 98.99, 102.78);
    expect(adj.verb).toBe('OBSERVAR');
    expect(adj.caveat).toMatch(/stop/i);
    expect(adj.caveat).toContain('32%'); // win rate causal medido del BUY bajo stop perforado
  });

  it('precio por encima del stop reciente: sin ajuste', () => {
    expect(stopBreachAdjustment('COMPRAR', 105, 102.78)).toEqual({ verb: 'COMPRAR' });
  });

  it('precio exactamente en el stop: sin ajuste (la perforación es estricta)', () => {
    expect(stopBreachAdjustment('COMPRAR', 102.78, 102.78)).toEqual({ verb: 'COMPRAR' });
  });

  it('sin stop reciente registrado (null): sin ajuste — ausencia es el caso normal', () => {
    expect(stopBreachAdjustment('COMPRAR', 98.99, null)).toEqual({ verb: 'COMPRAR' });
  });

  it('OBSERVAR bajo stop perforado: mantiene verbo (jamás sube) pero lleva caveat', () => {
    const adj = stopBreachAdjustment('OBSERVAR', 98.99, 102.78);
    expect(adj.verb).toBe('OBSERVAR');
    expect(adj.caveat).toBeDefined();
  });

  it('precio no finito (NaN): sin ajuste — no se puede verificar la perforación', () => {
    expect(stopBreachAdjustment('COMPRAR', Number.NaN, 102.78)).toEqual({ verb: 'COMPRAR' });
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

  it('tesis alcista + scan COMPRAR: sin caveat (acuerdo, no conflicto)', () => {
    expect(thesisConflictCaveat('alcista', 'COMPRAR')).toBeNull();
  });

  it('tesis alcista + scan OBSERVAR/MANTENER: sin caveat (neutralidad no es conflicto)', () => {
    expect(thesisConflictCaveat('alcista', 'OBSERVAR')).toBeNull();
    expect(thesisConflictCaveat('alcista', 'MANTENER')).toBeNull();
  });

  it('tesis bajista + scan COMPRAR: caveat (conflicto inverso)', () => {
    expect(thesisConflictCaveat('bajista', 'COMPRAR')).toBeTruthy();
  });

  it('símbolo sin veredicto del scan (null): sin caveat — ausencia no es conflicto', () => {
    expect(thesisConflictCaveat('alcista', null)).toBeNull();
  });
});
