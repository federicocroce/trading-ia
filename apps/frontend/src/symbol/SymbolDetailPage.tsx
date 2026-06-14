import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { trpc } from '@/shared/trpc';
import { WatchlistButton } from '@/shared/WatchlistButton';
import { PriceChart, type PeriodChange } from './PriceChart';

interface SymbolDetailPageProps {
  symbol: string;
  onBack: () => void;
}

export function SymbolDetailPage({ symbol, onBack }: SymbolDetailPageProps) {
  const [periodChange, setPeriodChange] = useState<PeriodChange | null>(null);
  const { data: symbols } = trpc.portfolio.symbols.list.useQuery();
  const stock = symbols?.find((s) => s.symbol === symbol);

  const { data: price } = trpc.prices.getBySymbol.useQuery(
    { symbol },
    { refetchInterval: 60_000 },
  );

  const { data: portfolio } = trpc.portfolio.get.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  const { data: fundamentals } = trpc.prices.getFundamentals.useQuery(
    { symbol },
    { staleTime: 60 * 60_000 },
  );

  const { data: oppScan } = trpc.opportunities.scan.useQuery(
    undefined,
    { staleTime: 20 * 60_000, retry: false },
  );
  const signal = oppScan?.opportunities.find((o: any) => o.symbol === symbol) ?? null;

  const { data: transactions } = trpc.portfolio.transactions.list.useQuery(
    { symbol },
  );

  const { data: news } = trpc.news.getBySymbol.useQuery(
    { symbol },
    { staleTime: 5 * 60_000, retry: false },
  );

  const position = portfolio?.positions.find((p) => p.symbol === symbol);
  const portfolioPercent = position && portfolio
    ? ((position.value / portfolio.totalValue) * 100)
    : null;

  return (
    <div className="p-6 space-y-6 w-full">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={onBack} className="text-muted-foreground">
          ← Volver
        </Button>
        <div className="flex items-center gap-2">
          {stock && <span className="text-lg">{stock.flag}</span>}
          <h1 className="text-xl font-bold font-mono">{symbol}</h1>
          {stock && <span className="text-muted-foreground">— {stock.name}</span>}
          <WatchlistButton symbol={symbol} />
        </div>
      </div>

      {/* Price */}
      {price && (
        <div className="space-y-1">
          <div className="flex items-baseline gap-3">
            <span className="text-3xl font-bold font-mono">${price.current.toFixed(2)}</span>
            <span className="text-sm text-muted-foreground">USD</span>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-sm font-medium ${price.change >= 0 ? 'text-trading-green' : 'text-trading-red'}`}>
              $ {price.change >= 0 ? '+' : ''}{price.change.toFixed(2)} ({price.changePercent >= 0 ? '+' : ''}{price.changePercent.toFixed(2)}%)
            </span>
            {periodChange && (
              <span className={`text-sm font-medium ${periodChange.changePercent >= 0 ? 'text-trading-green' : 'text-trading-red'}`}>
                · {periodChange.label}: {periodChange.changePercent >= 0 ? '+' : ''}{periodChange.changePercent.toFixed(2)}%
              </span>
            )}
          </div>
        </div>
      )}

      {/* Chart */}
      <div className="rounded-lg border border-border bg-card p-4">
        <PriceChart symbol={symbol} onPeriodChange={setPeriodChange} currentPrice={price?.current} />
      </div>

      {/* Cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Position card */}
        {position && (
          <div className="rounded-lg border border-border bg-card p-4 space-y-3">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Tu Posicion</h3>
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Tenencia" value={`${position.quantity.toFixed(2)} ${symbol}`} />
              <Stat label="% Cartera" value={portfolioPercent ? `${portfolioPercent.toFixed(1)}%` : '-'} />
              <Stat label="Costo Promedio" value={`$${position.avgCost.toFixed(2)}`} />
              <Stat
                label="Ganancia no realizada"
                value={`${position.pnl >= 0 ? '+' : ''}$${position.pnl.toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
                className={position.pnl >= 0 ? 'text-trading-green' : 'text-trading-red'}
              />
            </div>
          </div>
        )}

        {/* Fundamentals card */}
        {fundamentals && (
          <div className="rounded-lg border border-border bg-card p-4 space-y-3">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Fundamentales</h3>
            <div className="grid grid-cols-2 gap-3">
              <Stat label="P/E Ratio" value={fundamentals.peRatio?.toFixed(1) ?? '-'} />
              <Stat label="Forward P/E" value={fundamentals.forwardPE?.toFixed(1) ?? '-'} />
              <Stat label="EPS" value={fundamentals.eps ? `$${fundamentals.eps.toFixed(2)}` : '-'} />
              <Stat label="Market Cap" value={formatMarketCap(fundamentals.marketCap)} />
              <Stat label="52w Rango" value={
                fundamentals.fiftyTwoWeekLow && fundamentals.fiftyTwoWeekHigh
                  ? `$${fundamentals.fiftyTwoWeekLow.toFixed(0)} - $${fundamentals.fiftyTwoWeekHigh.toFixed(0)}`
                  : '-'
              } />
              <Stat label="Div. Yield" value={fundamentals.dividendYield ? `${(fundamentals.dividendYield * 100).toFixed(2)}%` : '-'} />
              <Stat label="Beta" value={fundamentals.beta?.toFixed(2) ?? '-'} />
              <Stat label="Vol. Promedio" value={fundamentals.avgVolume ? formatVolume(fundamentals.avgVolume) : '-'} />
            </div>
          </div>
        )}
      </div>

      {/* AI Signal */}
      {signal && (
        <SignalCard signal={signal as any} />
      )}

      {/* Deep Analysis */}
      {signal?.deepAnalysis && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold">Analisis completo</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-md bg-green-500/5 border border-green-500/20 p-3">
              <span className="text-[10px] text-green-400 uppercase tracking-wider font-medium">Lo bueno</span>
              <div className="space-y-1 mt-1">
                {(signal.deepAnalysis.positives ?? []).map((p: string, i: number) => (
                  <p key={i} className="text-xs text-foreground">- {p}</p>
                ))}
              </div>
            </div>
            <div className="rounded-md bg-red-500/5 border border-red-500/20 p-3">
              <span className="text-[10px] text-red-400 uppercase tracking-wider font-medium">Lo preocupante</span>
              <div className="space-y-1 mt-1">
                {(signal.deepAnalysis.concerns ?? []).map((c: string, i: number) => (
                  <p key={i} className="text-xs text-foreground">- {c}</p>
                ))}
              </div>
            </div>
          </div>
          <div className="rounded-md bg-blue-500/5 border border-blue-500/20 p-3">
            <span className="text-[10px] text-blue-400 uppercase tracking-wider font-medium">Recomendacion</span>
            <p className="text-xs text-foreground leading-relaxed mt-1">{signal.deepAnalysis.recommendation}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-md bg-green-500/5 border border-green-500/30 p-3">
              <span className="text-[10px] text-green-400 uppercase tracking-wider font-medium">Lo que haria</span>
              <div className="space-y-1 mt-1">
                {(signal.deepAnalysis.wouldDo ?? []).map((w: string, i: number) => (
                  <p key={i} className="text-xs text-foreground">- {w}</p>
                ))}
              </div>
            </div>
            <div className="rounded-md bg-red-500/5 border border-red-500/30 p-3">
              <span className="text-[10px] text-red-400 uppercase tracking-wider font-medium">Lo que NO haria</span>
              <div className="space-y-1 mt-1">
                {(signal.deepAnalysis.wouldNotDo ?? []).map((w: string, i: number) => (
                  <p key={i} className="text-xs text-foreground">- {w}</p>
                ))}
              </div>
            </div>
          </div>
          <span className="text-[8px] text-muted-foreground/40">Analisis generado por {signal.deepAnalysis.generatedBy}</span>
        </div>
      )}

      {/* Transactions */}
      {transactions && transactions.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Operaciones</h3>

          {/* Summary cards */}
          <div className="grid grid-cols-4 gap-3">
            <TxSumCard
              label="Compras"
              count={transactions.filter((t) => t.type === 'BUY').length}
              total={transactions.filter((t) => t.type === 'BUY').reduce((s, t) => s + (t.totalAmount ?? t.quantity * t.price), 0)}
            />
            <TxSumCard
              label="Ventas"
              count={transactions.filter((t) => t.type === 'SELL').length}
              total={transactions.filter((t) => t.type === 'SELL').reduce((s, t) => s + (t.totalAmount ?? t.quantity * t.price), 0)}
            />
            <TxSumCard
              label="Dividendos"
              count={transactions.filter((t) => t.type === 'DIVIDEND').length}
              total={transactions.filter((t) => t.type === 'DIVIDEND').reduce((s, t) => s + (t.totalAmount ?? t.quantity * t.price), 0)}
            />
            <TxSumCard
              label="Total invertido"
              count={transactions.length}
              total={transactions.filter((t) => t.type === 'BUY').reduce((s, t) => s + (t.totalAmount ?? t.quantity * t.price), 0)}
            />
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead className="text-right">Cantidad</TableHead>
                <TableHead className="text-right">Precio</TableHead>
                <TableHead>Moneda</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transactions.map((tx) => {
                const cur = tx.currency ?? 'USD';
                const total = tx.totalAmount ?? tx.quantity * tx.price;
                return (
                  <TableRow key={tx.id}>
                    <TableCell className="text-sm">
                      {new Date(tx.date).toLocaleDateString('es-AR')}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={tx.type === 'BUY' ? 'default' : tx.type === 'DIVIDEND' ? 'secondary' : 'destructive'}
                        className="text-[10px]"
                      >
                        {tx.type === 'BUY' ? 'Compra' : tx.type === 'DIVIDEND' ? 'Dividendo' : 'Venta'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono">{tx.quantity.toFixed(4)}</TableCell>
                    <TableCell className="text-right font-mono">{tx.price.toFixed(2)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{cur}</TableCell>
                    <TableCell className="text-right font-mono">
                      {total.toLocaleString('en-US', { minimumFractionDigits: 2 })} {cur}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* News */}
      {news && news.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Noticias ({news.length})
          </h3>
          <div className="space-y-2">
            {news.slice(0, 10).map((item: any) => (
              <div key={item.id} className="rounded-lg border border-border bg-card p-3 flex gap-3">
                {item.thumbnailUrl && (
                  <img src={item.thumbnailUrl} alt="" className="w-14 h-14 rounded-md object-cover shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] text-muted-foreground">{item.source}</span>
                    <span className="text-[10px] text-muted-foreground">{formatTimeAgo(item.time)}</span>
                  </div>
                  {item.url ? (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-medium hover:text-primary transition-colors line-clamp-2"
                    >
                      {item.title}
                    </a>
                  ) : (
                    <p className="text-sm font-medium line-clamp-2">{item.title}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// --- Helpers ---

function Stat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div>
      <p className="text-[10px] text-muted-foreground uppercase">{label}</p>
      <p className={`text-sm font-mono font-medium ${className ?? ''}`}>{value}</p>
    </div>
  );
}

function TxSumCard({ label, count, total }: { label: string; count: number; total: number }) {
  return (
    <div className="rounded-md border border-border p-2">
      <p className="text-[10px] text-muted-foreground uppercase">{label}</p>
      <p className="text-sm font-mono font-medium">
        {count} op. · ${total.toLocaleString('en-US', { minimumFractionDigits: 2 })}
      </p>
    </div>
  );
}

function formatMarketCap(cap: number | null): string {
  if (!cap) return '-';
  if (cap >= 1e12) return `$${(cap / 1e12).toFixed(1)}T`;
  if (cap >= 1e9) return `$${(cap / 1e9).toFixed(1)}B`;
  if (cap >= 1e6) return `$${(cap / 1e6).toFixed(0)}M`;
  return `$${cap.toLocaleString()}`;
}

function formatVolume(vol: number): string {
  if (vol >= 1e6) return `${(vol / 1e6).toFixed(1)}M`;
  if (vol >= 1e3) return `${(vol / 1e3).toFixed(0)}K`;
  return vol.toString();
}

function formatTimeAgo(time: string): string {
  const diffMs = Date.now() - new Date(time).getTime();
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  if (hours < 1) return 'Hace minutos';
  if (hours < 24) return `Hace ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Ayer';
  return `Hace ${days}d`;
}

// --- Signal Card (inline, adapted from SignalDashboard) ---

type SignalAction = 'BUY' | 'SELL' | 'HOLD' | 'WATCH';

const actionConfig: Record<SignalAction, { variant: 'default' | 'destructive' | 'secondary' | 'outline'; borderColor: string; label: string }> = {
  BUY: { variant: 'default', borderColor: 'border-l-green-500', label: 'COMPRAR' },
  SELL: { variant: 'destructive', borderColor: 'border-l-red-500', label: 'VENDER' },
  HOLD: { variant: 'secondary', borderColor: 'border-l-gray-400', label: 'MANTENER' },
  WATCH: { variant: 'outline', borderColor: 'border-l-blue-500', label: 'OBSERVAR' },
};

function ScoreBar({ score }: { score: number }) {
  const pct = Math.abs(score) / 100 * 50;
  const isPositive = score > 0;
  const color = isPositive ? 'bg-green-500' : score < 0 ? 'bg-red-500' : 'bg-gray-400';

  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 rounded-full bg-muted relative overflow-hidden">
        <div
          className={`absolute top-0 h-full rounded-full ${color}`}
          style={{
            left: isPositive ? '50%' : `${50 - pct}%`,
            width: `${pct}%`,
          }}
        />
        <div className="absolute top-0 left-1/2 h-full w-px bg-border" />
      </div>
      <span className={`text-xs font-mono ${isPositive ? 'text-green-500' : score < 0 ? 'text-red-500' : 'text-muted-foreground'}`}>
        {score > 0 ? '+' : ''}{score}
      </span>
    </div>
  );
}

function SignalCard({ signal }: { signal: any }) {
  const action = signal.action as SignalAction;
  const config = actionConfig[action] ?? actionConfig.HOLD;
  const bd = signal.breakdown;

  return (
    <div className={`rounded-lg border border-border bg-card p-4 border-l-4 ${config.borderColor} space-y-3`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Análisis del motor</h3>
          <Badge variant={config.variant} className="text-xs">
            {config.label}
          </Badge>
          <span className="text-[9px] text-muted-foreground">(opinión — tu decisión está en "Hoy")</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-20 bg-muted rounded-full h-1.5">
            <div
              className={`h-1.5 rounded-full transition-all ${signal.confidence >= 70 ? 'bg-green-500' : signal.confidence >= 50 ? 'bg-yellow-500' : 'bg-red-500'}`}
              style={{ width: `${signal.confidence}%` }}
            />
          </div>
          <span className="text-xs font-mono text-muted-foreground">{signal.confidence}%</span>
        </div>
      </div>

      <p className="text-sm">{signal.reasoning}</p>

      {bd && (
        <div className="grid grid-cols-3 gap-4 border-t pt-3">
          {bd.technical && (
            <div className="space-y-1">
              <span className="text-[10px] font-medium text-muted-foreground uppercase">Tecnico</span>
              <ScoreBar score={bd.technical.score} />
              {bd.technical.keyFactors?.slice(0, 2).map((f: string, i: number) => (
                <p key={i} className="text-[10px] text-muted-foreground">{f}</p>
              ))}
            </div>
          )}
          {bd.fundamental && (
            <div className="space-y-1">
              <span className="text-[10px] font-medium text-muted-foreground uppercase">Fundamental</span>
              <ScoreBar score={bd.fundamental.score} />
              {bd.fundamental.keyFactors?.slice(0, 2).map((f: string, i: number) => (
                <p key={i} className="text-[10px] text-muted-foreground">{f}</p>
              ))}
            </div>
          )}
          {bd.sentiment && (
            <div className="space-y-1">
              <span className="text-[10px] font-medium text-muted-foreground uppercase">Sentimiento</span>
              <ScoreBar score={bd.sentiment.score} />
              {bd.sentiment.keyFactors?.slice(0, 2).map((f: string, i: number) => (
                <p key={i} className="text-[10px] text-muted-foreground">{f}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
