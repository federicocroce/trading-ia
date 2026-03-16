/**
 * Recalcula las positions del portfolio a partir de las transacciones.
 *
 * Uso: npx tsx src/db/rebuild-positions.ts
 */

import { rebuildPositionsFromTransactions, getAllPositions } from './repository.js';

const count = rebuildPositionsFromTransactions();
console.log(`Recalculadas ${count} posiciones desde transacciones.\n`);

const positions = getAllPositions();
for (const p of positions) {
  console.log(`  ${p.symbol.padEnd(6)} qty: ${p.quantity.toFixed(4).padStart(10)}  avgCost: ${p.avgCost.toFixed(4).padStart(10)}`);
}
