/**
 * Regenera `sweep-universe.json`: el universo que recorre el barrido semanal de bases.
 *
 * ⚠️ Este universo se define por LIQUIDEZ Y TAMAÑO, no por pertenecer a un índice.
 * El motivo está en `sweep-universe.ts`, y vale repetirlo porque fue un error caro: el
 * universo anterior era el S&P 500, y **IREN —el caso que motivó construir el barrido— no
 * estaba en él**. Tampoco WULF, HUT, MARA, RIOT, CLSK, VIST ni SOFI; 7 de las 8 posiciones
 * de la cartera quedaban afuera. Se había construido un detector de mid/small caps
 * castigadas y se lo apuntaba a las large caps más establecidas del mercado.
 *
 * FAIL-CLOSED en cada punta: descarga fallida, JSON inesperado, o conteo fuera de las
 * bandas de plausibilidad ⇒ **no se escribe nada** y sale con 1. Un universo viejo pero
 * válido siempre es mejor que uno nuevo y roto: quedarse con el viejo es visible (el
 * barrido loguea su antigüedad en cada corrida), romperlo no.
 *
 * Uso: npm run db:refresh-universe --workspace=apps/backend
 */
import { writeFileSync, readFileSync } from 'node:fs';
import {
  parseScreenerRows,
  parseScreenerRowsWithCaps,
  readUniverse,
  MIN_PLAUSIBLE_UNIVERSE,
  MAX_PLAUSIBLE_UNIVERSE,
  type ScreenerRow,
  type SweepUniverseFile,
} from '../discovery/sweep-universe.js';

const SOURCE = 'https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=10000&download=true';
const TARGET = new URL('../discovery/sweep-universe.json', import.meta.url);

async function main() {
  console.log('[Universo] Descargando listado completo de acciones US...');

  let rows: ScreenerRow[];
  try {
    const res = await fetch(SOURCE, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json() as { data?: { rows?: ScreenerRow[] } };
    rows = json?.data?.rows ?? [];
    if (!Array.isArray(rows) || rows.length === 0) throw new Error('respuesta sin filas');
  } catch (err) {
    console.error(`[Universo] ABORTADO — descarga falló: ${(err as Error).message}`);
    console.error('[Universo] El archivo actual NO se tocó.');
    process.exit(1);
  }

  console.log(`[Universo] ${rows.length} listados crudos`);
  const marketCaps = parseScreenerRowsWithCaps(rows);
  const symbols = Object.keys(marketCaps).sort();

  if (symbols.length < MIN_PLAUSIBLE_UNIVERSE || symbols.length > MAX_PLAUSIBLE_UNIVERSE) {
    console.error(
      `[Universo] ABORTADO — ${symbols.length} símbolos está fuera de la banda plausible ` +
      `[${MIN_PLAUSIBLE_UNIVERSE}, ${MAX_PLAUSIBLE_UNIVERSE}]. Probablemente la fuente ` +
      'cambió de formato o de campos.',
    );
    console.error('[Universo] El archivo actual NO se tocó.');
    process.exit(1);
  }

  // Diff contra lo que había: el cambio queda auditable, no es un reemplazo a ciegas.
  let previos: string[] = [];
  try {
    previos = readUniverse(JSON.parse(readFileSync(TARGET, 'utf-8')))?.symbols ?? [];
  } catch { /* primera corrida o archivo ilegible: diff vacío, no es error */ }

  const antes = new Set(previos);
  const ahora = new Set(symbols);
  const salieron = previos.filter((s) => !ahora.has(s));
  const entraron = symbols.filter((s) => !antes.has(s));

  const payload: SweepUniverseFile = {
    capturedAt: new Date().toISOString().slice(0, 10),
    source: 'nasdaq screener (todo lo listado en US) filtrado por quality bar: marketCap >= $500M y precio >= $5',
    caveat:
      'Universo por LIQUIDEZ, no por índice — sin sesgo de pertenencia. Queda el sesgo de ' +
      '"listado hoy": las empresas deslistadas no aparecen. Regenerar con db:refresh-universe.',
    symbols,
    marketCaps,
  };
  writeFileSync(TARGET, JSON.stringify(payload, null, 2) + '\n', 'utf-8');

  console.log(`[Universo] ✓ ${symbols.length} símbolos escritos (antes: ${previos.length})`);
  console.log(`[Universo]   entraron: ${entraron.length}`);
  console.log(`[Universo]   salieron: ${salieron.length}${salieron.length ? ' — ' + salieron.slice(0, 20).join(' ') : ''}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[Universo] Error fatal:', err);
  process.exit(1);
});
