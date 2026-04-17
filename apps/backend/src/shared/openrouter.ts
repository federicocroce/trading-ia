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
      const shouldRotate =
        is429 ||
        msg.includes('decommissioned') ||
        msg.includes('no longer supported') ||
        msg.includes('overloaded') ||
        msg.includes('unavailable');

      console.warn(`[openrouter] ${model} failed: ${msg.slice(0, 120)}`);

      if (is429) markExhausted('openrouter', model, minuteResetAt());

      lastError = err as Error;
      if (!shouldRotate) throw err;
    }
  }

  throw lastError ?? new Error('All OpenRouter models failed or exhausted');
}
