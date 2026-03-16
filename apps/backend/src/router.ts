import { router } from './trpc.js';
import { pricesRouter } from './prices/prices.router.js';
import { portfolioRouter } from './portfolio/portfolio.router.js';
import { analysisRouter } from './analysis/analysis.router.js';
import { chatRouter } from './chat/chat.router.js';
import { newsRouter } from './news/news.router.js';
import { opportunitiesRouter } from './opportunities/opportunities.router.js';
import { signalsRouter } from './signals/signals.router.js';

export const appRouter = router({
  prices: pricesRouter,
  portfolio: portfolioRouter,
  analysis: analysisRouter,
  chat: chatRouter,
  news: newsRouter,
  opportunities: opportunitiesRouter,
  signals: signalsRouter,
});

export type AppRouter = typeof appRouter;
