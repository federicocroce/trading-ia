import Anthropic from '@anthropic-ai/sdk';
import { ANALYST_SYSTEM_PROMPT } from '@trading/shared';

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic();
  }
  return client;
}

export async function askClaude(
  userMessage: string,
  systemPrompt: string = ANALYST_SYSTEM_PROMPT,
  maxTokens: number = 1024
): Promise<string> {
  const response = await getClient().messages.create({
    model: 'claude-sonnet-5',
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  const block = response.content[0];
  if (block.type === 'text') {
    return block.text;
  }
  return '';
}

export async function chatWithClaude(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  systemPrompt: string = ANALYST_SYSTEM_PROMPT
): Promise<string> {
  const response = await getClient().messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 1024,
    system: systemPrompt,
    messages,
  });

  const block = response.content[0];
  if (block.type === 'text') {
    return block.text;
  }
  return '';
}
