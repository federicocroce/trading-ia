/**
 * Importa transacciones desde mov.js (formato Buenbit).
 * Lee el archivo, parsea todos los arrays de transacciones, e inserta solo las nuevas.
 *
 * Uso:
 *   npx tsx apps/backend/src/db/import-movements.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { db, schema } from './index.js';
import { rebuildPositionsFromTransactions } from './repository.js';

const MOV_PATH = resolve(import.meta.dirname, '../../../../mov.js');

interface BuenbitTx {
  originCurrency: string;
  originAmount: number;
  netAmount: number;
  quantity: number | null;
  price: number | null;
  fee: number;
  symbol: string;
  status: string;
  operation: string;
  uuid: string;
  createdAt: string;
}

function parseMov(filePath: string): BuenbitTx[] {
  const raw = readFileSync(filePath, 'utf-8');

  // Extract all array literals from the file using balanced bracket matching
  const txs: BuenbitTx[] = [];
  let i = 0;
  while (i < raw.length) {
    if (raw[i] === '[') {
      let depth = 0;
      const start = i;
      for (; i < raw.length; i++) {
        if (raw[i] === '[') depth++;
        if (raw[i] === ']') {
          depth--;
          if (depth === 0) { i++; break; }
        }
      }
      const arrayStr = raw.slice(start, i);

      // Normalize JS object syntax to JSON
      const jsonStr = arrayStr
        .replace(/(\w+):/g, '"$1":')          // unquoted keys
        .replace(/'/g, '"')                     // single quotes
        .replace(/,\s*([\]}])/g, '$1')         // trailing commas
        .replace(/:\s*null\b/g, ': null');      // keep nulls

      try {
        const arr = JSON.parse(jsonStr) as BuenbitTx[];
        txs.push(...arr);
      } catch {
        // Try parsing with Function (safe for local file)
        try {
          const arr = new Function(`return ${arrayStr}`)() as BuenbitTx[];
          txs.push(...arr);
        } catch (e2) {
          console.warn(`[import] No se pudo parsear un array: ${(e2 as Error).message}`);
        }
      }
    } else {
      i++;
    }
  }

  return txs;
}

function mapType(operation: string): 'BUY' | 'SELL' | 'DIVIDEND' {
  if (operation === 'DEPOSIT_DIVIDEND') return 'DIVIDEND';
  if (operation === 'WITHDRAW_CRYPTO') return 'SELL';
  return 'BUY';
}

function run() {
  console.log(`[import] Leyendo ${MOV_PATH}...`);
  const allTxs = parseMov(MOV_PATH);
  console.log(`[import] ${allTxs.length} transacciones encontradas en mov.js`);

  // Filter: only COMPLETED with quantity and price
  const valid = allTxs.filter((tx) => {
    if (tx.status !== 'COMPLETED') {
      console.log(`  SKIP ${tx.symbol} ${tx.uuid.slice(0, 8)}... status=${tx.status}`);
      return false;
    }
    if (tx.quantity == null || tx.price == null) {
      console.log(`  SKIP ${tx.symbol} ${tx.uuid.slice(0, 8)}... sin quantity/price`);
      return false;
    }
    return true;
  });

  console.log(`[import] ${valid.length} validas (COMPLETED con quantity+price)`);

  let inserted = 0;
  let skipped = 0;

  for (const tx of valid) {
    // Check duplicate by uuid
    const existing = db.select()
      .from(schema.transactions)
      .where(eq(schema.transactions.externalId, tx.uuid))
      .get();

    if (existing) {
      skipped++;
      continue;
    }

    const type = mapType(tx.operation);
    const date = tx.createdAt.split('T')[0];
    const currency = tx.originCurrency === 'CABLE' ? 'USD' : tx.originCurrency;

    db.insert(schema.transactions).values({
      symbol: tx.symbol,
      type,
      quantity: tx.quantity!,
      price: tx.price!,
      fees: tx.fee ?? 0,
      date,
      currency,
      totalAmount: tx.netAmount,
      platform: 'Buenbit',
      externalId: tx.uuid,
    }).run();

    inserted++;
    console.log(`  + ${type} ${tx.quantity} ${tx.symbol} @ ${tx.price} ${currency} [${date}]`);
  }

  console.log(`\n[import] Resultado: ${inserted} insertadas, ${skipped} ya existian`);

  if (inserted > 0) {
    rebuildPositionsFromTransactions();
    console.log('[import] Posiciones del portfolio recalculadas.');
  } else {
    console.log('[import] Sin cambios en el portfolio.');
  }
}

run();
