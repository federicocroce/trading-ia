import { useMemo } from 'react';
import { trpc } from '@/shared/trpc';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ExternalLink } from 'lucide-react';
import { SymbolLink } from '@/shared/SymbolLink';

const MAX_NEWS = 6;

const confidenceStyle = {
  high: 'bg-green-500/20 text-green-400',
  medium: 'bg-yellow-500/20 text-yellow-400',
  low: 'bg-muted text-muted-foreground',
} as const;

const sentimentStyle = {
  positive: 'bg-green-500/10 text-green-300',
  negative: 'bg-red-500/10 text-red-300',
  neutral: 'bg-muted text-muted-foreground',
} as const;

export function TopNewsWidget() {
  const { data: articles } = trpc.news.getAll.useQuery(undefined, {
    refetchInterval: 5 * 60_000,
  });

  const topNews = useMemo(() => {
    if (!articles) return [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTs = today.getTime();
    return [...articles]
      .filter(a => {
        const pub = new Date(a.time).getTime();
        return pub >= todayTs - 24 * 60 * 60 * 1000;
      })
      .sort((a, b) => {
        const order = { high: 0, medium: 1, low: 2 } as const;
        const aConf = a.triangulation?.confidence ?? 'low';
        const bConf = b.triangulation?.confidence ?? 'low';
        const aOrder = order[aConf] ?? 3;
        const bOrder = order[bConf] ?? 3;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return new Date(b.time).getTime() - new Date(a.time).getTime();
      })
      .slice(0, MAX_NEWS);
  }, [articles]);

  if (topNews.length === 0) return null;

  return (
    <Card size="sm">
      <CardHeader>
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Top noticias del día
        </span>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {topNews.map((a) => {
          const confidence = a.triangulation?.confidence ?? 'low';
          const symbols = a.relatedTickers.slice(0, 3);
          return (
            <div
              key={a.id}
              onClick={() => {
                if (a.url) window.open(a.url, '_blank', 'noopener,noreferrer');
              }}
              className="block cursor-pointer hover:bg-muted/30 rounded px-2 py-1.5 border border-transparent hover:border-border/50"
            >
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0 space-y-0.5">
                  <p className="text-[11px] font-medium leading-snug line-clamp-2">{a.title}</p>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Badge className={`text-[8px] h-3.5 px-1 ${confidenceStyle[confidence]}`}>
                      {confidence}
                    </Badge>
                    <Badge className={`text-[8px] h-3.5 px-1 ${sentimentStyle[a.sentiment]}`}>
                      {a.sentiment}
                    </Badge>
                    <span className="text-[9px] text-muted-foreground">{a.source}</span>
                    {symbols.length > 0 && (
                      <span className="text-[9px] text-muted-foreground font-mono">
                        {symbols.map((s, i) => (
                          <span key={s}>
                            {i > 0 && <span> · </span>}
                            <SymbolLink symbol={s} stopPropagation />
                          </span>
                        ))}
                      </span>
                    )}
                  </div>
                </div>
                {a.url && <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
