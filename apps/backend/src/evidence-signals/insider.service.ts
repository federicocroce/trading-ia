import type { YahooInsiderTransaction } from '../shared/yahoo.js';
import type { InsiderSignal, InsiderTransaction } from '@trading/shared';

const LOOKBACK_DAYS = 90;
const MIN_PURCHASE_VALUE = 50_000;

const PURCHASE_KEYWORDS = ['purchase', 'acquisition', 'bought', 'buy'];
const SALE_KEYWORDS = ['sale', 'sold', 'sell', 'disposition'];

function isPurchase(text: string): boolean {
  const lower = text.toLowerCase();
  if (SALE_KEYWORDS.some((k) => lower.includes(k))) return false;
  return PURCHASE_KEYWORDS.some((k) => lower.includes(k));
}

function isRelevantRole(relation: string): boolean {
  const lower = relation.toLowerCase();
  return (
    lower.includes('officer') ||
    lower.includes('director') ||
    lower.includes('chief') ||
    lower.includes('president') ||
    lower.includes('chairman') ||
    lower.includes('ceo') ||
    lower.includes('cfo') ||
    lower.includes('coo') ||
    lower.includes('cto')
  );
}

export function computeInsiderSignal(transactions: YahooInsiderTransaction[]): InsiderSignal {
  const noSignal: InsiderSignal = {
    active: false, recentBuys: [], totalValue: 0, numberOfBuyers: 0, mostRecentBuyDate: null, score: 0,
  };

  if (!transactions.length) return noSignal;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - LOOKBACK_DAYS);

  const recentBuys: InsiderTransaction[] = transactions
    .filter((t) => {
      if (!t.startDate) return false;
      const date = new Date(t.startDate);
      if (date < cutoff) return false;
      if (!isPurchase(t.transactionText)) return false;
      if (!isRelevantRole(t.relation)) return false;
      if (!t.value || t.value < MIN_PURCHASE_VALUE) return false;
      return true;
    })
    .map((t) => ({
      filerName: t.filerName,
      relation: t.relation,
      transactionText: t.transactionText,
      date: t.startDate!,
      valueUsd: t.value!,
    }));

  if (!recentBuys.length) return noSignal;

  const totalValue = recentBuys.reduce((sum, b) => sum + b.valueUsd, 0);
  const uniqueBuyers = new Set(recentBuys.map((b) => b.filerName)).size;
  const mostRecentBuyDate = recentBuys.sort((a, b) =>
    new Date(b.date).getTime() - new Date(a.date).getTime()
  )[0].date;

  let score = 0;
  if (totalValue >= 5_000_000) score = 95;
  else if (totalValue >= 1_000_000) score = 85;
  else if (totalValue >= 200_000) score = 70;
  else score = 55;

  if (uniqueBuyers >= 2) score = Math.min(100, score + 10);

  return {
    active: true,
    recentBuys,
    totalValue,
    numberOfBuyers: uniqueBuyers,
    mostRecentBuyDate,
    score,
  };
}
