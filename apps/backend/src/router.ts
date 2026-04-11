import { router, publicProcedure } from './trpc.js';
import { pricesRouter } from './prices/prices.router.js';
import { portfolioRouter } from './portfolio/portfolio.router.js';
import { analysisRouter } from './analysis/analysis.router.js';
import { chatRouter } from './chat/chat.router.js';
import { newsRouter } from './news/news.router.js';
import { opportunitiesRouter } from './opportunities/opportunities.router.js';
import { signalsRouter } from './signals/signals.router.js';
import { intelligenceRouter } from './intelligence/intelligence.router.js';
import { getHealthReport } from './shared/service-health.js';
export const appRouter = router({
  prices: pricesRouter,
  portfolio: portfolioRouter,
  analysis: analysisRouter,
  chat: chatRouter,
  news: newsRouter,
  opportunities: opportunitiesRouter,
  signals: signalsRouter,
  intelligence: intelligenceRouter,
  health: publicProcedure.query(() => getHealthReport()),
});

export type AppRouter = typeof appRouter;
