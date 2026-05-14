/**
 * Test script: validates filter + body fetcher pipeline in isolation.
 *
 * Run: npx tsx apps/backend/src/scripts/test-deep-analysis-prep.ts
 *
 * What it does:
 *   1. Calls prepareDeepAnalysisNews()
 *   2. Logs each step's funnel
 *   3. Prints sample of final results with body preview
 */

import 'dotenv/config';
import { prepareDeepAnalysisNews } from '../news/news-intelligence.service.js';
import { generateNewsRadar } from '../news/news-radar.service.js';

const SAMPLE_PREVIEW_CHARS = 400;

async function main() {
  console.log('='.repeat(70));
  console.log('DEEP ANALYSIS PREP — TEST RUN');
  console.log('='.repeat(70));
  console.log();

  const t0 = Date.now();
  const result = await prepareDeepAnalysisNews();
  const elapsedMs = Date.now() - t0;

  console.log();
  console.log('='.repeat(70));
  console.log(`RESULT: ${result.length} articles ready for deep LLM analysis`);
  console.log(`Elapsed: ${(elapsedMs / 1000).toFixed(1)}s`);
  console.log('='.repeat(70));
  console.log();

  // Distribution by confidence
  const byConf = { high: 0, medium: 0, low: 0, unknown: 0 };
  for (const n of result) {
    const c = n.triangulation?.confidence ?? 'unknown';
    byConf[c as keyof typeof byConf] = (byConf[c as keyof typeof byConf] ?? 0) + 1;
  }
  console.log('By triangulation confidence:');
  console.log(`  high:    ${byConf.high}`);
  console.log(`  medium:  ${byConf.medium}`);
  console.log(`  low:     ${byConf.low}`);
  console.log(`  unknown: ${byConf.unknown}`);
  console.log();

  // Distribution by source
  const bySource = new Map<string, number>();
  for (const n of result) {
    bySource.set(n.source, (bySource.get(n.source) ?? 0) + 1);
  }
  console.log('By source:');
  for (const [src, count] of [...bySource.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${src.padEnd(30)} ${count}`);
  }
  console.log();

  // Body length distribution
  const bodyLengths = result.map(n => n.body?.length ?? 0).sort((a, b) => a - b);
  if (bodyLengths.length > 0) {
    const min = bodyLengths[0];
    const max = bodyLengths[bodyLengths.length - 1];
    const median = bodyLengths[Math.floor(bodyLengths.length / 2)];
    const avg = Math.round(bodyLengths.reduce((s, n) => s + n, 0) / bodyLengths.length);
    console.log('Body length stats (chars):');
    console.log(`  min:    ${min}`);
    console.log(`  median: ${median}`);
    console.log(`  avg:    ${avg}`);
    console.log(`  max:    ${max}`);
    console.log();
  }

  // Top 5 by confidence + recency
  console.log('='.repeat(70));
  console.log('SAMPLE: first 5 articles ready for LLM');
  console.log('='.repeat(70));
  console.log();

  for (const [i, n] of result.slice(0, 5).entries()) {
    console.log(`--- [${i + 1}] ${n.source} | ${n.triangulation?.confidence ?? '?'} confidence ---`);
    console.log(`Title: ${n.title}`);
    console.log(`Time:  ${n.time}`);
    console.log(`URL:   ${n.url ?? '(none)'}`);
    console.log(`Body:  ${(n.body ?? '').slice(0, SAMPLE_PREVIEW_CHARS)}${(n.body?.length ?? 0) > SAMPLE_PREVIEW_CHARS ? '...' : ''}`);
    console.log(`Body length: ${n.body?.length ?? 0} chars`);
    console.log(`Related tickers: ${n.relatedTickers.join(', ') || '(none)'}`);
    console.log();
  }

  // ============================================================
  // V2 LLM stage — generate news radar
  // ============================================================
  if (result.length === 0) {
    console.log('No articles to analyze — skipping LLM v2 stage');
    process.exit(0);
  }

  console.log('='.repeat(70));
  console.log('LLM v2 STAGE — generating news radar (cause + impacts)');
  console.log('='.repeat(70));
  console.log();

  const radar = await generateNewsRadar(result, { persist: true });

  console.log();
  console.log('='.repeat(70));
  console.log(`RADAR GENERATED in ${(radar.durationMs ?? 0) / 1000}s — model: ${radar.llmModel ?? '?'}`);
  console.log(`  perArticle: ${radar.perArticle.length}`);
  console.log(`  aggregatedSignals: ${radar.aggregatedSignals.length}`);
  console.log('='.repeat(70));
  console.log();

  // Per-article output
  console.log('PER-ARTICLE OUTPUT:');
  for (const a of radar.perArticle) {
    console.log(`\n  📰 ${a.newsId}`);
    console.log(`     Cause:    ${a.cause}`);
    console.log(`     Positive: ${a.positive.map(p => `${p.target}(${p.type})`).join(', ') || '(none)'}`);
    console.log(`     Negative: ${a.negative.map(p => `${p.target}(${p.type})`).join(', ') || '(none)'}`);
  }
  console.log();

  // Aggregated radar
  console.log('='.repeat(70));
  console.log('AGGREGATED RADAR (sorted by total impact volume):');
  console.log('='.repeat(70));
  console.log();

  const positiveSignals = radar.aggregatedSignals.filter(s => s.netScore > 0);
  const negativeSignals = radar.aggregatedSignals.filter(s => s.netScore < 0);

  console.log(`✅ POSITIVE (${positiveSignals.length}):`);
  for (const s of positiveSignals.slice(0, 15)) {
    const tag = s.type === 'sector' ? '🏷️ ' : '   ';
    console.log(`  ${tag}${s.target.padEnd(20)} pos=${s.positiveScore.toFixed(1)} neg=${s.negativeScore.toFixed(1)} net=+${s.netScore.toFixed(1)} (${s.positiveArticles.length} articles)`);
  }
  console.log();

  console.log(`❌ NEGATIVE (${negativeSignals.length}):`);
  for (const s of negativeSignals.slice(0, 15)) {
    const tag = s.type === 'sector' ? '🏷️ ' : '   ';
    console.log(`  ${tag}${s.target.padEnd(20)} pos=${s.positiveScore.toFixed(1)} neg=${s.negativeScore.toFixed(1)} net=${s.netScore.toFixed(1)} (${s.negativeArticles.length} articles)`);
  }
  console.log();

  if (radar.emergingNarratives && radar.emergingNarratives.length > 0) {
    console.log('📖 EMERGING NARRATIVES:');
    for (const n of radar.emergingNarratives) {
      console.log(`  • ${n}`);
    }
    console.log();
  }

  console.log('='.repeat(70));
  console.log('DONE');
  console.log('='.repeat(70));
  process.exit(0);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
