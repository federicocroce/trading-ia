import { describe, it, expect } from 'vitest';
import { esResultadoDeTimeout, puedeEscribirEtapa, TIMEOUT_PREFIX } from './pipeline.service.js';

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

/**
 * AD-020, deuda que había quedado abierta: abandonar la etapa por timeout NO la cancela — la
 * promesa sigue viva. Si `runNewsStage` termina 10 minutos después, llama a `updatePipelineStage`
 * y **pisa retroactivamente** el estado de una corrida ya cerrada, dejándola en 'ok' como si sus
 * datos se hubieran usado. No se usaron: el pipeline siguió sin esperarla.
 * Cancelar de verdad necesita un AbortSignal a través de todo el stage; lo que sí se puede hacer
 * barato y correcto es que la escritura tardía no entre.
 */
describe('puedeEscribirEtapa (la etapa abandonada no vuelve por la ventana)', () => {
  it('etapa normal: escribe', () => {
    expect(puedeEscribirEtapa(new Set(), 124, 'news')).toBe(true);
  });

  it('etapa abandonada por timeout: la escritura tardía se descarta', () => {
    expect(puedeEscribirEtapa(new Set(['124:news']), 124, 'news')).toBe(false);
  });

  it('el abandono es por corrida Y etapa, no global', () => {
    const abandonadas = new Set(['124:news']);
    expect(puedeEscribirEtapa(abandonadas, 124, 'report')).toBe(true);  // otra etapa del mismo run
    expect(puedeEscribirEtapa(abandonadas, 125, 'news')).toBe(true);    // misma etapa, run siguiente
  });
});
