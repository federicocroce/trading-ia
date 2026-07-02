/**
 * Runner ad-hoc del estudio de aislamiento de señales (máquina B).
 * Corre runSignalEdgeStudy sobre el universo de backtest y vuelca tabla + JSON.
 * Uso: npx tsx src/scripts/run-signal-edge.ts
 */
import { runSignalEdgeStudy } from '../quant/signal-edge.service.js';
import { writeFileSync } from 'node:fs';

const pad = (s: string | number, n: number) => String(s).padEnd(n);
const padL = (s: string | number, n: number) => String(s).padStart(n);

async function main() {
  console.log('[signal-edge] arrancando estudio sobre el universo...');
  const t0 = Date.now();
  const study = await runSignalEdgeStudy();
  const secs = Math.round((Date.now() - t0) / 1000);

  console.log(
    `\n[signal-edge] listo en ${secs}s — ${study.params.symbols} símbolos, ${study.params.totalBars} barras concluyentes, horizonte ${study.params.horizonDays}d, ${study.params.years}y\n`,
  );

  console.log(
    pad('signal', 16) + padL('n', 8) + padL('win%', 7) + padL('base%', 7) +
    padL('edge', 7) + padL('z', 7) + padL('sig', 5) + '  ' + pad('porPeriodo', 22) +
    padL('estab', 7) + padL('CONFIABLE', 11),
  );
  console.log('-'.repeat(110));

  for (const s of study.signals) {
    console.log(
      pad(s.signal, 16) +
        padL(s.alerts.n, 8) +
        padL(s.alerts.winRate, 7) +
        padL(s.baseline.winRate, 7) +
        padL((s.edgeWinRate > 0 ? '+' : '') + s.edgeWinRate, 7) +
        padL(s.zScore, 7) +
        padL(s.significant ? 'SI' : 'no', 5) +
        '  ' +
        pad('[' + s.edgeByPeriod.map((e) => (e > 0 ? '+' : '') + e).join(', ') + ']', 22) +
        padL(s.stable ? 'SI' : 'no', 7) +
        padL(s.trustworthy ? '✅ SI' : '— no', 11),
    );
  }

  writeFileSync('/tmp/signal-edge-result.json', JSON.stringify(study, null, 2));
  console.log('\n[signal-edge] JSON completo en /tmp/signal-edge-result.json');
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('[signal-edge] ERROR:', e);
  process.exit(1);
});
