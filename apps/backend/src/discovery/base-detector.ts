/**
 * Detector de bases silenciosas (caso IREN): acción castigada que empieza a
 * repararse sin haber aparecido aún en noticias ni en movers. Función pura de
 * decisión — sin I/O. El barrido semanal (base-sweep.service) la alimenta.
 */
import type { OHLC } from '@trading/shared';
import { envNumber } from '../shared/env-number.js';

export interface BaseDetection {
  isBase: boolean;
  strength: number; // 1-2: cantidad de confirmaciones opcionales (volumen, RS)
  reasons: string[];
}

function avg(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function sma(closes: number[], endIdx: number, period: number): number | null {
  if (endIdx + 1 < period) return null;
  let s = 0;
  for (let i = endIdx - period + 1; i <= endIdx; i++) s += closes[i];
  return s / period;
}

export function detectBase(bars: OHLC[], spyCloses: number[]): BaseDetection {
  const reject = (why: string): BaseDetection => ({ isBase: false, strength: 0, reasons: [why] });

  // Fail-closed: sin historial suficiente no se opina.
  if (bars.length < 220 || spyCloses.length < 220) return reject('historial insuficiente');

  const closes = bars.map((b) => b.close);
  const last = closes.length - 1;
  const price = closes[last];

  // Liquidez: piso de dollar volume para que el swing sea ejecutable.
  const minDollarVol = envNumber('SWEEP_MIN_DOLLAR_VOLUME', 10_000_000);
  const dollarVol20 = avg(bars.slice(-20).map((b) => b.close * b.volume));
  if (dollarVol20 < minDollarVol) return reject(`liquidez insuficiente ($${(dollarVol20 / 1e6).toFixed(1)}M/día < $${(minDollarVol / 1e6).toFixed(0)}M)`);

  const sma200 = sma(closes, last, 200)!;
  const sma50Now = sma(closes, last, 50)!;
  const sma50Prev = sma(closes, last - 10, 50)!;
  const high252 = Math.max(...closes.slice(-252));

  // Obligatorio 1 — castigada: bajo SMA200 o lejos del máximo anual.
  const beaten = price < sma200 || price <= high252 * 0.75;
  if (!beaten) return reject('no está castigada (sobre SMA200 y cerca de máximos)');

  // Obligatorio 2 — reparando: sobre SMA50 y SMA50 con pendiente positiva.
  const repairing = price > sma50Now && sma50Now > sma50Prev;
  if (!repairing) return reject('no está reparando (bajo SMA50 o SMA50 cayendo)');

  const reasons: string[] = ['castigada', 'reparando (sobre SMA50 con pendiente positiva)'];
  let strength = 0;

  // Opcional 1 — volumen despertando: acumulación reciente.
  const vol20 = avg(bars.slice(-20).map((b) => b.volume));
  const vol60 = avg(bars.slice(-60).map((b) => b.volume));
  if (vol20 > vol60) { strength++; reasons.push('volumen despertando (20d > 60d)'); }

  // Opcional 2 — RS 1m vs SPY positivo: el giro le gana al mercado.
  const spyLast = spyCloses.length - 1;
  const ret1m = price / closes[last - 21] - 1;
  const spyRet1m = spyCloses[spyLast] / spyCloses[spyLast - 21] - 1;
  if (ret1m - spyRet1m > 0) { strength++; reasons.push('RS 1m vs SPY positivo'); }

  if (strength === 0) return reject('repara pero sin confirmación (ni volumen ni RS)');

  return { isBase: true, strength, reasons };
}
