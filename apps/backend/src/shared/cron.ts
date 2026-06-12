import cron from 'node-cron';
import { triggerScan } from '../evidence-signals/evidence-signals.service.js';
import { generateWeeklyPicks, saveWeeklyPicks } from '../opportunities/weekly-picks.service.js';
import { invalidateSectorRotationCache } from '../macro/sector-rotation.service.js';
import { invalidateMarketRegimeCache } from '../evidence-signals/market-regime.service.js';
import { prepareDeepAnalysisNews } from '../news/news-intelligence.service.js';
import { generateNewsRadar } from '../news/news-radar.service.js';

export function startCronJobs(): void {
  // Sunday 23:00 UTC = Sunday 20:00 ART
  cron.schedule('0 23 * * 0', async () => {
    console.log('[Cron] Starting Sunday weekly picks generation...');
    try {
      invalidateMarketRegimeCache();
      invalidateSectorRotationCache();

      // triggerScan is fire-and-forget; we need to wait for the scan to finish.
      // Use a small poll loop: trigger with forceRefresh and wait for status.
      triggerScan(true);

      // Wait up to 120 s for the scan to complete
      const { getScanStatus } = await import('../evidence-signals/evidence-signals.service.js');
      const deadline = Date.now() + 120_000;
      await new Promise<void>((resolve, reject) => {
        const check = () => {
          const status = getScanStatus();
          if (status.state === 'idle') {
            resolve();
          } else if (Date.now() > deadline) {
            reject(new Error('Evidence scan timed out after 120 s'));
          } else {
            setTimeout(check, 2_000);
          }
        };
        setTimeout(check, 2_000);
      });
      console.log('[Cron] Evidence scan complete');

      const picks = await generateWeeklyPicks();
      await saveWeeklyPicks(picks);
      console.log(
        `[Cron] Weekly picks generated: ${picks.length} picks (${picks.filter((p) => p.tier === 'HIGH').length} HIGH)`,
      );
    } catch (err) {
      console.error('[Cron] Weekly picks generation failed:', (err as Error).message);
    }
  });

  console.log('[Cron] Scheduled: weekly picks every Sunday 23:00 UTC (20:00 ART)');

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

  // Stop-loss watcher: cada 10 min, 13-21 UTC lun-vie (≈ 10:00-18:00 ART / horario NYSE)
  cron.schedule('*/10 13-21 * * 1-5', async () => {
    try {
      const { checkStopBreaches } = await import('../alerts/stop-breach.service.js');
      await checkStopBreaches();
    } catch (err) {
      console.error('[Cron] Stop-breach check failed:', (err as Error).message);
    }
  });
  console.log('[Cron] Scheduled: stop-breach watcher cada 10 min (13-21 UTC, lun-vie)');

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
