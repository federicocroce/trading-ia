import Groq from 'groq-sdk';
import { isExhausted, markExhausted, minuteResetAt } from './quota-tracker.js';

// Keys read lazily so dotenv has time to load. Supports GROQ_API_KEY_1..4 with
// fallback to legacy GROQ_API_KEY for backward compat.
function getApiKeys(): string[] {
  const numbered = [
    process.env.GROQ_API_KEY_1,
    process.env.GROQ_API_KEY_2,
    process.env.GROQ_API_KEY_3,
    process.env.GROQ_API_KEY_4,
  ].filter((k): k is string => !!k);

  if (numbered.length > 0) return numbered;

  const legacy = process.env.GROQ_API_KEY;
  return legacy ? [legacy] : [];
}

function makeClient(key: string): Groq {
  return new Groq({ apiKey: key });
}

const GROQ_MODELS = [
  'llama-3.3-70b-versatile',        // best general
  'deepseek-r1-distill-llama-70b',  // reasoning
  'qwen-qwq-32b',                   // reasoning
  'llama-3.1-8b-instant',           // fast fallback
] as const;

export type GroqModel = (typeof GROQ_MODELS)[number];

export interface GroqResult {
  content: string;
  model: GroqModel;
  tokensInput?: number;
  tokensOutput?: number;
}

const GROQ_LIGHT_MODELS = [
  'llama-3.1-8b-instant',
  'gemma2-9b-it',
] as const;

export interface GroqLightResult {
  content: string;
  tokensInput?: number;
  tokensOutput?: number;
}

export function isGroqAvailable(): boolean {
  return getApiKeys().length > 0;
}

export async function askGroq(
  userMessage: string,
  systemPrompt: string,
  maxTokens: number = 4096,
): Promise<string> {
  const result = await askGroqWithRotation(userMessage, systemPrompt, maxTokens);
  return result.content;
}

export async function askGroqLight(
  userMessage: string,
  systemPrompt: string,
  maxTokens: number = 2048,
): Promise<string> {
  const result = await askGroqLightWithUsage(userMessage, systemPrompt, maxTokens);
  return result.content;
}

export async function askGroqLightWithUsage(
  userMessage: string,
  systemPrompt: string,
  maxTokens: number = 2048,
): Promise<GroqLightResult> {
  const keys = getApiKeys();
  if (keys.length === 0) throw new Error('No Groq API keys configured');

  let lastError: Error | null = null;

  for (const model of GROQ_LIGHT_MODELS) {
    for (let keyIndex = 0; keyIndex < keys.length; keyIndex++) {
      if (isExhausted('groq', model, keyIndex)) continue;

      try {
        const response = await makeClient(keys[keyIndex]).chat.completions.create({
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
          console.log(`[groq-light] Success with model: ${model}, key: #${keyIndex + 1}`);
          return {
            content,
            tokensInput: response.usage?.prompt_tokens,
            tokensOutput: response.usage?.completion_tokens,
          };
        }
      } catch (err) {
        const msg = (err as Error).message || '';
        const is429 = msg.includes('429') || msg.includes('rate_limit');
        const is400 = msg.includes('400') || msg.includes('Failed to generate JSON') || msg.includes('bad_request');
        const isDecommissioned = msg.includes('decommissioned') || msg.includes('no longer supported');
        const shouldRotate = is429 || is400 || isDecommissioned;

        console.warn(`[groq-light] ${model} key#${keyIndex + 1} failed${is429 ? ' (rate limit)' : is400 ? ' (json fail)' : isDecommissioned ? ' (decommissioned)' : ''}: ${msg.slice(0, 120)}`);

        if (is429) markExhausted('groq', model, minuteResetAt(), keyIndex);
        if (isDecommissioned) markExhausted('groq', model, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), keyIndex);

        lastError = err as Error;
        if (!shouldRotate) break; // bad model, try next model
      }
    }
  }

  throw lastError ?? new Error('All Groq light models rate limited or exhausted');
}

export async function askGroqWithRotation(
  userMessage: string,
  systemPrompt: string,
  maxTokens: number = 4096,
): Promise<GroqResult> {
  const keys = getApiKeys();
  if (keys.length === 0) throw new Error('No Groq API keys configured');

  let lastError: Error | null = null;

  for (const model of GROQ_MODELS) {
    for (let keyIndex = 0; keyIndex < keys.length; keyIndex++) {
      if (isExhausted('groq', model, keyIndex)) continue;

      try {
        const response = await makeClient(keys[keyIndex]).chat.completions.create({
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
          console.log(`[groq] Success with model: ${model}, key: #${keyIndex + 1}`);
          return {
            content,
            model,
            tokensInput: response.usage?.prompt_tokens,
            tokensOutput: response.usage?.completion_tokens,
          };
        }
      } catch (err) {
        const msg = (err as Error).message || '';
        const is429 = msg.includes('429') || msg.includes('rate_limit');
        const isDecommissioned = msg.includes('decommissioned') || msg.includes('no longer supported');
        const shouldRotate = is429 || isDecommissioned;

        console.warn(`[groq] ${model} key#${keyIndex + 1} failed${is429 ? ' (rate limit)' : isDecommissioned ? ' (decommissioned)' : ''}: ${msg.slice(0, 120)}`);

        if (is429) markExhausted('groq', model, minuteResetAt(), keyIndex);
        if (isDecommissioned) markExhausted('groq', model, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), keyIndex);

        lastError = err as Error;
        if (!shouldRotate) break; // hard error on this model, skip to next
      }
    }
  }

  throw lastError ?? new Error('All Groq models rate limited or exhausted');
}
