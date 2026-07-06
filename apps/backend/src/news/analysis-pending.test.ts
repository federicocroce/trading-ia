import { describe, it, expect } from 'vitest';
import { needsLlmAnalysis } from './analysis-pending.js';
import type { NewsItem } from '@trading/shared';

function makeItem(overrides: Partial<NewsItem> = {}): NewsItem {
  return {
    id: 'n1',
    time: '2026-07-06T12:00:00Z',
    title: 'Noticia de prueba',
    source: 'Test',
    impact: 'low',
    sectors: [],
    sentiment: 'neutral',
    relatedTickers: [],
    ...overrides,
  };
}

describe('needsLlmAnalysis', () => {
  it('noticia ya analizada con resultado neutral/low NO se re-analiza (flag analyzedAt)', () => {
    // Este era el bug: neutral/low era indistinguible de "sin analizar" y se re-trabajaba en cada run
    const item = makeItem({ analyzedAt: '2026-07-06T10:00:00Z', sentiment: 'neutral', impact: 'low' });
    expect(needsLlmAnalysis(item)).toBe(false);
  });

  it('noticia sin flag y con valores default neutral/low SÍ necesita análisis', () => {
    const item = makeItem();
    expect(needsLlmAnalysis(item)).toBe(true);
  });

  it('noticia legacy sin flag pero con sentiment no-neutral se considera analizada', () => {
    const item = makeItem({ sentiment: 'positive' });
    expect(needsLlmAnalysis(item)).toBe(false);
  });

  it('noticia legacy sin flag pero con impact no-low se considera analizada', () => {
    const item = makeItem({ impact: 'high' });
    expect(needsLlmAnalysis(item)).toBe(false);
  });
});
