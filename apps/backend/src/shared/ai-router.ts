/**
 * AI Router — centralizes model selection based on task type.
 *
 * Rules:
 * - Reasoning (sectors, deep analysis, market digest): Gemini Pro → OpenRouter free → Groq → Qwen local
 * - Classification (sentiment, enrichment): Groq → OpenRouter → Qwen local
 * - Narrative (short summaries): Groq → Qwen local
 */

import { jsonrepair } from 'jsonrepair';
import { askGroqWithRotation, askGroqLightWithUsage } from './groq.js';
import { askOpenRouterWithUsage } from './openrouter.js';
import { askLMStudio } from './lmstudio.js';
import { askGeminiWithUsage, askGeminiFlashWithUsage, isGeminiAvailable } from './gemini.js';
import { withTimeout } from './with-timeout.js';
import { envNumber } from './env-number.js';

let _runAiMode: 'cloud' | 'local' = 'cloud';

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

/**
 * Providers that track token usage return this shape instead of a bare string.
 * `tryProvider` accepts either — string-returning providers (e.g. local Qwen)
 * simply produce a result with tokensInput/tokensOutput left undefined.
 */
interface ProviderResult {
  content: string;
  tokensInput?: number;
  tokensOutput?: number;
}

async function tryProvider(
  name: string,
  fn: () => Promise<string | ProviderResult>,
  validateJSON: boolean,
): Promise<ProviderResult | null> {
  try {
    const timeoutMs = envNumber('LLM_TIMEOUT_MS', 90_000);
    const raw = await withTimeout(fn(), timeoutMs, name);
    if (!raw) return null;

    const rawContent = typeof raw === 'string' ? raw : raw.content;
    const tokensInput = typeof raw === 'string' ? undefined : raw.tokensInput;
    const tokensOutput = typeof raw === 'string' ? undefined : raw.tokensOutput;
    if (!rawContent) return null;

    let cleaned = extractJSON(rawContent);

    if (validateJSON) {
      try {
        JSON.parse(cleaned);
      } catch {
        const repaired = jsonrepair(cleaned);
        JSON.parse(repaired); // throws if still invalid
        cleaned = repaired;
      }
    }

    console.log(`[ai-router] ${name} OK`);
    return { content: cleaned, tokensInput, tokensOutput };
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
    if (result) return result.content;
  }

  throw new Error(`[ai-router] All providers failed for task: ${task}`);
}

/**
 * Call AI returning the JSON content, the name of the model that succeeded, and
 * (when the provider reports it) token usage for cost/audit tracking. tokensInput/
 * tokensOutput are additive — omitted for providers that don't surface usage (e.g.
 * local Qwen via LM Studio).
 */
export async function callAIWithModel(
  task: AITask,
  userMessage: string,
  systemPrompt: string,
  maxTokens: number = 4096,
): Promise<{ content: string; model: string; tokensInput?: number; tokensOutput?: number }> {
  const providers = getProviderChain(task, userMessage, systemPrompt, maxTokens);

  for (const { name, fn } of providers) {
    const result = await tryProvider(name, fn, true);
    if (result) {
      return {
        content: result.content,
        model: name,
        tokensInput: result.tokensInput,
        tokensOutput: result.tokensOutput,
      };
    }
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
    if (result) return result.content;
  }

  throw new Error(`[ai-router] All providers failed for task: ${task}`);
}

function getProviderChain(
  task: AITask,
  userMessage: string,
  systemPrompt: string,
  maxTokens: number,
): Array<{ name: string; fn: () => Promise<string | ProviderResult> }> {
  const geminiPro = {
    name: 'Gemini 2.5 Pro',
    fn: () => askGeminiWithUsage(userMessage, systemPrompt, maxTokens),
  };

  const geminiFlash = {
    name: 'Gemini 2.5 Flash',
    fn: () => askGeminiFlashWithUsage(userMessage, systemPrompt, maxTokens),
  };

  // Etiqueta honesta: la cadena free de OpenRouter ya no incluye DeepSeek R1 (no existe
  // ningún R1 :free en el catálogo vivo — verificado 2026-07-02). El nombre se persiste en
  // generatedBy/engine, así que no puede prometer un modelo que no corre.
  const openRouterFree = {
    name: 'OpenRouter (free)',
    fn: () => askOpenRouterWithUsage(userMessage, systemPrompt, maxTokens),
  };

  const groq = {
    name: 'Groq (Llama 70B)',
    fn: () => askGroqWithRotation(userMessage, systemPrompt, maxTokens),
  };

  const groqLight = {
    name: 'Groq Light (gemma2/8b)',
    fn: () => askGroqLightWithUsage(userMessage, systemPrompt, Math.min(maxTokens, 2048)),
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
      // Gemini Pro primero (mejor modelo, 100 req/day con 4 keys) → OpenRouter free → Groq 70B → Qwen
      return geminiAvailable
        ? [geminiPro, openRouterFree, groq, qwen]
        : [openRouterFree, groq, qwen];

    case 'classification':
      // Groq Light primero (confiable, rápido, multi-key) → Gemini Flash como backup → OpenRouter → Qwen
      return geminiAvailable
        ? [groqLight, geminiFlash, openRouterFree, qwen]
        : [groqLight, openRouterFree, qwen];

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
