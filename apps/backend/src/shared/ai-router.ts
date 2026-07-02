/**
 * AI Router — centralizes model selection based on task type.
 *
 * Rules:
 * - Reasoning (sectors, deep analysis, market digest): DeepSeek R1 → Groq → Qwen local
 * - Classification (sentiment, enrichment): Groq → OpenRouter → Qwen local
 * - Narrative (short summaries): Groq → Qwen local
 */

import { jsonrepair } from 'jsonrepair';
import { askGroq, askGroqLight } from './groq.js';
import { askOpenRouter } from './openrouter.js';
import { askLMStudio } from './lmstudio.js';
import { askGemini, askGeminiFlash, isGeminiAvailable } from './gemini.js';
import { withTimeout } from './with-timeout.js';

let _runAiMode: 'cloud' | 'local' = 'cloud';

/**
 * Lee un env var numérico en el momento de uso, no al cargar el módulo: con ESM los imports
 * se hoistean antes que el `dotenv.config()` de index.ts corra, así que un `const X = Number(...)`
 * a nivel de módulo captura el valor ANTES de que la env var exista y queda inerte para siempre.
 * También filtra `Number('')` (que da 0, no NaN) y otros valores no positivos.
 */
function envNumber(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function setRunAiMode(mode: 'cloud' | 'local'): void {
  _runAiMode = mode;
}

export type AITask = 'reasoning' | 'classification' | 'narrative' | 'extraction';

function extractJSON(text: string): string {
  // Handle DeepSeek R1 thinking blocks
  const thinkEnd = text.lastIndexOf('</think>');
  if (thinkEnd !== -1) {
    text = text.slice(thinkEnd + '</think>'.length).trim();
  }

  // Extract JSON from markdown code fence
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();

  // Try to find JSON object or array (whichever comes first)
  const objStart = text.indexOf('{');
  const arrStart = text.indexOf('[');
  const useArray = arrStart !== -1 && (objStart === -1 || arrStart < objStart);

  if (useArray) {
    const arrEnd = text.lastIndexOf(']');
    if (arrEnd !== -1) return text.slice(arrStart, arrEnd + 1);
  } else if (objStart !== -1) {
    const objEnd = text.lastIndexOf('}');
    if (objEnd !== -1) return text.slice(objStart, objEnd + 1);
  }

  return text;
}

async function tryProvider(
  name: string,
  fn: () => Promise<string>,
  validateJSON: boolean,
): Promise<string | null> {
  try {
    const timeoutMs = envNumber('LLM_TIMEOUT_MS', 90_000);
    const raw = await withTimeout(fn(), timeoutMs, name);
    if (!raw) return null;

    const cleaned = extractJSON(raw);

    if (validateJSON) {
      try {
        JSON.parse(cleaned);
      } catch {
        const repaired = jsonrepair(cleaned);
        JSON.parse(repaired); // throws if still invalid
        return repaired;
      }
    }

    console.log(`[ai-router] ${name} OK`);
    return cleaned;
  } catch (err) {
    console.warn(`[ai-router] ${name} failed: ${(err as Error).message?.slice(0, 100)}`);
    return null;
  }
}

/**
 * Call AI with the appropriate model chain based on task type.
 * Always validates JSON output.
 */
export async function callAI(
  task: AITask,
  userMessage: string,
  systemPrompt: string,
  maxTokens: number = 4096,
): Promise<string> {
  const providers = getProviderChain(task, userMessage, systemPrompt, maxTokens);

  for (const { name, fn } of providers) {
    const result = await tryProvider(name, fn, true);
    if (result) return result;
  }

  throw new Error(`[ai-router] All providers failed for task: ${task}`);
}

/**
 * Call AI returning both the JSON content and the name of the model that succeeded.
 * Use this where tracking which model ran matters (generatedBy, engine fields).
 */
export async function callAIWithModel(
  task: AITask,
  userMessage: string,
  systemPrompt: string,
  maxTokens: number = 4096,
): Promise<{ content: string; model: string }> {
  const providers = getProviderChain(task, userMessage, systemPrompt, maxTokens);

  for (const { name, fn } of providers) {
    const result = await tryProvider(name, fn, true);
    if (result) return { content: result, model: name };
  }

  throw new Error(`[ai-router] All providers failed for task: ${task}`);
}

/**
 * Call AI without JSON validation (for free-text responses).
 */
export async function callAIText(
  task: AITask,
  userMessage: string,
  systemPrompt: string,
  maxTokens: number = 4096,
): Promise<string> {
  const providers = getProviderChain(task, userMessage, systemPrompt, maxTokens);

  for (const { name, fn } of providers) {
    const result = await tryProvider(name, fn, false);
    if (result) return result;
  }

  throw new Error(`[ai-router] All providers failed for task: ${task}`);
}

function getProviderChain(
  task: AITask,
  userMessage: string,
  systemPrompt: string,
  maxTokens: number,
): Array<{ name: string; fn: () => Promise<string> }> {
  const geminiPro = {
    name: 'Gemini 2.5 Pro',
    fn: () => askGemini(userMessage, systemPrompt, maxTokens),
  };

  const geminiFlash = {
    name: 'Gemini 2.5 Flash',
    fn: () => askGeminiFlash(userMessage, systemPrompt, maxTokens),
  };

  const deepseek = {
    name: 'DeepSeek R1 (OpenRouter)',
    fn: () => askOpenRouter(userMessage, systemPrompt, maxTokens),
  };

  const groq = {
    name: 'Groq (Llama 70B)',
    fn: () => askGroq(userMessage, systemPrompt, maxTokens),
  };

  const groqLight = {
    name: 'Groq Light (gemma2/8b)',
    fn: () => askGroqLight(userMessage, systemPrompt, Math.min(maxTokens, 2048)),
  };

  const qwen = {
    name: 'Qwen 3.5 9B (local)',
    fn: () => askLMStudio(userMessage, systemPrompt, Math.min(maxTokens, 4096)),
  };

  if (_runAiMode === 'local') {
    return [qwen];
  }

  const geminiAvailable = isGeminiAvailable();

  switch (task) {
    case 'reasoning':
      // Gemini Pro primero (mejor modelo, 100 req/day con 4 keys) → DeepSeek R1 → Groq 70B → Qwen
      return geminiAvailable
        ? [geminiPro, deepseek, groq, qwen]
        : [deepseek, groq, qwen];

    case 'classification':
      // Groq Light primero (confiable, rápido, multi-key) → Gemini Flash como backup → DeepSeek → Qwen
      return geminiAvailable
        ? [groqLight, geminiFlash, deepseek, qwen]
        : [groqLight, deepseek, qwen];

    case 'narrative':
      // Groq Light primero → Gemini Flash como backup → Qwen
      return geminiAvailable
        ? [groqLight, geminiFlash, qwen]
        : [groqLight, qwen];

    case 'extraction':
      // Structured extraction (news radar, etc.) — needs accuracy on tickers/sectors.
      // Groq 70B (Llama 70B) primary with key rotation → Groq Light → Gemini Flash → Qwen.
      return geminiAvailable
        ? [groq, groqLight, geminiFlash, qwen]
        : [groq, groqLight, qwen];
  }
}
