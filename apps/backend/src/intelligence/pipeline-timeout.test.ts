import { describe, it, expect } from 'vitest';
import { esResultadoDeTimeout, TIMEOUT_PREFIX } from './pipeline.service.js';

/**
 * AD-020 (2026-07-29) — encontrado corriendo el pipeline de verdad por primera vez desde el fix.
 * `withStageTimeout` resuelve con un StageResult 'failed', pero el llamador solo grababa el
 * artifact y logueaba: NUNCA escribía el estado terminal en `pipeline_runs`. Resultado: la
 * corrida 124 terminó con `news_status='running'` y `news_finished_at` en NULL sobre un run ya
 * cerrado — indistinguible de "está corriendo ahora", que es exactamente el síntoma que el fix
 * vino a eliminar. El pipeline sí siguió (objetivo cumplido), pero la contabilidad quedó rota.
 */
describe('esResultadoDeTimeout', () => {
  it('reconoce el resultado que fabrica el vencimiento', () => {
    expect(esResultadoDeTimeout({ criticalError: `${TIMEOUT_PREFIX}news` })).toBe(true);
  });

  it('un fallo normal de la etapa NO es un timeout (ese sí escribió su propio estado)', () => {
    expect(esResultadoDeTimeout({ criticalError: 'yahoo-429' })).toBe(false);
    expect(esResultadoDeTimeout({ criticalError: undefined })).toBe(false);
    expect(esResultadoDeTimeout({})).toBe(false);
  });
});
