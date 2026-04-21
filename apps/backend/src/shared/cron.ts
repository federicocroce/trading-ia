import cron from 'node-cron';
import { triggerScan } from '../evidence-signals/evidence-signals.service.js';
import { generateWeeklyPicks, saveWeeklyPicks } from '../opportunities/weekly-picks.service.js';
import { invalidateSectorRotationCache } from '../macro/sector-rotation.service.js';
import { invalidateMarketRegimeCache } from '../evidence-signals/market-regime.service.js';

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
}
