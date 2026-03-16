import type { RawNewsArticle, NewsSourceType } from '@trading/shared';

export interface NewsSourceAdapter {
  name: string;
  type: NewsSourceType;
  isAvailable(): Promise<boolean>;
  fetchNews(symbols: string[]): Promise<RawNewsArticle[]>;
}
