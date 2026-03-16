import Groq from 'groq-sdk';

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
  maxTokens: number = 4096
): Promise<string> {
  const result = await askGroqWithRotation(userMessage, systemPrompt, maxTokens);
  return result.content;
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
