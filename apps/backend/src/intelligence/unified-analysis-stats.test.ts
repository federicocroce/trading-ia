import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runUnifiedAnalysis, getLastUnifiedAnalysisStats } from './unified-analysis.service.js';
import { callAIWithModel } from '../shared/ai-router.js';
import type { Opportunity } from '@trading/shared';

// Mocks SOLO de la frontera de I/O (LLM, BD, artifacts) para ejercitar la
// lógica real de selección de targets, batching, circuit breaker y stats.
vi.mock('../shared/ai-router.js', () => ({
  callAIWithModel: vi.fn(),
}));
vi.mock('../db/repository.js', () => ({
  getPortfolioPositions: vi.fn(() => []),
  getSymbol: vi.fn(() => undefined),
  getActiveDiscoveredSymbols: vi.fn(() => []),
}));
vi.mock('./pipeline-artifacts.repository.js', () => ({
  saveUnifiedAnalysisBatch: vi.fn(),
  saveUnifiedAnalysisResults: vi.fn(),
}));

const mockedCallAI = vi.mocked(callAIWithModel);

function makeOpp(symbol: string, score: number): Opportunity {
  return {
    symbol,
    currentPrice: 100,
    action: 'BUY',
    opportunityScore: score,
    inPortfolio: false,
    passedAntiHype: true,
  } as unknown as Opportunity;
}

function llmResponseFor(symbols: string[]) {
  return {
    content: JSON.stringify({
      analyses: symbols.map(s => ({ symbol: s, action: 'BUY', thesis: 't', narrative: 'n' })),
    }),
    model: 'DeepSeek R1',
  };
}

describe('getLastUnifiedAnalysisStats', () => {
  beforeEach(() => {
    mockedCallAI.mockReset();
  });

  it('marca abortedByQuota cuando el circuit breaker corta batches restantes', async () => {
    // 5 targets → batches de 4: [S1..S4], [S5]. Batch 1 OK, batch 2 quota-exhausted.
    const opps = ['S1', 'S2', 'S3', 'S4', 'S5'].map((s, i) => makeOpp(s, 90 - i * 10));
    mockedCallAI
      .mockResolvedValueOnce(llmResponseFor(['S1', 'S2', 'S3', 'S4']))
      .mockRejectedValueOnce(new Error('All providers quota-exhausted'));

    const result = await runUnifiedAnalysis(opps, new Map(), new Map(), new Map());

    expect(result.size).toBe(4);
    expect(getLastUnifiedAnalysisStats()).toEqual({ analyzed: 4, targets: 5, abortedByQuota: true });
  });

  it('resetea stats stale cuando un run nuevo sale temprano sin targets', async () => {
    // Primer run deja stats poblados...
    mockedCallAI.mockRejectedValueOnce(new Error('All providers quota-exhausted'));
    await runUnifiedAnalysis([makeOpp('S1', 90)], new Map(), new Map(), new Map());
    expect(getLastUnifiedAnalysisStats()).not.toBeNull();

    // ...el siguiente run sin targets no debe dejar stats del run anterior.
    const result = await runUnifiedAnalysis([], new Map(), new Map(), new Map());
    expect(result.size).toBe(0);
    expect(getLastUnifiedAnalysisStats()).toBeNull();
  });

  it('reporta run completo cuando todos los targets se analizan', async () => {
    const opps = [makeOpp('S1', 90), makeOpp('S2', 80)];
    mockedCallAI.mockResolvedValueOnce(llmResponseFor(['S1', 'S2']));

    const result = await runUnifiedAnalysis(opps, new Map(), new Map(), new Map());

    expect(result.size).toBe(2);
    expect(getLastUnifiedAnalysisStats()).toEqual({ analyzed: 2, targets: 2, abortedByQuota: false });
  });

  it('reporta analyzed < targets cuando el LLM omite símbolos sin abortar', async () => {
    const opps = [makeOpp('S1', 90), makeOpp('S2', 80)];
    mockedCallAI.mockResolvedValueOnce(llmResponseFor(['S1'])); // S2 omitido

    await runUnifiedAnalysis(opps, new Map(), new Map(), new Map());

    expect(getLastUnifiedAnalysisStats()).toEqual({ analyzed: 1, targets: 2, abortedByQuota: false });
  });
});
