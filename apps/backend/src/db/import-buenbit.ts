/**
 * Importador masivo de transacciones desde JSON de Buenbit API.
 *
 * Uso:
 *   npx tsx src/db/import-buenbit.ts < data.json
 *   npx tsx src/db/import-buenbit.ts --file /path/to/data.json
 *
 * Mapeo de operaciones Buenbit → tipo interno:
 *   DEPOSIT_CRYPTO  → BUY
 *   WITHDRAW_CRYPTO → SELL
 *   DEPOSIT_DIVIDEND → DIVIDEND
 *
 * Moneda: originCurrency (USDC, CABLE, etc.)
 * Total: netAmount (monto neto efectivamente invertido)
 * ExternalId: uuid (único por operación)
 */

import { readFileSync } from 'fs';
import { eq } from 'drizzle-orm';
import { db, schema } from './index.js';

interface BuenbitTransaction {
  originCurrency: string;
  originAmount: number;
  netAmount: number;
  quantity: number;
  price: number;
  fee: number;
  symbol: string;
  status: string;
  operation: string;
  transactionId: string | null;
  uuid: string;
  createdAt: string;
}

function mapOperation(op: string): 'BUY' | 'SELL' | 'DIVIDEND' {
  switch (op) {
    case 'DEPOSIT_CRYPTO': return 'BUY';
    case 'WITHDRAW_CRYPTO': return 'SELL';
    case 'DEPOSIT_DIVIDEND': return 'DIVIDEND';
    default:
      console.warn(`  Operacion desconocida: ${op}, mapeando como BUY`);
      return 'BUY';
  }
}

function mapCurrency(cur: string): string {
  // CABLE = dólar cable (USD via transferencia), lo mapeamos a USD
  if (cur === 'CABLE') return 'USD';
  return cur;
}

// Read input
let jsonData: string;
const args = process.argv.slice(2);
const fileIdx = args.indexOf('--file');

if (fileIdx !== -1 && args[fileIdx + 1]) {
  jsonData = readFileSync(args[fileIdx + 1], 'utf-8');
} else {
  // Read from stdin
  jsonData = readFileSync(0, 'utf-8');
}

const transactions: BuenbitTransaction[] = JSON.parse(jsonData);

console.log(`Importando ${transactions.length} transacciones de Buenbit...\n`);

let imported = 0;
let skipped = 0;
let errors = 0;

for (const tx of transactions) {
  if (tx.status !== 'COMPLETED') {
    console.log(`  SKIP [${tx.status}] ${tx.symbol} ${tx.operation} - no completada`);
    skipped++;
    continue;
  }

  // Check duplicate by uuid
  const existing = db.select()
    .from(schema.transactions)
    .where(eq(schema.transactions.externalId, tx.uuid))
    .get();

  if (existing) {
    console.log(`  SKIP [DUP] ${tx.symbol} ${tx.operation} uuid=${tx.uuid.slice(0, 8)}...`);
    skipped++;
    continue;
  }

  const type = mapOperation(tx.operation);
  const currency = mapCurrency(tx.originCurrency);
  const date = tx.createdAt.split('T')[0]; // YYYY-MM-DD

  try {
    db.insert(schema.transactions).values({
      symbol: tx.symbol.toUpperCase(),
      type,
      quantity: tx.quantity,
      price: tx.price,
      fees: tx.fee,
      date,
      currency,
      totalAmount: tx.netAmount,
      platform: 'Buenbit',
      externalId: tx.uuid,
      notes: tx.transactionId ? `TxID: ${tx.transactionId}` : undefined,
    }).run();

    const label = type === 'DIVIDEND' ? 'DIV' : type;
    console.log(`  OK   [${label}] ${tx.quantity.toFixed(4)} ${tx.symbol} @ ${tx.price.toFixed(4)} ${currency} = ${tx.netAmount.toFixed(2)} ${currency} (${date})`);
    imported++;
  } catch (err) {
    console.error(`  ERR  ${tx.symbol} ${tx.operation}: ${err}`);
    errors++;
  }
}

console.log(`\nResultado: ${imported} importadas, ${skipped} omitidas, ${errors} errores`);
