export interface WebSearchResult {
  title: string;
  url: string;
  content: string;
  publishedAt: string | null;
}

interface TavilyResponse {
  results: Array<{
    title: string;
    url: string;
    content: string;
    published_date?: string;
  }>;
}

export async function searchTavily(query: string, maxResults = 5): Promise<WebSearchResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error('TAVILY_API_KEY not set');

  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: 'advanced',
      max_results: maxResults,
      include_raw_content: false,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Tavily ${res.status}: ${text.slice(0, 100)}`);
  }

  const data = (await res.json()) as TavilyResponse;
  return data.results.map((r) => ({
    title: r.title,
    url: r.url,
    content: r.content,
    publishedAt: r.published_date ?? null,
  }));
}
