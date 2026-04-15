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

  // Delete expired entries for this specific provider+model+key
  db.delete(quotaExhausted)
    .where(and(baseCondition!, lte(quotaExhausted.resetAt, now)))
    .run();

  // Single check for active entries
  const active = db
    .select()
    .from(quotaExhausted)
    .where(baseCondition!)
    .all();

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
 * Resets at next midnight Pacific Time (handles PST/PDT automatically).
 */
export function dailyResetAt(): Date {
  const now = new Date();
  // Get current time in PT using locale string trick (handles DST)
  const ptString = now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
  const nowInPT = new Date(ptString);
  // Next midnight PT = set to tomorrow 00:05 in PT, then convert back to UTC
  const midnightPT = new Date(ptString);
  midnightPT.setHours(24, 5, 0, 0); // next midnight + 5 min buffer
  // Offset between UTC and PT wall clock
  const offsetMs = now.getTime() - nowInPT.getTime();
  return new Date(midnightPT.getTime() + offsetMs);
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
