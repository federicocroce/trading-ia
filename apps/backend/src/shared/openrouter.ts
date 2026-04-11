import OpenAI from 'openai';

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

// Free models on OpenRouter (verified April 2026)
const OPENROUTER_FREE_MODELS = [
  'nousresearch/hermes-3-llama-3.1-405b:free',    // 405B — mejor para razonamiento
  'nvidia/nemotron-3-super-120b-a12b:free',        // 120B — buen razonamiento
  'meta-llama/llama-3.3-70b-instruct:free',        // 70B — general purpose
  'google/gemma-4-31b-it:free',                     // 31B — rápido
] as const;

export async function askOpenRouter(
  userMessage: string,
  systemPrompt: string,
  maxTokens: number = 4096,
): Promise<string> {
  let lastError: Error | null = null;

  for (const model of OPENROUTER_FREE_MODELS) {
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
      console.warn(`[openrouter] ${model} failed: ${msg.slice(0, 120)}`);
      lastError = err as Error;
    }
  }

  throw lastError ?? new Error('All OpenRouter models failed');
}
