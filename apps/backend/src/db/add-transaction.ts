/**
 * CLI para cargar transacciones desde comprobantes de Buenbit/Balanz/etc.
 *
 * Uso:
 *   npx tsx src/db/add-transaction.ts \
 *     --symbol GGAL \
 *     --type BUY \
 *     --quantity 42.0487 \
 *     --price 47.56 \
 *     --currency USDC \
 *     --total 2000 \
 *     --fees 0 \
 *     --date 2025-07-17 \
 *     --platform Buenbit \
 *     --extid "bcf4940...d8b0c92"
 */

import { eq } from 'drizzle-orm';
import { db, schema } from './index.js';
import { rebuildPositionsFromTransactions } from './repository.js';

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const val = args[i + 1] ?? '';
      result[key] = val;
      i++;
    }
  }
  return result;
}

const args = parseArgs(process.argv.slice(2));

// Validate required fields
const required = ['symbol', 'type', 'quantity', 'price', 'date'];
for (const field of required) {
  if (!args[field]) {
    console.error(`Error: --${field} es requerido`);
    process.exit(1);
  }
}

const data = {
  symbol: args.symbol.toUpperCase(),
  type: args.type.toUpperCase() as 'BUY' | 'SELL' | 'DIVIDEND',
  quantity: parseFloat(args.quantity),
  price: parseFloat(args.price),
  fees: args.fees ? parseFloat(args.fees) : 0,
  date: args.date,
  currency: args.currency ?? 'USD',
  totalAmount: args.total ? parseFloat(args.total) : undefined,
  platform: args.platform ?? undefined,
  externalId: args.extid ?? undefined,
  notes: args.notes ?? undefined,
};

// Check for duplicate externalId
if (data.externalId) {
  const existing = db.select()
    .from(schema.transactions)
    .where(eq(schema.transactions.externalId, data.externalId))
    .get();
  if (existing) {
    console.error(`DUPLICADO: Ya existe una transaccion con externalId="${data.externalId}"`);
    process.exit(1);
  }
}

db.insert(schema.transactions).values(data).run();

const total = data.totalAmount ?? data.quantity * data.price;
console.log(`OK: ${data.type} ${data.quantity} ${data.symbol} @ ${data.price} ${data.currency} = ${total.toFixed(2)} ${data.currency} [${data.platform ?? '-'}]`);

// Recalcular posiciones del portfolio
rebuildPositionsFromTransactions();
console.log('Posiciones del portfolio recalculadas.');
