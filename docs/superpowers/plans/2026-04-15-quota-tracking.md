# Quota Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track AI provider quota exhaustion in SQLite so exhausted models/keys are skipped until their reset time, eliminating wasted retries.

**Architecture:** Add a `quota_exhausted` table to SQLite. Each provider module (gemini.ts, groq.ts, openrouter.ts) calls `markQuotaExhausted(provider, model, keyIndex?)` on 429/quota errors and `isQuotaExhausted(provider, model, keyIndex?)` before attempting. Reset times are calculated per provider type (daily for Gemini, per-minute for Groq, per-minute for OpenRouter). A shared `quota-tracker.ts` module owns all DB logic.

**Tech Stack:** Drizzle ORM + better-sqlite3 (existing), TypeScript, no new dependencies.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `apps/backend/src/db/schema.ts` | Modify | Add `quotaExhausted` table definition |
| `apps/backend/drizzle/0015_quota_exhausted.sql` | Create | Migration SQL for new table |
| `apps/backend/src/shared/quota-tracker.ts` | Create | `isExhausted()`, `markExhausted()`, `clearExpired()` |
| `apps/backend/src/shared/gemini.ts` | Modify | Skip exhausted model+key combos, mark on quota error |
| `apps/backend/src/shared/groq.ts` | Modify | Skip exhausted models, mark on 429, reset after 60s |
| `apps/backend/src/shared/openrouter.ts` | Modify | Skip exhausted models, mark on 429, reset after 60s |

---

## Task 1: DB Schema + Migration

**Files:**
- Modify: `apps/backend/src/db/schema.ts`
- Create: `apps/backend/drizzle/0015_quota_exhausted.sql`

- [ ] **Step 1: Add table to schema.ts**

Open `apps/backend/src/db/schema.ts` and add at the end (before the last closing brace if any, after existing table definitions):

```typescript
export const quotaExhausted = sqliteTable('quota_exhausted', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  provider: text('provider').notNull(),   // 'gemini' | 'groq' | 'openrouter'
  model: text('model').notNull(),
  keyIndex: integer('key_index'),         // null for groq/openrouter (no key rotation)
  exhaustedAt: text('exhausted_at').notNull().default(sql`(datetime('now'))`),
  resetAt: text('reset_at').notNull(),    // ISO timestamp when quota resets
});
```

- [ ] **Step 2: Create migration SQL file**

Create `apps/backend/drizzle/0015_quota_exhausted.sql`:

```sql
CREATE TABLE IF NOT EXISTS `quota_exhausted` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `provider` text NOT NULL,
  `model` text NOT NULL,
  `key_index` integer,
  `exhausted_at` text DEFAULT (datetime('now')) NOT NULL,
  `reset_at` text NOT NULL
);
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/federicocroce/Documents/Fede/trading
npx tsc --noEmit -p apps/backend/tsconfig.json
```

Expected: no output (no errors)

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/db/schema.ts apps/backend/drizzle/0015_quota_exhausted.sql
git commit -m "feat(quota): add quota_exhausted table to schema + migration"
```

---

## Task 2: quota-tracker.ts module

**Files:**
- Create: `apps/backend/src/shared/quota-tracker.ts`

- [ ] **Step 1: Create the module**

Create `apps/backend/src/shared/quota-tracker.ts`:

```typescript
import { db } from '../db/index.js';
import { quotaExhausted } from '../db/schema.js';
import { and, eq, isNull } from 'drizzle-orm';

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

  // Delete expired entries for this provider+model+key first
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
  // Remove existing entry first (upsert via delete+insert)
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
 * Resets at midnight Pacific Time (UTC-7 or UTC-8).
 */
export function dailyResetAt(): Date {
  const now = new Date();
  // Pacific Time offset: -7 (PDT) or -8 (PST) — use -7 as conservative estimate
  const pacificOffset = -7 * 60; // minutes
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const pacificMinutes = utcMinutes + pacificOffset;
  
  // Minutes until next midnight PT
  const minutesUntilMidnight = pacificMinutes >= 0
    ? (24 * 60) - pacificMinutes
    : -pacificMinutes;

  const resetAt = new Date(now.getTime() + minutesUntilMidnight * 60 * 1000);
  // Add 5 min buffer to ensure quota has actually reset
  resetAt.setMinutes(resetAt.getMinutes() + 5);
  return resetAt;
}

/**
 * Calculate reset time for per-minute quota providers (Groq, OpenRouter).
 * Resets after 65 seconds (with 5s buffer).
 */
export function minuteResetAt(): Date {
  return new Date(Date.now() + 65 * 1000);
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/federicocroce/Documents/Fede/trading
npx tsc --noEmit -p apps/backend/tsconfig.json
```

Expected: no output (no errors)

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/shared/quota-tracker.ts
git commit -m "feat(quota): add quota-tracker module with isExhausted/markExhausted"
```

---

## Task 3: Integrate quota-tracker into gemini.ts

**Files:**
- Modify: `apps/backend/src/shared/gemini.ts`

Gemini has **daily limits** per key per model. Reset = midnight PT + 5 min buffer.
Mark exhaustion per `(model, keyIndex)` combo.

- [ ] **Step 1: Update gemini.ts**

Replace the entire content of `apps/backend/src/shared/gemini.ts` with:

```typescript
import { GoogleGenerativeAI } from '@google/generative-ai';
import { isExhausted, markExhausted, dailyResetAt } from './quota-tracker.js';

// Keys read lazily so dotenv has time to load before first call
function getApiKeys(): string[] {
  return [
    process.env.GOOGLE_AI_API_KEY_1,
    process.env.GOOGLE_AI_API_KEY_2,
    process.env.GOOGLE_AI_API_KEY_3,
    process.env.GOOGLE_AI_API_KEY_4,
  ].filter((k): k is string => !!k);
}

// Models ordered by reasoning capability (best → worst)
// Pro: 25 req/day per key | Flash: 500 req/day per key
const GEMINI_MODELS = [
  'gemini-2.5-pro',    // #1 — best reasoning, 25 RPD
  'gemini-2.5-flash',  // #2 — fast + thinking mode, 500 RPD
] as const;

type GeminiModel = (typeof GEMINI_MODELS)[number];

interface GeminiAttempt {
  keyIndex: number;
  model: GeminiModel;
}

function* attemptOrder(keys: string[]): Generator<GeminiAttempt> {
  // Pro key1 → Pro key2 → ... → Flash key1 → Flash key2 → ...
  for (const model of GEMINI_MODELS) {
    for (let keyIndex = 0; keyIndex < keys.length; keyIndex++) {
      yield { keyIndex, model };
    }
  }
}

function isQuotaError(msg: string): boolean {
  return (
    msg.includes('429') ||
    msg.includes('quota') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('rate_limit')
  );
}

function isRetryableError(msg: string): boolean {
  return (
    isQuotaError(msg) ||
    msg.includes('overloaded') ||
    msg.includes('unavailable') ||
    msg.includes('503') ||
    msg.includes('502') ||
    msg.includes('500') ||
    msg.includes('fetch failed') ||
    msg.includes('network') ||
    msg.includes('timeout') ||
    msg.includes('ECONNRESET') ||
    msg.includes('ETIMEDOUT')
  );
}

export async function askGemini(
  userMessage: string,
  systemPrompt: string,
  maxTokens: number = 4096,
): Promise<string> {
  const keys = getApiKeys();

  if (keys.length === 0) {
    throw new Error('No Gemini API keys configured (GOOGLE_AI_API_KEY_1..4)');
  }

  let lastError: Error | null = null;
  let skipped = 0;

  for (const { keyIndex, model } of attemptOrder(keys)) {
    // Skip if quota exhausted for this model+key combo
    if (isExhausted('gemini', model, keyIndex)) {
      skipped++;
      continue;
    }

    const client = new GoogleGenerativeAI(keys[keyIndex]);
    const genModel = client.getGenerativeModel({
      model,
      systemInstruction: systemPrompt + '\n\nResponde SOLO con JSON valido.',
    });

    try {
      const result = await genModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature: 0.1,
          responseMimeType: 'application/json',
        },
      });

      const content = result.response.text();
      if (content) {
        console.log(`[gemini] Success — model: ${model}, key: #${keyIndex + 1}`);
        return content;
      }
    } catch (err) {
      const msg = (err as Error).message || '';
      const quota = isQuotaError(msg);
      const retryable = isRetryableError(msg);

      console.warn(
        `[gemini] ${model} key#${keyIndex + 1} failed${quota ? ' (quota)' : retryable ? ' (network)' : ''}: ${msg.slice(0, 120)}`,
      );

      if (quota) {
        // Daily limit — mark until midnight PT
        markExhausted('gemini', model, dailyResetAt(), keyIndex);
      }

      lastError = err as Error;
      if (!retryable) throw err;
    }
  }

  if (skipped > 0 && !lastError) {
    throw new Error(`All Gemini model+key combos quota-exhausted (${skipped} skipped)`);
  }

  throw lastError ?? new Error('All Gemini keys and models exhausted');
}

export function isGeminiAvailable(): boolean {
  return getApiKeys().length > 0;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/federicocroce/Documents/Fede/trading
npx tsc --noEmit -p apps/backend/tsconfig.json
```

Expected: no output

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/shared/gemini.ts
git commit -m "feat(quota): gemini skips exhausted model+key combos, marks daily reset"
```

---

## Task 4: Integrate quota-tracker into groq.ts

**Files:**
- Modify: `apps/backend/src/shared/groq.ts`

Groq 429s are **per-minute** rate limits — reset after 65 seconds.
Mark exhaustion per `model` (no key rotation in Groq).

- [ ] **Step 1: Update groq.ts**

Replace the full content of `apps/backend/src/shared/groq.ts`:

```typescript
import Groq from 'groq-sdk';
import { isExhausted, markExhausted, minuteResetAt } from './quota-tracker.js';

let client: Groq | null = null;

function getClient(): Groq {
  if (!client) {
    client = new Groq();
  }
  return client;
}

// Models to try in order — each has its own rate limit pool
const GROQ_MODELS = [
  'llama-3.3-70b-versatile',
  'llama-3.1-70b-versatile',
  'mixtral-8x7b-32768',
  'llama-3.1-8b-instant',
] as const;

export type GroqModel = (typeof GROQ_MODELS)[number];

export interface GroqResult {
  content: string;
  model: GroqModel;
}

export async function askGroq(
  userMessage: string,
  systemPrompt: string,
  maxTokens: number = 4096,
): Promise<string> {
  const result = await askGroqWithRotation(userMessage, systemPrompt, maxTokens);
  return result.content;
}

// Lighter model pool — for classification/narrative tasks that don't need 70B
const GROQ_LIGHT_MODELS = [
  'llama-3.1-8b-instant',
  'mixtral-8x7b-32768',
] as const;

export async function askGroqLight(
  userMessage: string,
  systemPrompt: string,
  maxTokens: number = 2048,
): Promise<string> {
  let lastError: Error | null = null;

  for (const model of GROQ_LIGHT_MODELS) {
    if (isExhausted('groq', model)) {
      continue;
    }

    try {
      const response = await getClient().chat.completions.create({
        model,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' },
      });

      const content = response.choices[0]?.message?.content ?? '';
      if (content) {
        console.log(`[groq-light] Success with model: ${model}`);
        return content;
      }
    } catch (err) {
      const msg = (err as Error).message || '';
      const is429 = msg.includes('429') || msg.includes('rate_limit');
      const isDecommissioned = msg.includes('decommissioned') || msg.includes('no longer supported');
      const shouldRotate = is429 || isDecommissioned;

      console.warn(`[groq-light] ${model} failed${is429 ? ' (rate limit)' : isDecommissioned ? ' (decommissioned)' : ''}: ${msg.slice(0, 120)}`);

      if (is429) {
        markExhausted('groq', model, minuteResetAt());
      }

      lastError = err as Error;
      if (!shouldRotate) throw err;
    }
  }

  throw lastError ?? new Error('All Groq light models rate limited');
}

export async function askGroqWithRotation(
  userMessage: string,
  systemPrompt: string,
  maxTokens: number = 4096,
): Promise<GroqResult> {
  let lastError: Error | null = null;

  for (const model of GROQ_MODELS) {
    if (isExhausted('groq', model)) {
      continue;
    }

    try {
      const response = await getClient().chat.completions.create({
        model,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' },
      });

      const content = response.choices[0]?.message?.content ?? '';
      if (content) {
        console.log(`[groq] Success with model: ${model}`);
        return { content, model };
      }
    } catch (err) {
      const msg = (err as Error).message || '';
      const is429 = msg.includes('429') || msg.includes('rate_limit');
      const isDecommissioned = msg.includes('decommissioned') || msg.includes('no longer supported');
      const shouldRotate = is429 || isDecommissioned;

      console.warn(`[groq] ${model} failed${is429 ? ' (rate limit)' : isDecommissioned ? ' (decommissioned)' : ''}: ${msg.slice(0, 120)}`);

      if (is429) {
        markExhausted('groq', model, minuteResetAt());
      }

      lastError = err as Error;
      if (!shouldRotate) throw err;
    }
  }

  throw lastError ?? new Error('All Groq models rate limited or exhausted');
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/federicocroce/Documents/Fede/trading
npx tsc --noEmit -p apps/backend/tsconfig.json
```

Expected: no output

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/shared/groq.ts
git commit -m "feat(quota): groq skips exhausted models, marks 65s reset on 429"
```

---

## Task 5: Integrate quota-tracker into openrouter.ts

**Files:**
- Modify: `apps/backend/src/shared/openrouter.ts`

OpenRouter free tier 429s are **per-minute** — same 65s reset as Groq.

- [ ] **Step 1: Update openrouter.ts**

Replace the full content of `apps/backend/src/shared/openrouter.ts`:

```typescript
import OpenAI from 'openai';
import { isExhausted, markExhausted, minuteResetAt } from './quota-tracker.js';

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: process.env.OPENROUTER_API_KEY,
    });
  }
  return client;
}

// Free models on OpenRouter — ordered by reasoning capability (best → worst)
const OPENROUTER_FREE_MODELS = [
  'deepseek/deepseek-r1:free',
  'deepseek/deepseek-r1-distill-llama-70b:free',
  'qwen/qwen3-235b-a22b:free',
  'nousresearch/hermes-3-llama-3.1-405b:free',
  'qwen/qwen3-30b-a3b:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'google/gemma-4-31b-it:free',
] as const;

export async function askOpenRouter(
  userMessage: string,
  systemPrompt: string,
  maxTokens: number = 4096,
): Promise<string> {
  let lastError: Error | null = null;

  for (const model of OPENROUTER_FREE_MODELS) {
    if (isExhausted('openrouter', model)) {
      continue;
    }

    try {
      const response = await getClient().chat.completions.create({
        model,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: systemPrompt + '\n\nResponde SOLO con JSON valido.' },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.1,
      });

      const content = response.choices[0]?.message?.content ?? '';
      if (content) {
        console.log(`[openrouter] Success with model: ${model}`);
        return content;
      }
    } catch (err) {
      const msg = (err as Error).message || '';
      const is429 = msg.includes('429') || msg.includes('rate_limit');
      const shouldRotate =
        is429 ||
        msg.includes('decommissioned') ||
        msg.includes('no longer supported') ||
        msg.includes('overloaded') ||
        msg.includes('unavailable');

      console.warn(`[openrouter] ${model} failed: ${msg.slice(0, 120)}`);

      if (is429) {
        markExhausted('openrouter', model, minuteResetAt());
      }

      lastError = err as Error;
      if (!shouldRotate) throw err;
    }
  }

  throw lastError ?? new Error('All OpenRouter models failed or exhausted');
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/federicocroce/Documents/Fede/trading
npx tsc --noEmit -p apps/backend/tsconfig.json
```

Expected: no output

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/shared/openrouter.ts
git commit -m "feat(quota): openrouter skips exhausted models, marks 65s reset on 429"
```

---

## Task 6: Startup cleanup of stale quota entries

**Files:**
- Modify: `apps/backend/src/db/init.ts`

On server restart, clear all expired quota entries so fresh state starts clean.

- [ ] **Step 1: Add clearExpiredQuota to init**

In `apps/backend/src/db/init.ts`, add after the existing imports:

```typescript
import { db } from './index.js';
import { quotaExhausted } from './schema.js';
import { lte } from 'drizzle-orm';
```

And inside `initDatabase()`, add before the final `console.log`:

```typescript
// Clear expired quota entries on startup
const now = new Date().toISOString();
const cleared = db.delete(quotaExhausted)
  .where(lte(quotaExhausted.resetAt, now))
  .run();
if (cleared.changes > 0) {
  console.log(`[db] Cleared ${cleared.changes} expired quota entries.`);
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/federicocroce/Documents/Fede/trading
npx tsc --noEmit -p apps/backend/tsconfig.json
```

Expected: no output

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/db/init.ts
git commit -m "feat(quota): clear expired quota entries on server startup"
```

---

## Task 7: End-to-end smoke test

- [ ] **Step 1: Restart server and watch logs**

```bash
npm run dev
```

Expected in logs:
- `[db] Database ready.` — migration applied
- If Gemini Pro was exhausted: `[quota] gemini/gemini-2.5-pro key#1 exhausted until ...`
- Next run skips Pro immediately and goes to Flash: no 4x Pro retries
- `[gemini] Success — model: gemini-2.5-flash, key: #1`

- [ ] **Step 2: Verify quota entries in DB**

```bash
cd /Users/federicocroce/Documents/Fede/trading
node -e "
import('./apps/backend/src/db/index.js').then(({db}) =>
  import('./apps/backend/src/db/schema.js').then(({quotaExhausted}) => {
    const rows = db.select().from(quotaExhausted).all();
    console.table(rows);
  })
);
"
```

Expected: table showing exhausted entries with `reset_at` values in the future.

- [ ] **Step 3: Confirm pipeline runs faster**

Trigger the pipeline and confirm logs no longer show 4x Pro retry attempts before reaching Flash.
