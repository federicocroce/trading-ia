import type { NewsSourceAdapter } from './adapter.js';
import { yahooAdapter } from './yahoo.adapter.js';
import { finnhubAdapter } from './finnhub.adapter.js';
import { rssAdapter } from './rss.adapter.js';
import { newsapiAdapter } from './newsapi.adapter.js';

export type { NewsSourceAdapter } from './adapter.js';

// All registered adapters in priority order
const ALL_ADAPTERS: NewsSourceAdapter[] = [
  yahooAdapter,
  finnhubAdapter,
  rssAdapter,
  newsapiAdapter,
];

let cachedAvailable: NewsSourceAdapter[] | null = null;

/**
 * Returns all adapters that are currently available (have API keys, dependencies installed, etc).
 * Result is cached after first check.
 */
export async function getAvailableAdapters(): Promise<NewsSourceAdapter[]> {
  if (cachedAvailable) return cachedAvailable;

  const checks = await Promise.allSettled(
    ALL_ADAPTERS.map(async (adapter) => {
      const available = await adapter.isAvailable();
      return { adapter, available };
    }),
  );

  cachedAvailable = [];
  for (const r of checks) {
    if (r.status === 'fulfilled' && r.value.available) {
      cachedAvailable.push(r.value.adapter);
      console.log(`[news-sources] ✓ ${r.value.adapter.name} disponible`);
    } else if (r.status === 'fulfilled') {
      console.log(`[news-sources] ✗ ${r.value.adapter.name} no disponible`);
    }
  }

  console.log(`[news-sources] ${cachedAvailable.length}/${ALL_ADAPTERS.length} fuentes activas`);
  return cachedAvailable;
}

/**
 * Force re-check adapter availability (e.g. after adding an API key)
 */
export function resetAdapterCache(): void {
  cachedAvailable = null;
}
