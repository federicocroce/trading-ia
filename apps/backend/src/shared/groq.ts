import Groq from 'groq-sdk';

let client: Groq | null = null;

function getClient(): Groq {
  if (!client) {
    client = new Groq();
  }
  return client;
}

// Models to try in order — each has its own rate limit pool
// Ordered by capability; each model has independent rate limit quota on Groq
const GROQ_MODELS = [
  'llama-3.3-70b-versatile',   // primary — best quality
  'llama-3.1-70b-versatile',   // same capability, separate quota pool
  'mixtral-8x7b-32768',        // MoE, strong reasoning, separate quota
  'gemma2-9b-it',              // fast fallback
  'llama-3.1-8b-instant',      // last resort — lowest quota pressure
] as const;

export type GroqModel = (typeof GROQ_MODELS)[number];

export interface GroqResult {
  content: string;
  model: GroqModel;
}

export async function askGroq(
  userMessage: string,
  systemPrompt: string,
  maxTokens: number = 4096
): Promise<string> {
  const result = await askGroqWithRotation(userMessage, systemPrompt, maxTokens);
  return result.content;
}

// Lighter model pool — for classification/narrative tasks that don't need 70B
const GROQ_LIGHT_MODELS = [
  'gemma2-9b-it',
  'llama-3.1-8b-instant',
  'mixtral-8x7b-32768', // fallback to something more capable if light ones fail
] as const;

export async function askGroqLight(
  userMessage: string,
  systemPrompt: string,
  maxTokens: number = 2048
): Promise<string> {
  let lastError: Error | null = null;

  for (const model of GROQ_LIGHT_MODELS) {
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
      console.warn(`[groq-light] ${model} failed${is429 ? ' (rate limit)' : ''}: ${msg.slice(0, 120)}`);
      lastError = err as Error;
      if (!is429) throw err;
    }
  }

  throw lastError ?? new Error('All Groq light models rate limited');
}

export async function askGroqWithRotation(
  userMessage: string,
  systemPrompt: string,
  maxTokens: number = 4096
): Promise<GroqResult> {
  let lastError: Error | null = null;

  for (const model of GROQ_MODELS) {
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
      console.warn(`[groq] ${model} failed${is429 ? ' (rate limit)' : ''}: ${msg.slice(0, 120)}`);
      lastError = err as Error;
      if (!is429) throw err; // Only rotate on rate limit, throw other errors
    }
  }

  throw lastError ?? new Error('All Groq models rate limited');
}
