import OpenAI from 'openai';

let client: OpenAI | null = null;

const DEFAULT_BASE_URL = 'http://127.0.0.1:1234/v1';
const DEFAULT_TIMEOUT = 120_000; // 2 min — Qwen 3.5 9B debería responder en <60s

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      baseURL: process.env.LMSTUDIO_BASE_URL || DEFAULT_BASE_URL,
      apiKey: 'lm-studio',
      timeout: DEFAULT_TIMEOUT,
    });
  }
  return client;
}

/**
 * Extrae JSON limpio de una respuesta que puede incluir thinking blocks.
 */
function extractJSONFromThinking(text: string): string {
  // 1. Si tiene </think>, tomar solo lo que viene después
  const thinkEnd = text.lastIndexOf('</think>');
  if (thinkEnd !== -1) {
    text = text.slice(thinkEnd + '</think>'.length).trim();
  }

  // 2. Si tiene fence de markdown, extraer contenido
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  // 3. Buscar el JSON (objeto o array)
  const firstBrace = text.indexOf('{');
  const firstBracket = text.indexOf('[');
  const start = firstBrace === -1 ? firstBracket
    : firstBracket === -1 ? firstBrace
    : Math.min(firstBrace, firstBracket);

  if (start === -1) return text;

  // Buscar el cierre correcto contando niveles
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{' || ch === '[') depth++;
    if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  const lastClose = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  if (lastClose > start) return text.slice(start, lastClose + 1);

  return text;
}

/**
 * Verifica si LM Studio está disponible.
 */
export async function isLMStudioAvailable(): Promise<boolean> {
  try {
    const res = await fetch(
      `${process.env.LMSTUDIO_BASE_URL || DEFAULT_BASE_URL}/models`,
      { signal: AbortSignal.timeout(3000) },
    );
    return res.ok;
  } catch {
    return false;
  }
}

export async function askLMStudio(
  userMessage: string,
  systemPrompt: string,
  maxTokens: number = 4096,
): Promise<string> {
  const model = process.env.LMSTUDIO_MODEL || 'local-model';
  const baseUrl = process.env.LMSTUDIO_BASE_URL || DEFAULT_BASE_URL;

  // Health check
  const available = await isLMStudioAvailable();
  if (!available) {
    throw new Error(`LM Studio no disponible en ${baseUrl} — asegurate de que esté corriendo con el servidor iniciado`);
  }

  console.log(`[lmstudio] Request a ${model} (max_tokens: ${maxTokens}, prompt: ${userMessage.length} chars)...`);
  const startTime = Date.now();

  let response;
  try {
    response = await getClient().chat.completions.create({
      model,
      max_tokens: maxTokens,
      messages: [
        {
          role: 'system',
          content: systemPrompt + '\n\nIMPORTANTE: Responde SOLO con JSON valido, sin explicaciones adicionales.',
        },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.1,
      response_format: { type: 'json_schema', json_schema: { name: 'response', strict: false, schema: { type: 'object' } } } as never,
    });
  } catch (err) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const msg = (err as Error).message || 'Unknown error';
    console.error(`[lmstudio] FAILED (${elapsed}s): ${msg.slice(0, 200)}`);
    throw new Error(`LM Studio error (${elapsed}s): ${msg.slice(0, 200)}`);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const content = response.choices[0]?.message?.content ?? '';
  const finishReason = response.choices[0]?.finish_reason ?? 'unknown';

  console.log(`[lmstudio] Respuesta en ${elapsed}s (${content.length} chars, finish: ${finishReason})`);

  if (!content) {
    throw new Error(`LM Studio respuesta vacía (finish: ${finishReason})`);
  }

  if (finishReason === 'length') {
    console.warn(`[lmstudio] WARN: cortado por max_tokens (${maxTokens})`);
  }

  // Extraer JSON limpio (maneja thinking mode de Qwen3.5)
  const jsonStr = extractJSONFromThinking(content);

  // Validar JSON
  try {
    JSON.parse(jsonStr);
  } catch {
    console.error(`[lmstudio] JSON inválido. Últimos 300 chars: ...${content.slice(-300)}`);
    throw new Error(`LM Studio JSON inválido (${content.length} chars, finish: ${finishReason})`);
  }

  console.log(`[lmstudio] OK en ${elapsed}s (${jsonStr.length} chars JSON)`);
  return jsonStr;
}
