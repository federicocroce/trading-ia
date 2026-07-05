import { describe, it, expect } from 'vitest';
import { validateReadonlySql } from './sql-guard.js';

describe('validateReadonlySql', () => {
  it('acepta un SELECT simple', () => {
    expect(validateReadonlySql('SELECT * FROM opportunity_scans LIMIT 5')).toEqual({ ok: true });
  });

  it('acepta SELECT en minúsculas y con espacios alrededor', () => {
    expect(validateReadonlySql('  select symbol from signal_tracking  ')).toEqual({ ok: true });
  });

  it('acepta CTEs (WITH ... SELECT)', () => {
    const sql = `WITH wins AS (SELECT * FROM signal_tracking WHERE outcome = 'win') SELECT COUNT(*) FROM wins`;
    expect(validateReadonlySql(sql)).toEqual({ ok: true });
  });

  it('acepta punto y coma final único', () => {
    expect(validateReadonlySql('SELECT 1;')).toEqual({ ok: true });
  });

  it('rechaza INSERT', () => {
    expect(validateReadonlySql(`INSERT INTO positions VALUES ('X', 1)`).ok).toBe(false);
  });

  it('rechaza UPDATE', () => {
    expect(validateReadonlySql(`UPDATE positions SET quantity = 0`).ok).toBe(false);
  });

  it('rechaza DELETE y DROP', () => {
    expect(validateReadonlySql('DELETE FROM positions').ok).toBe(false);
    expect(validateReadonlySql('DROP TABLE positions').ok).toBe(false);
  });

  it('rechaza PRAGMA y ATTACH aunque no escriban directamente', () => {
    expect(validateReadonlySql('PRAGMA journal_mode = DELETE').ok).toBe(false);
    expect(validateReadonlySql(`ATTACH DATABASE '/tmp/x.db' AS x`).ok).toBe(false);
  });

  it('rechaza múltiples sentencias (smuggling tras el punto y coma)', () => {
    expect(validateReadonlySql('SELECT 1; DELETE FROM positions').ok).toBe(false);
  });

  it('rechaza múltiples sentencias aunque la segunda sea otro SELECT', () => {
    expect(validateReadonlySql('SELECT 1; SELECT 2').ok).toBe(false);
  });

  it('no se deja engañar por punto y coma dentro de un string literal', () => {
    expect(validateReadonlySql(`SELECT * FROM news WHERE title = 'a;b'`)).toEqual({ ok: true });
  });

  it('rechaza escrituras escondidas en un CTE', () => {
    const sql = `WITH x AS (SELECT 1) INSERT INTO positions SELECT * FROM x`;
    expect(validateReadonlySql(sql).ok).toBe(false);
  });

  it('rechaza vacío o solo comentarios (fail-closed)', () => {
    expect(validateReadonlySql('').ok).toBe(false);
    expect(validateReadonlySql('   ').ok).toBe(false);
    expect(validateReadonlySql('-- nada').ok).toBe(false);
  });

  it('rechaza sentencias que empiezan con comentario seguido de escritura', () => {
    expect(validateReadonlySql('/* x */ DELETE FROM positions').ok).toBe(false);
  });

  it('acepta SELECT precedido por comentario (el comentario no lo disfraza)', () => {
    expect(validateReadonlySql('/* top */ SELECT 1').ok).toBe(true);
  });

  it('devuelve razón legible al rechazar', () => {
    const res = validateReadonlySql('DELETE FROM positions');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason.length).toBeGreaterThan(0);
  });
});
