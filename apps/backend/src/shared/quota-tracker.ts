import { db } from '../db/index.js';
import { quotaExhausted } from '../db/schema.js';
import { and, eq, isNull, lte } from 'drizzle-orm';

export type QuotaProvider = 'gemini' | 'groq' | 'openrouter';

/**
 * Returns true if this model+key combo is currently quota-exhausted.
 * Automatically clears expired entries before checking.
 */
export function isExhausted(
  provider: QuotaProvider,
  model: string,
  keyIndex?: number,
): boolean {
  const now = new Date().toISOString();

  const baseCondition = and(
    eq(quotaExhausted.provider, provider),
    eq(quotaExhausted.model, model),
    keyIndex !== undefined
      ? eq(quotaExhausted.keyIndex, keyIndex)
      : isNull(quotaExhausted.keyIndex),
  );

  const rows = db
    .select()
    .from(quotaExhausted)
    .where(baseCondition!)
    .all();

  // Clear expired ones
  for (const row of rows) {
    if (row.resetAt <= now) {
      db.delete(quotaExhausted)
        .where(eq(quotaExhausted.id, row.id))
        .run();
    }
  }

  // Re-check if any active entry remains
  const active = db
    .select()
    .from(quotaExhausted)
    .where(baseCondition!)
    .all()
    .filter(r => r.resetAt > now);

  return active.length > 0;
}

/**
 * Mark a model+key as quota-exhausted until resetAt.
 * Upserts — replaces existing entry if present.
 */
export function markExhausted(
  provider: QuotaProvider,
  model: string,
  resetAt: Date,
  keyIndex?: number,
): void {
  const baseCondition = and(
    eq(quotaExhausted.provider, provider),
    eq(quotaExhausted.model, model),
    keyIndex !== undefined
      ? eq(quotaExhausted.keyIndex, keyIndex)
      : isNull(quotaExhausted.keyIndex),
  );

  db.delete(quotaExhausted).where(baseCondition!).run();

  db.insert(quotaExhausted).values({
    provider,
    model,
    keyIndex: keyIndex ?? null,
    exhaustedAt: new Date().toISOString(),
    resetAt: resetAt.toISOString(),
  }).run();

  const label = keyIndex !== undefined ? `${model} key#${keyIndex + 1}` : model;
  console.log(`[quota] ${provider}/${label} exhausted until ${resetAt.toISOString()}`);
}

/**
 * Calculate reset time for daily quota providers (Gemini).
 * Resets at midnight Pacific Time (UTC-7).
 */
export function dailyResetAt(): Date {
  const now = new Date();
  const pacificOffset = -7 * 60; // minutes (PDT)
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const pacificMinutes = utcMinutes + pacificOffset;

  const minutesUntilMidnight = pacificMinutes >= 0
    ? (24 * 60) - pacificMinutes
    : -pacificMinutes;

  const resetAt = new Date(now.getTime() + minutesUntilMidnight * 60 * 1000);
  resetAt.setMinutes(resetAt.getMinutes() + 5); // 5 min buffer
  return resetAt;
}

/**
 * Calculate reset time for per-minute quota providers (Groq, OpenRouter).
 * Resets after 65 seconds (with 5s buffer).
 */
export function minuteResetAt(): Date {
  return new Date(Date.now() + 65 * 1000);
}

/**
 * Clear all expired quota entries (call on startup).
 */
export function clearExpiredQuota(): void {
  const now = new Date().toISOString();
  const result = db.delete(quotaExhausted)
    .where(lte(quotaExhausted.resetAt, now))
    .run();
  if (result.changes > 0) {
    console.log(`[quota] Cleared ${result.changes} expired quota entries.`);
  }
}
