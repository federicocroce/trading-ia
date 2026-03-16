import { db, schema } from './index.js';
import { eq } from 'drizzle-orm';

const SEED_SYMBOLS = [
  { symbol: 'VIST', name: 'Vista Energy', type: 'adr' as const, flag: '🇦🇷', plaza: 'argentina-energy' as const },
  { symbol: 'YPF', name: 'YPF S.A.', type: 'adr' as const, flag: '🇦🇷', plaza: 'argentina-energy' as const },
  { symbol: 'PAM', name: 'Pampa Energía', type: 'adr' as const, flag: '🇦🇷', plaza: 'argentina-energy' as const },
  { symbol: 'GGAL', name: 'Grupo Financiero Galicia', type: 'adr' as const, flag: '🇦🇷', plaza: 'argentina-finance' as const },
  { symbol: 'BMA', name: 'Banco Macro', type: 'adr' as const, flag: '🇦🇷', plaza: 'argentina-finance' as const },
  { symbol: 'TGS', name: 'Transportadora de Gas del Sur', type: 'adr' as const, flag: '🇦🇷', plaza: 'argentina-energy' as const },
  { symbol: 'CEPU', name: 'Central Puerto', type: 'adr' as const, flag: '🇦🇷', plaza: 'argentina-energy' as const },
  { symbol: 'XOM', name: 'Exxon Mobil', type: 'us' as const, flag: '🇺🇸', plaza: 'us-energy' as const },
  { symbol: 'CVX', name: 'Chevron', type: 'us' as const, flag: '🇺🇸', plaza: 'us-energy' as const },
  { symbol: 'BTC-USD', name: 'Bitcoin', type: 'crypto' as const, flag: '🌐', plaza: 'crypto' as const },
  { symbol: 'ETH-USD', name: 'Ethereum', type: 'crypto' as const, flag: '🌐', plaza: 'crypto' as const },
];

const SEED_POSITIONS = [
  { symbol: 'VIST', quantity: 150, avgCost: 42.50 },
  { symbol: 'YPF', quantity: 200, avgCost: 22.80 },
  { symbol: 'PAM', quantity: 100, avgCost: 58.30 },
  { symbol: 'GGAL', quantity: 300, avgCost: 38.90 },
  { symbol: 'BMA', quantity: 120, avgCost: 52.10 },
  { symbol: 'TGS', quantity: 180, avgCost: 23.40 },
  { symbol: 'CEPU', quantity: 250, avgCost: 8.75 },
  { symbol: 'XOM', quantity: 50, avgCost: 105.20 },
  { symbol: 'CVX', quantity: 40, avgCost: 152.60 },
];

export function seedDatabase() {
  const existingSymbols = db.select().from(schema.symbols).all();
  if (existingSymbols.length > 0) {
    console.log(`[db] Database already has ${existingSymbols.length} symbols, skipping seed.`);
    return;
  }

  console.log('[db] Seeding database...');

  // Insert symbols
  for (const s of SEED_SYMBOLS) {
    db.insert(schema.symbols).values(s).run();
  }
  console.log(`[db] Inserted ${SEED_SYMBOLS.length} symbols.`);

  // Insert positions
  for (const p of SEED_POSITIONS) {
    db.insert(schema.positions).values(p).run();
  }
  console.log(`[db] Inserted ${SEED_POSITIONS.length} positions.`);

  console.log('[db] Seed complete.');
}

// Run directly if called as script
if (process.argv[1]?.includes('seed')) {
  seedDatabase();
}
