import { describe, it, expect } from 'vitest';
import {
  selectTodayProposals,
  verbFor,
  chronicAdjustment,
  chronicThreshold,
  stopoutCooldownAdjustment,
  stopoutCooldownDays,
  TODAY_PROPOSAL_LIMIT,
} from './today-proposals.js';

function opp(symbol: string, action: string, score: number) {
  return { symbol, action, opportunityScore: score };
}

describe('selectTodayProposals (misma selección para la vista y el registro)', () => {
  it('filtra a BUY/WATCH, excluye tenidos, ordena por score desc y corta el top N', () => {
    const opps = [
      opp('AAA', 'BUY', 50),
      opp('BBB', 'SELL', 99),   // SELL afuera
      opp('CCC', 'WATCH', 70),
      opp('DDD', 'HOLD', 95),   // HOLD afuera
      opp('EEE', 'BUY', 90),    // tenida → afuera
    ];
    const out = selectTodayProposals(opps, new Set(['EEE']));
    expect(out.map((o) => o.symbol)).toEqual(['CCC', 'AAA']);
  });

  it('la exclusión de tenidos es case-insensitive', () => {
    const out = selectTodayProposals([opp('dal', 'BUY', 80)], new Set(['DAL']));
    expect(out).toEqual([]);
  });

  it('corta en TODAY_PROPOSAL_LIMIT por default', () => {
    const many = Array.from({ length: 10 }, (_, i) => opp(`S${i}`, 'BUY', 100 - i));
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

describe('stopoutCooldownAdjustment — re-BUY tras stop-out reciente (patología NEM)', () => {
  it('stop-out dentro de la ventana: COMPRAR degrada a OBSERVAR con caveat que cita la evidencia', () => {
    const adj = stopoutCooldownAdjustment('COMPRAR', '2026-07-15', '2026-07-22', 10);
    expect(adj.verb).toBe('OBSERVAR');
    expect(adj.caveat).toMatch(/stop/i);
    expect(adj.caveat).toContain('10%'); // cita el win rate medido del re-BUY
  });

  it('stop-out en el borde de la ventana (exactamente N días) todavía degrada', () => {
    const adj = stopoutCooldownAdjustment('COMPRAR', '2026-07-12', '2026-07-22', 10);
    expect(adj.verb).toBe('OBSERVAR');
  });

  it('stop-out fuera de la ventana (N+1 días) no degrada ni agrega caveat', () => {
    expect(stopoutCooldownAdjustment('COMPRAR', '2026-07-11', '2026-07-22', 10)).toEqual({ verb: 'COMPRAR' });
  });

  it('sin stop-out registrado (null) no degrada — ausencia de stop-out es el caso normal', () => {
    expect(stopoutCooldownAdjustment('COMPRAR', null, '2026-07-22', 10)).toEqual({ verb: 'COMPRAR' });
  });

  it('OBSERVAR con stop-out reciente: mantiene verbo (jamás sube) pero lleva caveat', () => {
    const adj = stopoutCooldownAdjustment('OBSERVAR', '2026-07-20', '2026-07-22', 10);
    expect(adj.verb).toBe('OBSERVAR');
    expect(adj.caveat).toBeDefined();
  });

  it('fecha malformada no degrada de más ni de menos: NaN ⇒ sin ajuste (input interno controlado)', () => {
    expect(stopoutCooldownAdjustment('COMPRAR', 'garbage', '2026-07-22', 10)).toEqual({ verb: 'COMPRAR' });
  });
});

describe('stopoutCooldownDays (envNumber lazy)', () => {
  it('default 10; respeta HOY_STOPOUT_COOLDOWN_DAYS', () => {
    delete process.env.HOY_STOPOUT_COOLDOWN_DAYS;
    expect(stopoutCooldownDays()).toBe(10);
    try {
      process.env.HOY_STOPOUT_COOLDOWN_DAYS = '5';
      expect(stopoutCooldownDays()).toBe(5);
    } finally {
      delete process.env.HOY_STOPOUT_COOLDOWN_DAYS;
    }
  });
});
