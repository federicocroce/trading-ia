/**
 * Regenera `sweep-universe.json` (el universo del barrido de bases) desde una fuente pública.
 *
 * Antes era una lista escrita a mano en un commit del 2026-07-20, sin fecha ni forma de
 * saber cuánto se había podrido. El S&P rota ~20-25 componentes al año: en 12 meses el
 * barrido habría estado corriendo sobre ~20 símbolos que ya no pertenecen, sin avisar.
 *
 * FAIL-CLOSED en cada punta: si la descarga falla, si el CSV no parsea, o si el conteo cae
 * fuera de las bandas de plausibilidad, **NO se escribe nada** y sale con código 1. Un
 * universo viejo pero válido siempre es mejor que uno nuevo y roto — y quedarse con el
 * viejo es visible (la antigüedad se loguea en cada barrido), romperlo no.
 *
 * ⚠️ Lo que esto NO arregla: el sesgo de supervivencia. Sigue siendo la foto del índice HOY,
 * o sea empresas que ya sobrevivieron hasta entrar. Todo backtest sobre este universo lo
 * arrastra. Resolverlo requeriría la composición histórica del índice, que no tenemos.
 *
 * Uso: npm run db:refresh-universe --workspace=apps/backend
 */
import { writeFileSync, readFileSync } from 'node:fs';
import {
  parseConstituentsCsv,
  readUniverse,
  MIN_PLAUSIBLE_CONSTITUENTS,
  MAX_PLAUSIBLE_CONSTITUENTS,
  type SweepUniverseFile,
} from '../discovery/sweep-universe.js';

const SOURCE = 'https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv';
const TARGET = new URL('../discovery/sweep-universe.json', import.meta.url);

async function main() {
  console.log(`[Universo] Descargando constituyentes desde ${SOURCE}`);

  let csv: string;
  try {
    const res = await fetch(SOURCE, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    csv = await res.text();
  } catch (err) {
    console.error(`[Universo] ABORTADO — descarga falló: ${(err as Error).message}`);
    console.error('[Universo] El archivo actual NO se tocó.');
    process.exit(1);
  }

  const symbols = parseConstituentsCsv(csv);

  if (symbols.length < MIN_PLAUSIBLE_CONSTITUENTS || symbols.length > MAX_PLAUSIBLE_CONSTITUENTS) {
    console.error(
      `[Universo] ABORTADO — ${symbols.length} símbolos está fuera de la banda plausible ` +
      `[${MIN_PLAUSIBLE_CONSTITUENTS}, ${MAX_PLAUSIBLE_CONSTITUENTS}]. ` +
      'Probablemente la fuente cambió de formato.',
    );
    console.error('[Universo] El archivo actual NO se tocó.');
    process.exit(1);
  }

  // Diff contra lo que había, para que el cambio sea auditable y no un reemplazo a ciegas.
  let previos: string[] = [];
  try {
    const actual = readUniverse(JSON.parse(readFileSync(TARGET, 'utf-8')));
    previos = actual?.symbols ?? [];
  } catch { /* primera corrida o archivo ilegible: el diff sale vacío, no es error */ }

  const antes = new Set(previos);
  const ahora = new Set(symbols);
  const salieron = previos.filter((s) => !ahora.has(s));
  const entraron = symbols.filter((s) => !antes.has(s));

  const payload: SweepUniverseFile = {
    capturedAt: new Date().toISOString().slice(0, 10),
    source: SOURCE,
    caveat:
      'Foto del índice al momento de la captura: arrastra sesgo de supervivencia (solo ' +
      'empresas que ya habían entrado). No usar para backtests sin descontarlo.',
    symbols,
  };
  writeFileSync(TARGET, JSON.stringify(payload, null, 2) + '\n', 'utf-8');

  console.log(`[Universo] ✓ ${symbols.length} símbolos escritos (antes: ${previos.length})`);
  console.log(`[Universo]   salieron (${salieron.length}): ${salieron.join(' ') || '—'}`);
  console.log(`[Universo]   entraron (${entraron.length}): ${entraron.join(' ') || '—'}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[Universo] Error fatal:', err);
  process.exit(1);
});
