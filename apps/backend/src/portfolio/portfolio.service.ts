import type { PortfolioPosition, PortfolioSummary } from '@trading/shared';
import { getAllPrices } from '../prices/prices.service.js';
import { getQuotes } from '../shared/yahoo.js';
import { getPortfolioPositions } from '../db/repository.js';

export async function getPortfolio(): Promise<PortfolioSummary> {
  const dbPositions = getPortfolioPositions();
  // Solo pedir precios de los símbolos que tenemos en portfolio
  const portfolioSymbols = dbPositions.map(p => p.symbol);
  const prices = portfolioSymbols.length > 0
    ? await getQuotes(portfolioSymbols)
    : await getAllPrices();
  const priceMap = new Map(prices.map((p) => [p.symbol, p]));

  let totalValue = 0;
  let totalCost = 0;

  const positions: PortfolioPosition[] = dbPositions.map((pos) => {
    const fetched = priceMap.get(pos.symbol);
    const fetchedPrice = fetched?.current;
    // If price API fails, use avgCost as fallback (shows 0% P&L) instead of $0 which collapses portfolio
    const currentPrice = (fetchedPrice !== undefined && fetchedPrice > 0) ? fetchedPrice : pos.avgCost;
    const hasPriceData = fetchedPrice !== undefined && fetchedPrice > 0;
    const changePercent = hasPriceData ? (fetched?.changePercent ?? 0) : 0;
    const value = pos.quantity * currentPrice;
    const cost = pos.quantity * pos.avgCost;
    const pnl = hasPriceData ? value - cost : 0;
    const pnlPercent = hasPriceData && cost > 0 ? (pnl / cost) * 100 : 0;

    if (!hasPriceData) {
      console.warn(`[Portfolio] No price for ${pos.symbol}, using avgCost as fallback`);
    }

    totalValue += value;
    totalCost += cost;

    return {
      symbol: pos.symbol,
      quantity: pos.quantity,
      avgCost: pos.avgCost,
      currentPrice,
      changePercent,
      value,
      pnl,
      pnlPercent,
    };
  });

  const totalPnl = totalValue - totalCost;
  const totalPnlPercent = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;

  return {
    totalValue,
    totalCost,
    totalPnl,
    totalPnlPercent,
    positions,
  };
}
