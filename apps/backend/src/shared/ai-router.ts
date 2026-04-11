/**
 * AI Router — centralizes model selection based on task type.
 *
 * Rules:
 * - Reasoning (sectors, deep analysis, market digest): DeepSeek R1 → Groq → Qwen local
 * - Classification (sentiment, enrichment): Groq → OpenRouter → Qwen local
 * - Narrative (short summaries): Groq → Qwen local
 */

import { askGroq } from './groq.js';
import { askOpenRouter } from './openrouter.js';
import { askLMStudio } from './lmstudio.js';

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
  const deepseek = {
    name: 'DeepSeek R1 (OpenRouter)',
    fn: () => askOpenRouter(userMessage, systemPrompt, maxTokens),
  };

  const groq = {
    name: 'Groq (Llama 70B)',
    fn: () => askGroq(userMessage, systemPrompt, maxTokens),
  };

  const qwen = {
    name: 'Qwen 3.5 9B (local)',
    fn: () => askLMStudio(userMessage, systemPrompt, Math.min(maxTokens, 4096)),
  };

  switch (task) {
    case 'reasoning':
      // Deep thinking: DeepSeek R1 → Groq → Qwen
      return [deepseek, groq, qwen];

    case 'classification':
      // Fast classification: Groq → DeepSeek → Qwen
      return [groq, deepseek, qwen];

    case 'narrative':
      // Short text generation: Groq → Qwen
      return [groq, qwen];
  }
}
