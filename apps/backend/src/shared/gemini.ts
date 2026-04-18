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

const GEMINI_MODELS = [
  'gemini-2.5-pro',
  'gemini-2.5-flash',
] as const;

type GeminiModel = (typeof GEMINI_MODELS)[number];

interface GeminiAttempt {
  keyIndex: number;
  model: GeminiModel;
}

function* attemptOrder(keys: string[]): Generator<GeminiAttempt> {
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

/**
 * askGeminiFlash — solo usa gemini-2.5-flash, preserva quota de Pro para reasoning.
 * Ideal para classification y narrative tasks.
 */
export async function askGeminiFlash(
  userMessage: string,
  systemPrompt: string,
  maxTokens: number = 4096,
): Promise<string> {
  const keys = getApiKeys();
  if (keys.length === 0) throw new Error('No Gemini API keys configured (GOOGLE_AI_API_KEY_1..4)');

  let lastError: Error | null = null;
  let skipped = 0;

  for (let keyIndex = 0; keyIndex < keys.length; keyIndex++) {
    const model: GeminiModel = 'gemini-2.5-flash';
    if (isExhausted('gemini', model, keyIndex)) { skipped++; continue; }

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
          // @ts-ignore — thinkingBudget: 0 disables thinking so the full token budget goes to JSON output
          thinkingConfig: { thinkingBudget: 0 },
        },
      });

      const content = result.response.text();
      if (content) {
        console.log(`[gemini-flash] Success — key: #${keyIndex + 1}`);
        return content;
      }
    } catch (err) {
      const msg = (err as Error).message || '';
      const quota = isQuotaError(msg);
      const retryable = isRetryableError(msg);

      console.warn(
        `[gemini-flash] key#${keyIndex + 1} failed${quota ? ' (quota)' : retryable ? ' (network)' : ''}: ${msg.slice(0, 120)}`,
      );

      if (quota) markExhausted('gemini', model, dailyResetAt(), keyIndex);

      lastError = err as Error;
      if (!retryable) throw err;
    }
  }

  if (skipped > 0 && !lastError) {
    throw new Error(`All Gemini Flash keys quota-exhausted (${skipped} skipped)`);
  }

  throw lastError ?? new Error('All Gemini Flash keys exhausted');
}
