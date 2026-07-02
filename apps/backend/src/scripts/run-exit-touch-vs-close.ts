/**
 * Ad-hoc: ¿el stop dinámico por TOQUE intradiario (low<=stop, lo que hoy hace la vista en vivo
 * con el precio spot) te saca en falsos vs por CIERRE (close<=stop)? Point-in-time, sin lookahead,
 * con comisión + slippage. Mismo trailing stop y misma entrada (close>SMA50) para ambos.
 *
 * "whipsaw" = salidas donde el cierre volvió por encima del precio de salida dentro de 5 velas
 * (te sacó y rebotó: exactamente el miedo de "me dijo vender y después subió").
 *
 * Uso: npx tsx src/scripts/run-exit-touch-vs-close.ts
 */
import { getHistoricalQuotes } from '../shared/yahoo.js';
import { computeTrailingStop } from '../opportunities/today-decisions.js';
import { resolveBacktestUniverse } from '../quant/ma-trend.service.js';
import { runExitRuleBacktest } from '../quant/exit-rule-backtest.service.js';

const YEARS = 7;
const WARMUP = 220;
const COMM = 0.1 / 100;
const SLIP = 0.05 / 100;

interface Bar { date: string; high: number; low: number; close: number }
type ExitMode = 'touch' | 'close';

function sma(closes: number[], i: number, n: number): number | null {
  if (i + 1 < n) return null;
  let s = 0;
  for (let k = i - n + 1; k <= i; k++) s += closes[k];
  return s / n;
}

interface SimResult { ret: number; maxDd: number; numTrades: number; winRate: number; whipsaws: number }

function simulate(candles: Bar[], mode: ExitMode): SimResult {
  const closes = candles.map((c) => c.close);
  let equity = 100, peak = -Infinity, maxDd = 0;
  let inPos = false, entryFill = 0, posEntryEquity = 0;
  const trades: number[] = [];
  let whipsaws = 0;

  for (let i = WARMUP; i < candles.length; i++) {
    const c = candles[i];
    const stop = computeTrailingStop(candles.slice(0, i + 1));
    const ma50 = sma(closes, i, 50);
    if (inPos) equity = posEntryEquity * (c.close / entryFill); // mark-to-market

    if (!inPos) {
      if (ma50 != null && c.close > ma50) {
        entryFill = c.close * (1 + SLIP);
        equity *= 1 - COMM;
        posEntryEquity = equity;
        inPos = true;
      }
    } else {
      const hit = stop != null && (mode === 'touch' ? c.low <= stop : c.close <= stop);
      if (hit) {
        const exitRef = mode === 'touch' ? Math.min(c.close, stop!) : c.close;
        const fill = exitRef * (1 - SLIP);
        equity = posEntryEquity * (fill / entryFill) * (1 - COMM);
        trades.push(Math.round((fill / entryFill - 1) * 10000) / 100);
        for (let k = i + 1; k <= Math.min(i + 5, candles.length - 1); k++) {
          if (candles[k].close > exitRef) { whipsaws++; break; }
        }
        inPos = false;
      }
    }
    peak = Math.max(peak, equity);
    if (peak > 0) maxDd = Math.max(maxDd, ((peak - equity) / peak) * 100);
  }

  const wins = trades.filter((r) => r > 0).length;
  return {
    ret: Math.round((equity - 100) * 100) / 100,
    maxDd: Math.round(maxDd * 100) / 100,
    numTrades: trades.length,
    winRate: trades.length ? Math.round((wins / trades.length) * 100) : 0,
    whipsaws,
  };
}

const pad = (s: string | number, n: number) => String(s).padEnd(n);
const padL = (s: string | number, n: number) => String(s).padStart(n);

async function main() {
  const universe = resolveBacktestUniverse()
    .filter((u) => u.group === 'portfolio' || u.group === 'benchmark')
    .map((u) => u.symbol);

  console.log(`\n=== TOUCH (low<=stop) vs CLOSE (close<=stop) — ${YEARS}y, point-in-time, con costos ===`);
  console.log(`universo: ${universe.join(', ')}\n`);
  console.log(
    pad('symbol', 8) +
      padL('ret_touch', 11) + padL('ret_close', 11) + padL('Δret', 9) +
      padL('dd_touch', 10) + padL('dd_close', 10) +
      padL('n_touch', 9) + padL('n_close', 9) +
      padL('whip_t', 8) + padL('whip_c', 8),
  );
  console.log('-'.repeat(101));

  const rows: Array<{ sym: string; t: SimResult; c: SimResult }> = [];
  for (const symbol of universe) {
    let candles: Bar[];
    try { candles = (await getHistoricalQuotes(symbol, `${YEARS}y`, '1d')) as Bar[]; } catch { continue; }
    if (candles.length < WARMUP + 60) { console.log(pad(symbol, 8) + '  (historia insuficiente)'); continue; }
    const t = simulate(candles, 'touch');
    const c = simulate(candles, 'close');
    rows.push({ sym: symbol, t, c });
    console.log(
      pad(symbol, 8) +
        padL(t.ret + '%', 11) + padL(c.ret + '%', 11) + padL((c.ret - t.ret >= 0 ? '+' : '') + Math.round((c.ret - t.ret) * 100) / 100, 9) +
        padL(t.maxDd + '%', 10) + padL(c.maxDd + '%', 10) +
        padL(t.numTrades, 9) + padL(c.numTrades, 9) +
        padL(t.whipsaws, 8) + padL(c.whipsaws, 8),
    );
  }

  if (rows.length) {
    const a = (xs: number[]) => Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 100) / 100;
    const closeWins = rows.filter((r) => r.c.ret > r.t.ret).length;
    console.log('-'.repeat(101));
    console.log(
      pad('PROMEDIO', 8) +
        padL(a(rows.map((r) => r.t.ret)) + '%', 11) + padL(a(rows.map((r) => r.c.ret)) + '%', 11) + padL('', 9) +
        padL(a(rows.map((r) => r.t.maxDd)) + '%', 10) + padL(a(rows.map((r) => r.c.maxDd)) + '%', 10) +
        padL(a(rows.map((r) => r.t.numTrades)), 9) + padL(a(rows.map((r) => r.c.numTrades)), 9) +
        padL(a(rows.map((r) => r.t.whipsaws)), 8) + padL(a(rows.map((r) => r.c.whipsaws)), 8),
    );
    console.log(`\nCLOSE ganó en retorno en ${closeWins}/${rows.length} símbolos.`);
  }

  // --- Head-to-head ya existente: let_it_run (Hoy, solo stop) vs sell_on_warning (motor: + divergencia) ---
  console.log(`\n=== LET_IT_RUN (Hoy) vs SELL_ON_WARNING (sumar señal técnica al exit) — ${YEARS}y ===`);
  const study = await runExitRuleBacktest({ years: YEARS, scope: 'portfolio' });
  const g = study.aggregate;
  console.log(`evaluados: ${g.evaluated} símbolos`);
  console.log(`  ret prom  — let_it_run: ${g.avgReturnLetItRun}%   sell_on_warning: ${g.avgReturnSellOnWarning}%`);
  console.log(`  maxDD prom — let_it_run: ${g.avgMaxDdLetItRun}%   sell_on_warning: ${g.avgMaxDdSellOnWarning}%`);
  console.log(`  profitFactor — let_it_run: ${g.avgProfitFactorLetItRun}   sell_on_warning: ${g.avgProfitFactorSellOnWarning}`);
  console.log(`  let_it_run ganó en retorno en ${g.letItRunWinsReturn}/${g.evaluated} símbolos.`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('ERROR:', e);
  process.exit(1);
});
