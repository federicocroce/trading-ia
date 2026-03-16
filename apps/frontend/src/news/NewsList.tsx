import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { trpc } from '@/shared/trpc';

type Sentiment = 'positive' | 'negative' | 'neutral';
type Impact = 'high' | 'medium' | 'low';

const impactVariant: Record<Impact, 'destructive' | 'secondary' | 'outline'> = {
  high: 'destructive',
  medium: 'secondary',
  low: 'outline',
};

const sentimentBorder: Record<Sentiment, string> = {
  positive: 'border-l-4 border-l-green-500',
  negative: 'border-l-4 border-l-red-500',
  neutral: 'border-l-4 border-l-gray-400',
};

const sentimentBadgeVariant: Record<Sentiment, 'default' | 'destructive' | 'secondary'> = {
  positive: 'default',
  negative: 'destructive',
  neutral: 'secondary',
};

const sentimentLabel: Record<Sentiment, string> = {
  positive: 'Positivo',
  negative: 'Negativo',
  neutral: 'Neutral',
};

export function NewsList() {
  const { data: news, isLoading } = trpc.news.getAnalyzed.useQuery(undefined, {
    refetchInterval: 5 * 60 * 1000,
  });
  const analyzeNews = trpc.analysis.news.useMutation();
  const [analysisResults, setAnalysisResults] = useState<Map<string, string>>(new Map());

  if (isLoading) {
    return <div className="p-6 text-muted-foreground">Cargando noticias...</div>;
  }

  const handleAnalyze = async (id: string, title: string) => {
    const result = await analyzeNews.mutateAsync({ title });
    setAnalysisResults((prev) => new Map(prev).set(id, result.analysis));
  };

  const formatTime = (time: string) => {
    const date = new Date(time);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    if (diffHours < 1) return 'Hace minutos';
    if (diffHours < 24) return `Hace ${diffHours}h`;
    if (diffDays === 1) return 'Ayer';
    return `Hace ${diffDays}d`;
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Noticias</h2>
        <span className="text-xs text-muted-foreground">{news?.length ?? 0} noticias</span>
      </div>
      <div className="space-y-3">
        {news?.map((item) => {
          const sentiment = item.sentiment as Sentiment;
          const impact = item.impact as Impact;
          const analysis = 'analysis' in item ? (item as any).analysis : null;

          return (
            <Card key={item.id} size="sm" className={sentimentBorder[sentiment]}>
              <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
                <div className="flex gap-3 flex-1 min-w-0">
                  {item.thumbnailUrl && (
                    <img
                      src={item.thumbnailUrl}
                      alt=""
                      className="w-16 h-16 rounded-md object-cover shrink-0"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <Badge variant={impactVariant[impact]} className="text-[10px]">
                        {impact}
                      </Badge>
                      <Badge variant={sentimentBadgeVariant[sentiment]} className="text-[10px]">
                        {sentimentLabel[sentiment]}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{item.source}</span>
                      <span className="text-xs text-muted-foreground">{formatTime(item.time)}</span>
                    </div>
                    <CardTitle className="text-sm leading-snug">
                      {item.url ? (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:text-primary transition-colors"
                        >
                          {item.title}
                        </a>
                      ) : (
                        item.title
                      )}
                    </CardTitle>
                    {analysis?.summary && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {analysis.summary}
                      </p>
                    )}
                    <div className="flex gap-1.5 mt-2 flex-wrap">
                      {item.relatedTickers.map((t: string) => (
                        <Badge key={t} variant="outline" className="text-[10px] font-mono">
                          {t}
                        </Badge>
                      ))}
                      {item.sectors.map((s: string) => (
                        <Badge key={s} variant="secondary" className="text-[10px]">
                          {s}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => handleAnalyze(item.id, item.title)}
                  disabled={analyzeNews.isPending}
                  className="shrink-0"
                >
                  {analyzeNews.isPending ? 'Analizando...' : 'Analizar IA'}
                </Button>
              </CardHeader>
              {analysisResults.get(item.id) && (
                <CardContent>
                  <Separator className="mb-3" />
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {analysisResults.get(item.id)}
                  </p>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
