import { insertSignalTracking } from '../db/repository.js';
import { getMarketRegime } from '../evidence-signals/market-regime.service.js';
import { getCachedScanResult } from '../opportunities/opportunities.service.js';
import { getCachedMarketReport } from './market-report.service.js';

export async function trackPipelineRecommendations(): Promise<void> {
  const report = getCachedMarketReport();
  if (!report?.topRecommendations?.length) return;

  const scanResult = getCachedScanResult();
  const today = new Date().toISOString().split('T')[0];

  let regime = 'neutral';
  try {
    const regimeData = await getMarketRegime();
    regime = regimeData.regime;
  } catch {
    // non-critical
  }

  for (const rec of report.topRecommendations) {
    const opp = scanResult?.opportunities.find((o) => o.symbol === rec.symbol);
    if (!opp) continue; // No opportunity data = skip

    try {
      insertSignalTracking({
        symbol: rec.symbol,
        signalDate: today,
        action: opp.action,
        entryPrice: opp.currentPrice,
        targetPrice: opp.tradeLevels?.takeProfit ?? null,
        stopLoss: opp.tradeLevels?.stopLoss ?? null,
        confidence: opp.confidence,
        opportunityScore: opp.opportunityScore,
        sector: rec.sector ?? null,
        techScore: opp.breakdown?.technical?.score ?? null,
        fundScore: opp.breakdown?.fundamental?.score ?? null,
        sentScore: opp.breakdown?.sentiment?.score ?? null,
        enrichedByLlm: true,
        shortTermScore: opp.horizonScores?.shortTerm ?? null,
        mediumTermScore: opp.horizonScores?.mediumTerm ?? null,
        predictedReturnMid: opp.mediumTerm?.midPercent ?? null,
        marketRegimeAtSignal: regime,
      });
    } catch (err) {
      // Never fail the pipeline because of tracking failure
      console.warn(`[pipeline-tracking] Failed to track ${rec.symbol}:`, (err as Error).message);
    }
  }

  console.log(`[pipeline-tracking] Tracked ${report.topRecommendations.length} recommendations for ${today}`);
}
