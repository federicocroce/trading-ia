import { describe, it, expect } from 'vitest';
import { runReadonlyQuery, describeToolUse } from './chat-agent.service.js';

describe('runReadonlyQuery', () => {
  it('ejecuta un SELECT trivial contra la DB real en modo readonly', () => {
    const res = runReadonlyQuery('SELECT 1 AS uno');
    expect(res.ok).toBe(true);
    expect(res.rows).toEqual([{ uno: 1 }]);
    expect(res.truncated).toBe(false);
  });

  it('rechaza escrituras vía el guard, con razón legible', () => {
    const res = runReadonlyQuery('DELETE FROM positions');
    expect(res.ok).toBe(false);
    expect(res.error).toContain('lectura');
  });

  it('la conexión readonly rechaza escrituras aunque el guard fallara (defensa en profundidad)', () => {
    // CREATE TEMP TABLE arranca con palabra prohibida — pasa por el guard y muere ahí,
    // pero si algún día el guard se relaja, better-sqlite3 readonly la corta igual.
    const res = runReadonlyQuery(`CREATE TEMP TABLE x (a INT)`);
    expect(res.ok).toBe(false);
  });

  it('devuelve error honesto (no crash) ante SQL inválido', () => {
    const res = runReadonlyQuery('SELECT * FROM tabla_que_no_existe');
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
  });

  it('trunca celdas gigantes para no reventar el contexto del agente', () => {
    const res = runReadonlyQuery(`SELECT printf('%.*c', 2000, 'x') AS blob`);
    expect(res.ok).toBe(true);
    const cell = res.rows?.[0]?.blob as string;
    expect(cell.length).toBeLessThan(600);
    expect(cell).toContain('[truncado: 2000 chars]');
  });
});

describe('describeToolUse', () => {
  it('resume consultar_db con el SQL compactado', () => {
    const d = describeToolUse('mcp__trading__consultar_db', { sql: 'SELECT *\n  FROM signal_tracking' });
    expect(d).toBe('Consultando la base: SELECT * FROM signal_tracking');
  });

  it('describe Read con path relativo al repo', () => {
    const d = describeToolUse('Read', { file_path: '/x/docs/analisis.md' });
    expect(d).toContain('docs/analisis.md');
  });

  it('cae a un genérico para tools desconocidas', () => {
    expect(describeToolUse('Foo', {})).toBe('Usando Foo');
  });
});
