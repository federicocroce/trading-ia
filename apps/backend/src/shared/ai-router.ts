/**
 * AI Router — centralizes model selection based on task type.
 *
 * Rules:
 * - Reasoning (sectors, deep analysis, market digest): DeepSeek R1 → Groq → Qwen local
 * - Classification (sentiment, enrichment): Groq → OpenRouter → Qwen local
 * - Narrative (short summaries): Groq → Qwen local
 */

import { askGroq, askGroqLight } from './groq.js';
import { askOpenRouter } from './openrouter.js';
import { askLMStudio } from './lmstudio.js';
import { askGemini, askGeminiFlash, isGeminiAvailable } from './gemini.js';

let _runAiMode: 'cloud' | 'local' = 'cloud';

export function setRunAiMode(mode: 'cloud' | 'local'): void {
  _runAiMode = mode;
}

export type AITask = 'reasoning' | 'classification' | 'narrative';

function extractJSON(text: string): string {
  // Handle DeepSeek R1 thinking blocks
  const thinkEnd = text.lastIndexOf('</think>');
  if (thinkEnd !== -1) {
    text = text.slice(thinkEnd + '</think>'.length).trim();
  }

  // Extract JSON from markdown code fence
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();

  // Try to find JSON object/array
  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}');
  if (jsonStart !== -1 && jsonEnd !== -1) {
    return text.slice(jsonStart, jsonEnd + 1);
  }

  return text;
}

async function tryProvider(
  name: string,
  fn: () => Promise<string>,
  validateJSON: boolean,
): Promise<string | null> {
  try {
    const raw = await fn();
    if (!raw) return null;

    const cleaned = extractJSON(raw);

    if (validateJSON) {
      JSON.parse(cleaned); // validate
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
      // Flash para tareas rapidas (2000 req/day con 4 keys) → preserva Pro quota → Groq light → DeepSeek → Qwen
      return geminiAvailable
        ? [geminiFlash, groqLight, deepseek, qwen]
        : [groqLight, deepseek, qwen];

    case 'narrative':
      // Flash suficiente para texto corto
      return geminiAvailable
        ? [geminiFlash, groqLight, qwen]
        : [groqLight, qwen];
  }
}
