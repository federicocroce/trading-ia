import cron from 'node-cron';
import { triggerScan } from '../evidence-signals/evidence-signals.service.js';
import { invalidateSectorRotationCache } from '../macro/sector-rotation.service.js';
import { invalidateMarketRegimeCache } from '../evidence-signals/market-regime.service.js';
import { prepareDeepAnalysisNews } from '../news/news-intelligence.service.js';
import { generateNewsRadar } from '../news/news-radar.service.js';

export function startCronJobs(): void {
  // Domingo 23:00 UTC: refresca caches macro + el scan de evidencia (PEAD/insider/options)
  // que alimenta el 4to eje del score. (Antes generaba weekly-picks, output muerto ya removido.)
  cron.schedule('0 23 * * 0', async () => {
    console.log('[Cron] Refresco semanal: caches + evidence scan...');
    try {
      invalidateMarketRegimeCache();
      invalidateSectorRotationCache();
      triggerScan(true);
    } catch (err) {
      console.error('[Cron] Refresco semanal falló:', (err as Error).message);
    }
  });

  console.log('[Cron] Scheduled: refresco semanal domingo 23:00 UTC');

  // News Radar: every 60 minutes (only during market-relevant hours, 6am-22pm UTC)
  // = 3am-19pm ART. Skip overnight to save tokens.
  cron.schedule('0 6-22 * * *', async () => {
    console.log('[Cron] News radar refresh starting...');
    try {
      const news = await prepareDeepAnalysisNews();
      if (news.length === 0) {
        console.log('[Cron] News radar: 0 articles after filters, skipping');
        return;
      }
      const snap = await generateNewsRadar(news, { persist: true });
      console.log(`[Cron] News radar: ${snap.perArticle.length} articles, ${snap.aggregatedSignals.length} signals`);
    } catch (err) {
      console.error('[Cron] News radar failed:', (err as Error).message);
    }
  });
  console.log('[Cron] Scheduled: news radar every hour (6-22 UTC)');

  // Outcome resolver: una vez al día, 23:00 UTC lun-vie (tras el cierre US, datos asentados).
  // Cierra el loop "predicción vs realidad": señales (win/loss), alertas anticipatorias
  // (triggered/missed) y cadenas causales de noticias (acertó/falló la dirección).
  cron.schedule('0 23 * * 1-5', async () => {
    console.log('[Cron] Outcome resolution starting...');
    try {
      const { resolveDailyOutcomes } = await import('../intelligence/outcome-resolver.service.js');
      const r = await resolveDailyOutcomes();
      console.log(
        `[Cron] Outcomes resueltos — señales: ${r.signals} | ` +
        `alertas: ${r.alerts.resolved} (▲${r.alerts.triggered} ✗${r.alerts.missed} ⌛${r.alerts.expired}) | ` +
        `cadenas causales: ${r.causal.resolved} (✓${r.causal.correct} ✗${r.causal.incorrect} ~${r.causal.neutral})`,
      );
    } catch (err) {
      console.error('[Cron] Outcome resolution failed:', (err as Error).message);
    }
  });
  console.log('[Cron] Scheduled: outcome resolver diario 23:00 UTC (lun-vie)');

  // Pipeline pre-market: corre solo a las 7:30 ET (lun-vie) para que el digest
  // esté listo ANTES de la apertura. Sin esto el sistema solo "anticipa" cuando
  // el usuario aprieta el botón — o sea, nunca a tiempo.
  cron.schedule(
    '30 7 * * 1-5',
    async () => {
      console.log('[Cron] Pipeline pre-market (7:30 ET)...');
      try {
        const { checkOrRunPipeline } = await import('../intelligence/pipeline.service.js');
        await checkOrRunPipeline(false);
        console.log('[Cron] Pipeline pre-market OK');
      } catch (err) {
        console.error('[Cron] Pipeline pre-market error:', (err as Error).message);
      }
    },
    { timezone: 'America/New_York' },
  );
  console.log('[Cron] Scheduled: pipeline pre-market diario 7:30 ET (lun-vie)');

  // Barrido de bases: sábados 14:00 — mercado cerrado, cola Yahoo libre.
  // ~500 fetches secuenciales (≈10-15 min). Fire-and-forget como el radar.
  cron.schedule('0 14 * * 6', async () => {
    try {
      const { runBaseSweep } = await import('../discovery/base-sweep.service.js');
      await runBaseSweep();
    } catch (err) {
      console.error('[Cron] Barrido de bases falló:', (err as Error).message);
    }
  });
  console.log('[Cron] Scheduled: barrido de bases sábados 14:00');
}
