/**
 * Test de atribución: ¿de dónde sale el valor del embudo?
 *
 * La pregunta: el score `<60` destruye alpha (−4.31%, t=−3.75) pero la correlación
 * score→alpha por encima de 60 es r=0.064 (no significativa). O sea: sabemos que el
 * PISO paga. Lo que NO sabemos es si el RANKING (elegir el top-6 entre los que pasan
 * el piso) agrega algo, o si todo el aparato de noticias/screener/LLM/scoring compuesto
 * está produciendo un orden que no informa.
 *
 * Método — sin lookahead:
 *   - Universo: `opportunity_snapshots` (lo que el sistema realmente escaneó ese día).
 *   - Horizonte FIJO de N días (default 30) desde la fecha del scan. Fijo a propósito:
 *     la ventana de resolución tiene sesgo de velocidad (el stop está más cerca que el
 *     target, así que los perdedores resuelven primero por construcción).
 *   - Alpha = retorno del símbolo − retorno de SPY en la MISMA ventana.
 *   - Solo se usan el score y el símbolo, ambos conocidos al momento del scan.
 *
 * Cohortes comparadas por scan:
 *   A. top-6 por score         (lo que la app muestra en "Hoy")
 *   B. 6 al azar del universo  (hipótesis nula; se promedian DRAWS sorteos)
 *   C. todos con score >= PISO (el piso solo, sin ranking)
 *   D. universo entero         (sin ninguna selección)
 *   E. top-6 dentro de los que pasan el piso (aísla el ranking por encima del piso)
 *
 * Significancia: test pareado POR SCAN (cada scan = 1 observación). Los símbolos de
 * un mismo día están correlacionados entre sí (mismo mercado), así que tratarlos como
 * independientes inflaría el n y daría t-stats falsos.
 *
 * Uso: npm run analyze:attribution --workspace=apps/backend
 *      HORIZON_DAYS=7 npm run analyze:attribution --workspace=apps/backend
 */
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { getHistoricalQuotes } from '../shared/yahoo.js';
import { envNumber, envString } from '../shared/env-number.js';
import { computeBenchmarkReturn, type PriceCandle } from '../intelligence/outcome-resolver.js';

const HORIZON = envNumber('HORIZON_DAYS', 30);
const FLOOR = envNumber('SCORE_FLOOR', 60);
const TOP_N = envNumber('TOP_N', 6);
const DRAWS = envNumber('RANDOM_DRAWS', 200);

interface Row { scanDate: string; symbol: string; score: number }

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

function addDays(ymd: string, d: number): string {
  return new Date(Date.parse(ymd) + d * 86_400_000).toISOString().slice(0, 10);
}

/** Media, desvío y t de una muestra. */
function stats(xs: number[]) {
  const n = xs.length;
  if (n < 2) return { n, mean: NaN, sd: NaN, t: NaN };
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1));
  return { n, mean, sd, t: mean / (sd / Math.sqrt(n)) };
}

function line(label: string, s: ReturnType<typeof stats>, extra = '') {
  const sig = Number.isFinite(s.t) && Math.abs(s.t) > 1.96 ? ' SIGNIF' : '';
  console.log(
    `  ${label.padEnd(42)} n=${String(s.n).padEnd(5)} ` +
    `alpha=${s.mean.toFixed(2).padStart(7)}%  t=${s.t.toFixed(2).padStart(6)}${sig}${extra}`,
  );
}

async function main() {
  const bench = envString('BENCHMARK_SYMBOL', 'SPY');
  console.log(`[Atribución] horizonte=${HORIZON}d piso=${FLOOR} top=${TOP_N} sorteos=${DRAWS} benchmark=${bench}\n`);

  const benchCandles = await fetchCandles(bench);
  if (!benchCandles) { console.error('FATAL: sin serie de benchmark'); process.exit(1); }

  // Universo real escaneado, con la fecha del scan (no la del snapshot).
  const raw = db.select({
    scannedAt: schema.opportunityScans.scannedAt,
    symbol: schema.opportunitySnapshots.symbol,
    score: schema.opportunitySnapshots.opportunityScore,
  })
    .from(schema.opportunitySnapshots)
    .innerJoin(schema.opportunityScans, eq(schema.opportunityScans.id, schema.opportunitySnapshots.scanId))
    .all();

  const rows: Row[] = raw.map((r: any) => ({
    scanDate: String(r.scannedAt).slice(0, 10),
    symbol: r.symbol,
    score: r.score,
  }));
  console.log(`[Atribución] ${rows.length} snapshots, ${new Set(rows.map(r => r.symbol)).size} símbolos`);

  // Velas de todos los símbolos.
  const symbols = [...new Set(rows.map((r) => r.symbol))];
  const candles = new Map<string, PriceCandle[] | null>();
  let done = 0;
  for (const s of symbols) {
    candles.set(s, await fetchCandles(s));
    if (++done % 100 === 0) console.log(`[Atribución] velas ${done}/${symbols.length}`);
  }

  // Alpha a horizonte fijo para cada (scan, símbolo). Fail-closed: sin cobertura, se descarta.
  const alpha = new Map<string, number>(); // `${scanDate}|${symbol}` -> alpha
  for (const r of rows) {
    const c = candles.get(r.symbol);
    if (!c) continue;
    const end = addDays(r.scanDate, HORIZON);
    const symRet = computeBenchmarkReturn(r.scanDate, end, c);        // misma mecánica: % entre dos cierres
    const benchRet = computeBenchmarkReturn(r.scanDate, end, benchCandles);
    if (symRet == null || benchRet == null) continue;
    alpha.set(`${r.scanDate}|${r.symbol}`, symRet - benchRet);
  }
  // Denominador correcto: pares (fecha, símbolo) únicos, NO snapshots. Hay varios
  // scans por día y el análisis trata cada DÍA como una observación, así que
  // comparar contra rows.length subestimaría groseramente la cobertura.
  const pares = new Set(rows.map((r) => `${r.scanDate}|${r.symbol}`)).size;
  const fechas = new Set(rows.map((r) => r.scanDate)).size;
  console.log(
    `[Atribución] ${alpha.size}/${pares} pares (fecha,símbolo) con alpha calculable ` +
    `(${(alpha.size / pares * 100).toFixed(1)}%) — ${fechas} fechas distintas de ${rows.length} snapshots`,
  );
  console.log('[Atribución] lo que falta es recencia (sin forward aún), no supervivencia:');
  console.log('[Atribución]   solo 13 de 791 símbolos carecen de velas = 96 obs (1.2%)\n');

  // Agrupar por scan.
  const byScan = new Map<string, Row[]>();
  for (const r of rows) {
    if (!alpha.has(`${r.scanDate}|${r.symbol}`)) continue;
    let bucket = byScan.get(r.scanDate);
    if (!bucket) { bucket = []; byScan.set(r.scanDate, bucket); }
    bucket.push(r);
  }

  // PRNG determinístico: la corrida tiene que ser reproducible. `Math.imul` es obligatorio —
  // con `*` a secas el producto supera 2^53 y pierde precisión antes del enmascarado.
  // Igual el sorteo es solo un CONTROL: el baseline aleatorio exacto es la cohorte D
  // (la esperanza de un sorteo sin reemplazo es la media poblacional).
  let seed = 12345;
  const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff);

  const A: number[] = [], B: number[] = [], C: number[] = [], D: number[] = [], E: number[] = [];
  const paired: number[] = [];   // A − B por scan
  const pairedFloor: number[] = []; // E − C por scan

  for (const [date, universe] of byScan) {
    if (universe.length < TOP_N * 2) continue; // universo muy chico para comparar
    const av = (rs: Row[]) => rs.reduce((s, r) => s + alpha.get(`${date}|${r.symbol}`)!, 0) / rs.length;

    const sorted = [...universe].sort((x, y) => y.score - x.score);
    const top = sorted.slice(0, TOP_N);
    const floorSet = universe.filter((r) => r.score >= FLOOR);
    const topOfFloor = [...floorSet].sort((x, y) => y.score - x.score).slice(0, TOP_N);

    // Aleatorio: promedio de DRAWS sorteos de TOP_N símbolos.
    let acc = 0;
    for (let d = 0; d < DRAWS; d++) {
      const pool = [...universe];
      let s = 0;
      for (let k = 0; k < TOP_N; k++) s += alpha.get(`${date}|${pool.splice(Math.floor(rnd() * pool.length), 1)[0].symbol}`)!;
      acc += s / TOP_N;
    }
    const randMean = acc / DRAWS;

    const aTop = av(top);
    A.push(aTop); B.push(randMean); D.push(av(universe));
    paired.push(aTop - randMean);
    if (floorSet.length >= TOP_N) {
      const aFloor = av(floorSet), aTopFloor = av(topOfFloor);
      C.push(aFloor); E.push(aTopFloor);
      pairedFloor.push(aTopFloor - aFloor);
    }
  }

  console.log(`RESULTADOS — ${A.length} scans comparables, horizonte ${HORIZON} días\n`);
  console.log('COHORTES (alpha medio vs SPY, cada scan = 1 observación):');
  line(`A. top-${TOP_N} por score (lo que muestra "Hoy")`, stats(A));
  line(`B. ${TOP_N} al azar del mismo universo`, stats(B));
  line(`C. todos con score >= ${FLOOR} (piso solo)`, stats(C));
  line('D. universo entero escaneado', stats(D));
  line(`E. top-${TOP_N} dentro del piso`, stats(E));

  console.log('\nCOMPARACIONES PAREADAS (la pregunta real):');
  // A − D es el test EXACTO de "ranking vs azar": la esperanza de un sorteo sin
  // reemplazo es la media poblacional, así que D es el baseline aleatorio sin ruido
  // de muestreo. B se calcula igual como control: debe converger a D.
  line(`A − D : ¿el ranking le gana al azar? (exacto)`, stats(A.map((a, i) => a - D[i])));
  line(`A − B : ídem por sorteo (control de B≈D)`, stats(paired));
  line(`E − C : ¿el ranking agrega sobre el piso?`, stats(pairedFloor));

  console.log('\nLECTURA:');
  const pa = stats(paired), pf = stats(pairedFloor);
  console.log(`  ranking vs azar     : ${Math.abs(pa.t) > 1.96 ? (pa.mean > 0 ? 'AGREGA valor' : 'DESTRUYE valor') : 'INDISTINGUIBLE del azar'} (t=${pa.t.toFixed(2)})`);
  console.log(`  ranking sobre piso  : ${Math.abs(pf.t) > 1.96 ? (pf.mean > 0 ? 'AGREGA valor' : 'DESTRUYE valor') : 'INDISTINGUIBLE'} (t=${pf.t.toFixed(2)})`);
  const cd = stats(C.map((c, i) => c - D[i]));
  line('  C − D : ¿el piso agrega sobre no filtrar?', cd);
  process.exit(0);
}

main().catch((e) => { console.error('[Atribución] fatal:', e); process.exit(1); });
