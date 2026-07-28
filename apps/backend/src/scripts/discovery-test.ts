/**
 * Test de descubrimiento: ¿se puede arreglar el universo, ya que el ranking no?
 *
 * El problema medido (test de atribución, prompt maestro §4): a 30 días el universo ENTERO
 * que el sistema escanea rinde −1.33% contra SPY (t=−2.42). Ninguna selección dentro de un
 * universo con sesgo negativo lo arregla — por eso el top-6 salía aún peor. El trabajo útil
 * está en QUÉ se nomina, no en cómo se ordena.
 *
 * La hipótesis, derivada de `signal_tracking`: el eje fundamental discrimina alpha con
 * Δ=+7.16% (t=10.08). Si eso es real y no un artefacto del subconjunto trackeado, filtrar
 * el universo por `fund_score > 0` debería darle vuelta el signo al universo entero.
 *
 * Esto es una prueba FUERA DE MUESTRA en el sentido que importa: la evidencia salió del
 * subconjunto que pasa `shouldTrackSignal` (BUY/SELL/WATCH-con-timing); acá se aplica al
 * universo completo escaneado, que es una población distinta y mucho más grande.
 *
 * Método idéntico al de atribución (para que los números sean comparables):
 *   - Horizonte FIJO (7 y 30d) — la ventana de resolución tiene sesgo de velocidad.
 *   - Alpha = símbolo − SPY en la MISMA ventana.
 *   - Test pareado por FECHA: cada día es una observación (los símbolos de un mismo día
 *     están correlacionados; tratarlos como independientes inflaría el n).
 *   - Solo se usan datos conocidos al momento del scan (score y símbolo).
 *
 * `fund_score == 0` se separa a propósito: en este motor el 0 es mayormente "sin datos
 * fundamentales" (ETFs, commodities), NO "malo medido". Mezclarlo con los negativos
 * confundiría "no sé" con "es malo" — el pecado que la regla fail-closed prohíbe.
 *
 * Uso: npm run analyze:discovery --workspace=apps/backend
 *      HORIZON_DAYS=7 npm run analyze:discovery --workspace=apps/backend
 */
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { getHistoricalQuotes } from '../shared/yahoo.js';
import { envNumber, envString } from '../shared/env-number.js';
import { computeBenchmarkReturn, type PriceCandle } from '../intelligence/outcome-resolver.js';

const HORIZON = envNumber('HORIZON_DAYS', 30);

interface Row { date: string; symbol: string; fund: number; tech: number; score: number }

async function fetchCandles(symbol: string): Promise<PriceCandle[] | null> {
  for (let a = 0; a < 2; a++) {
    try {
      const ohlc = await getHistoricalQuotes(symbol, '2y', '1d');
      return ohlc.map((c) => ({ date: c.date, high: c.high, low: c.low, close: c.close }))
        .sort((x, y) => x.date.localeCompare(y.date));
    } catch { if (a === 0) await new Promise((r) => setTimeout(r, 1500)); }
  }
  return null;
}

const addDays = (ymd: string, d: number) =>
  new Date(Date.parse(ymd) + d * 86_400_000).toISOString().slice(0, 10);

function stats(xs: number[]) {
  const n = xs.length;
  if (n < 2) return { n, mean: NaN, t: NaN };
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1));
  return { n, mean, t: mean / (sd / Math.sqrt(n)) };
}

function line(label: string, s: ReturnType<typeof stats>, extra = '') {
  const sig = Number.isFinite(s.t) && Math.abs(s.t) > 1.96 ? ' SIGNIF' : '';
  console.log(
    `  ${label.padEnd(46)} n=${String(s.n).padEnd(4)} ` +
    `alpha=${s.mean.toFixed(2).padStart(7)}%  t=${s.t.toFixed(2).padStart(6)}${sig}${extra}`,
  );
}

async function main() {
  const bench = envString('BENCHMARK_SYMBOL', 'SPY');
  console.log(`[Descubrimiento] horizonte=${HORIZON}d benchmark=${bench}\n`);

  const benchCandles = await fetchCandles(bench);
  if (!benchCandles) { console.error('FATAL: sin serie de benchmark'); process.exit(1); }

  const raw = db.select({
    scannedAt: schema.opportunityScans.scannedAt,
    symbol: schema.opportunitySnapshots.symbol,
    score: schema.opportunitySnapshots.opportunityScore,
    data: schema.opportunitySnapshots.data,
  })
    .from(schema.opportunitySnapshots)
    .innerJoin(schema.opportunityScans, eq(schema.opportunityScans.id, schema.opportunitySnapshots.scanId))
    .all();

  const rows: Row[] = [];
  for (const r of raw as any[]) {
    let fund: number | null = null, tech: number | null = null;
    try {
      const d = JSON.parse(r.data);
      fund = d?.breakdown?.fundamental?.score ?? null;
      tech = d?.breakdown?.technical?.score ?? null;
    } catch { /* fila corrupta: se descarta, fail-closed */ }
    if (fund == null || tech == null) continue;
    rows.push({ date: String(r.scannedAt).slice(0, 10), symbol: r.symbol, fund, tech, score: r.score });
  }
  console.log(`[Descubrimiento] ${rows.length} snapshots con los dos ejes`);

  const symbols = [...new Set(rows.map((r) => r.symbol))];
  const candles = new Map<string, PriceCandle[] | null>();
  let done = 0;
  for (const s of symbols) {
    candles.set(s, await fetchCandles(s));
    if (++done % 150 === 0) console.log(`[Descubrimiento] velas ${done}/${symbols.length}`);
  }

  const alpha = new Map<string, number>();
  for (const r of rows) {
    const c = candles.get(r.symbol);
    if (!c) continue;
    const end = addDays(r.date, HORIZON);
    const sym = computeBenchmarkReturn(r.date, end, c);
    const bmk = computeBenchmarkReturn(r.date, end, benchCandles);
    if (sym == null || bmk == null) continue;
    alpha.set(`${r.date}|${r.symbol}`, sym - bmk);
  }
  const pares = new Set(rows.map((r) => `${r.date}|${r.symbol}`)).size;
  console.log(`[Descubrimiento] ${alpha.size}/${pares} pares con alpha (${(alpha.size / pares * 100).toFixed(1)}%)\n`);

  const byDate = new Map<string, Row[]>();
  for (const r of rows) {
    if (!alpha.has(`${r.date}|${r.symbol}`)) continue;
    let b = byDate.get(r.date);
    if (!b) { b = []; byDate.set(r.date, b); }
    b.push(r);
  }

  // Cohortes por fecha. Cada una necesita >=5 símbolos ese día para promediar.
  const C: Record<string, number[]> = {
    universo: [], fundPos: [], fundCero: [], fundNeg: [], fundFuerte: [], fundPosYTech: [],
  };
  const pairedPos: number[] = [];    // fund>0  − universo
  const pairedFuerte: number[] = []; // fund>=20 − universo

  for (const [date, u] of byDate) {
    const av = (rs: Row[]) => rs.reduce((s, r) => s + alpha.get(`${date}|${r.symbol}`)!, 0) / rs.length;
    if (u.length < 10) continue;
    const uni = av(u);
    C.universo.push(uni);

    const pos = u.filter((r) => r.fund > 0);
    const cero = u.filter((r) => r.fund === 0);
    const neg = u.filter((r) => r.fund < 0);
    const fuerte = u.filter((r) => r.fund >= 20);
    const posTech = u.filter((r) => r.fund > 0 && r.tech > 0);

    if (pos.length >= 5) { C.fundPos.push(av(pos)); pairedPos.push(av(pos) - uni); }
    if (cero.length >= 5) C.fundCero.push(av(cero));
    if (neg.length >= 5) C.fundNeg.push(av(neg));
    if (fuerte.length >= 5) { C.fundFuerte.push(av(fuerte)); pairedFuerte.push(av(fuerte) - uni); }
    if (posTech.length >= 5) C.fundPosYTech.push(av(posTech));
  }

  console.log(`RESULTADOS — horizonte ${HORIZON} días, cada fecha = 1 observación\n`);
  console.log('COHORTES DEL UNIVERSO (alpha vs SPY):');
  line('universo entero (lo que se escanea hoy)', stats(C.universo));
  line('fund_score > 0', stats(C.fundPos));
  line('fund_score == 0  (mayormente sin datos: ETFs)', stats(C.fundCero));
  line('fund_score < 0   (medido como malo)', stats(C.fundNeg));
  line('fund_score >= 20 (fuerte)', stats(C.fundFuerte));
  line('fund > 0 Y tech > 0', stats(C.fundPosYTech));

  console.log('\nLA PREGUNTA (pareado contra el propio universo del día):');
  line('fund>0  − universo : ¿filtrar mejora?', stats(pairedPos));
  line('fund>=20 − universo : ¿filtrar fuerte mejora?', stats(pairedFuerte));

  // ⚠️ Ventanas SOLAPADAS: con horizonte de 30d sobre scans casi diarios, dos fechas
  // consecutivas comparten 29/30 de su ventana. El n=68 "fechas" NO son 68 observaciones
  // independientes y el t-stat sale inflado. Dos chequeos que no dependen del t:
  //   (a) consistencia mes a mes — un efecto real no vive en un solo mes;
  //   (b) submuestra NO solapada — una fecha cada `HORIZON` días.
  const fechas = [...byDate.keys()].sort();
  const idxPorFecha = new Map(fechas.map((d, i) => [d, i]));
  const porMes = new Map<string, number[]>();
  const noSolapado: number[] = [];
  let ultimaUsada = -Infinity;
  let k = 0;
  for (const [date, u] of [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (u.length < 10) continue;
    const pos = u.filter((r) => r.fund > 0);
    if (pos.length < 5) continue;
    const av = (rs: Row[]) => rs.reduce((s, r) => s + alpha.get(`${date}|${r.symbol}`)!, 0) / rs.length;
    const delta = av(pos) - av(u);
    const mes = date.slice(0, 7);
    if (!porMes.has(mes)) porMes.set(mes, []);
    porMes.get(mes)!.push(delta);
    // Submuestra no solapada: se acepta la fecha solo si pasaron >= HORIZON días calendario.
    const t = Date.parse(date) / 86_400_000;
    if (t - ultimaUsada >= HORIZON) { noSolapado.push(delta); ultimaUsada = t; }
    k++;
  }
  console.log('\nROBUSTEZ (el t de arriba está inflado por ventanas solapadas):');
  console.log('  fund>0 − universo, por mes:');
  for (const m of [...porMes.keys()].sort()) {
    const s = stats(porMes.get(m)!);
    console.log(`    ${m}  n=${String(s.n).padEnd(3)} delta=${s.mean.toFixed(2).padStart(6)}`);
  }
  const ns = stats(noSolapado);
  console.log(`  submuestra NO solapada (1 fecha cada ${HORIZON}d): n=${ns.n} delta=${ns.mean.toFixed(2)} t=${ns.t.toFixed(2)}`);
  console.log('  (con n tan chico el t no decide nada: mirar si el signo es consistente)');

  const p = stats(pairedPos), f = stats(C.fundPos), un = stats(C.universo);
  console.log('\nLECTURA:');
  console.log(`  universo hoy            : ${un.mean.toFixed(2)}% (t=${un.t.toFixed(2)})`);
  console.log(`  universo filtrado fund>0: ${f.mean.toFixed(2)}% (t=${f.t.toFixed(2)})`);
  console.log(`  mejora                  : ${p.mean.toFixed(2)} puntos (t=${p.t.toFixed(2)}) → ${
    Math.abs(p.t) > 1.96 ? (p.mean > 0 ? 'FILTRAR PAGA' : 'FILTRAR EMPEORA') : 'indistinguible'}`);
  console.log(`  ¿el filtro da vuelta el signo? ${un.mean < 0 && f.mean > 0 ? 'SÍ' : 'no'}`);
  process.exit(0);
}

main().catch((e) => { console.error('[Descubrimiento] fatal:', e); process.exit(1); });
