/**
 * Optional headless-browser body fetcher for sites that block plain HTTP scrapers
 * (CNBC, Yahoo, MarketWatch, etc. — JS-heavy SPAs).
 *
 * STATUS: SCAFFOLD — disabled by default. To enable:
 *   1. npm install --workspace apps/backend playwright
 *   2. npx playwright install chromium
 *   3. Set ENABLE_BROWSER_FETCHER=true in env
 *   4. Restart backend
 *
 * Trade-offs:
 *   + Recovers ~30 articles per run from JS-heavy sites
 *   - Adds ~300MB chromium binary install
 *   - 5-10x slower per fetch (browser startup + render)
 *   - Some sites detect headless and block anyway
 *
 * This file is type-safe but doesn't import playwright at the top level —
 * the import is dynamic inside the function so the dep is optional.
 */

const ENABLED = process.env.ENABLE_BROWSER_FETCHER === 'true';
const BROWSER_TIMEOUT_MS = 15000;

let browserPromise: Promise<unknown> | null = null;

async function getBrowser(): Promise<unknown> {
  if (browserPromise) return browserPromise;
  browserPromise = (async () => {
    try {
      // Optional dep — only present when user installs playwright
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const playwright = await import('playwright' as any);
      return await playwright.chromium.launch({ headless: true });
    } catch (err) {
      console.warn('[body-fetcher-browser] Playwright not installed — disable ENABLE_BROWSER_FETCHER or install playwright');
      throw err;
    }
  })();
  return browserPromise;
}

/**
 * Fetch full HTML using a headless browser. Returns null on failure.
 * No-op (returns null) if ENABLE_BROWSER_FETCHER env var is not set.
 */
export async function fetchHtmlWithBrowser(url: string): Promise<string | null> {
  if (!ENABLED) return null;
  let context: unknown = null;
  let page: unknown = null;
  try {
    const browser = await getBrowser() as { newContext: (opts: unknown) => Promise<unknown> };
    context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
    });
    page = await (context as { newPage: () => Promise<unknown> }).newPage();
    await (page as { goto: (url: string, opts: unknown) => Promise<unknown> }).goto(url, {
      timeout: BROWSER_TIMEOUT_MS,
      waitUntil: 'domcontentloaded',
    });
    const html = await (page as { content: () => Promise<string> }).content();
    return html;
  } catch (err) {
    console.warn(`[body-fetcher-browser] Failed for ${url}:`, (err as Error).message?.slice(0, 80));
    return null;
  } finally {
    try { if (page) await (page as { close: () => Promise<void> }).close(); } catch { /* ignore */ }
    try { if (context) await (context as { close: () => Promise<void> }).close(); } catch { /* ignore */ }
  }
}

export function isBrowserFetcherEnabled(): boolean {
  return ENABLED;
}
