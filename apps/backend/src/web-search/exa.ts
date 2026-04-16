import type { WebSearchResult } from './tavily.js';

interface ExaResponse {
  results: Array<{
    title: string;
    url: string;
    publishedDate?: string;
    highlights?: string[];
  }>;
}

export async function searchExa(query: string, maxResults = 5): Promise<WebSearchResult[]> {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) throw new Error('EXA_API_KEY not set');

  const res = await fetch('https://api.exa.ai/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({
      query,
      numResults: maxResults,
      type: 'auto',
      category: 'news',
      contents: { highlights: { maxCharacters: 2000 } },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Exa ${res.status}: ${text.slice(0, 100)}`);
  }

  const data = (await res.json()) as ExaResponse;
  return data.results.map((r) => ({
    title: r.title,
    url: r.url,
    content: r.highlights?.join(' ') ?? '',
    publishedAt: r.publishedDate ?? null,
  }));
}
