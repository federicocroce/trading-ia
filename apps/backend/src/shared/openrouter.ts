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

const OPENROUTER_FREE_MODELS = [
  'qwen/qwen3-235b-a22b:free',
  'qwen/qwen3-30b-a3b:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'meta-llama/llama-4-scout:free',
  'google/gemma-4-31b-it:free',
  'microsoft/phi-4-reasoning:free',
] as const;

export async function askOpenRouter(
  userMessage: string,
  systemPrompt: string,
  maxTokens: number = 4096,
): Promise<string> {
  let lastError: Error | null = null;

  for (const model of OPENROUTER_FREE_MODELS) {
    if (isExhausted('openrouter', model)) continue;

    // Reasoning models (DeepSeek R1, etc.) use tokens for chain-of-thought before the JSON.
    // Double the limit so the thinking block doesn't crowd out the actual response.
    const isReasoningModel = model.includes('r1') || model.includes('deepseek');
    const effectiveMaxTokens = isReasoningModel ? Math.min(maxTokens * 2, 16384) : maxTokens;

    try {
      const response = await getClient().chat.completions.create({
        model,
        max_tokens: effectiveMaxTokens,
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
      const is404 = msg.includes('404') || msg.includes('No endpoints found') || msg.includes('not found');
      const shouldRotate =
        is429 ||
        is404 ||
        msg.includes('decommissioned') ||
        msg.includes('no longer supported') ||
        msg.includes('overloaded') ||
        msg.includes('unavailable');

      console.warn(`[openrouter] ${model} failed: ${msg.slice(0, 120)}`);

      if (is429) markExhausted('openrouter', model, minuteResetAt());
      if (is404) markExhausted('openrouter', model, new Date(Date.now() + 24 * 60 * 60 * 1000));

      lastError = err as Error;
      if (!shouldRotate) throw err;
    }
  }

  throw lastError ?? new Error('All OpenRouter models failed or exhausted');
}
