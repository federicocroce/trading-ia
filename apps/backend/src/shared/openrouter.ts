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

// Lista verificada contra el catálogo VIVO de OpenRouter (GET /api/v1/models) el 2026-07-02.
// No existe ningún DeepSeek R1 ni r1-distill/qwq gratis hoy — los IDs anteriores
// (deepseek/deepseek-r1:free, qwen/qwen3-235b-a22b:free, qwen/qwen3-30b-a3b:free,
// meta-llama/llama-4-scout:free, google/gemma-4-31b-it:free, microsoft/phi-4-reasoning:free)
// están muertos y 404ean. Orden: mejor generalista grande primero, reasoning como tercero,
// llama-3.3-70b como fallback probado.
const OPENROUTER_FREE_MODELS = [
  'nvidia/nemotron-3-ultra-550b-a55b:free',              // 550B MoE, 1M ctx — mejor generalista free
  'openai/gpt-oss-120b:free',                            // 120B, 131k ctx — fuerte, reasoning-capable
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',  // 30B reasoning, 256k ctx
  'meta-llama/llama-3.3-70b-instruct:free',              // 70B, probado — fallback confiable
] as const;

export interface OpenRouterResult {
  content: string;
  tokensInput?: number;
  tokensOutput?: number;
}

export async function askOpenRouter(
  userMessage: string,
  systemPrompt: string,
  maxTokens: number = 4096,
): Promise<string> {
  const result = await askOpenRouterWithUsage(userMessage, systemPrompt, maxTokens);
  return result.content;
}

export async function askOpenRouterWithUsage(
  userMessage: string,
  systemPrompt: string,
  maxTokens: number = 4096,
): Promise<OpenRouterResult> {
  let lastError: Error | null = null;

  for (const model of OPENROUTER_FREE_MODELS) {
    if (isExhausted('openrouter', model)) continue;

    // Reasoning models use tokens for chain-of-thought before the JSON. Double the limit
    // so the thinking block doesn't crowd out the actual response (capped at 16k).
    const isReasoningModel = /r1|deepseek|reasoning|qwq/i.test(model);
    const effectiveMaxTokens = isReasoningModel ? Math.min(maxTokens * 2, 16_000) : maxTokens;

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
        return {
          content,
          tokensInput: response.usage?.prompt_tokens,
          tokensOutput: response.usage?.completion_tokens,
        };
      }
    } catch (err) {
      const msg = (err as Error).message || '';
      const is429 = msg.includes('429') || msg.includes('rate_limit');
      const is404 = msg.includes('404') || msg.includes('No endpoints found') || msg.includes('not found');
      // 400 por límite de contexto/max_tokens del modelo: probar el siguiente en vez de morir.
      const isContextLimit = /max_tokens|context length/i.test(msg);
      const shouldRotate =
        is429 ||
        is404 ||
        isContextLimit ||
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
