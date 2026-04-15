import Groq from 'groq-sdk';
import { isExhausted, markExhausted, minuteResetAt } from './quota-tracker.js';

let client: Groq | null = null;

function getClient(): Groq {
  if (!client) {
    client = new Groq();
  }
  return client;
}

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
    if (isExhausted('groq', model)) continue;

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

      if (is429) markExhausted('groq', model, minuteResetAt());

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
    if (isExhausted('groq', model)) continue;

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

      if (is429) markExhausted('groq', model, minuteResetAt());

      lastError = err as Error;
      if (!shouldRotate) throw err;
    }
  }

  throw lastError ?? new Error('All Groq models rate limited or exhausted');
}
