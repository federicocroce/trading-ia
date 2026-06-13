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
}
