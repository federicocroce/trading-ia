import { useState } from 'react';
import { TabInfo, InfoSection } from '@/shared/TabInfo';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { trpc } from '@/shared/trpc';
import { useNavigation } from '@/shared/navigation';
import { useMarketRefetchInterval } from '@/shared/useMarketRefetchInterval';
import { TableSkeleton } from '@/shared/Skeleton';
import { PositionDialog } from './PositionDialog';
import { TransactionDialog } from './TransactionDialog';
import { SymbolHistoryDialog } from './SymbolHistoryDialog';

type SignalAction = 'BUY' | 'SELL' | 'HOLD' | 'WATCH';
// La columna "Señal IA" también refleja el veredicto de "Hoy" (VENDER/REVISAR/MANTENER), que no
// es un SignalAction del scan — se agrega 'REVISAR' acá para que el badge nunca lo esconda como
// un MANTENER a secas (mismo doble discurso que el bug original de la vista Hoy).
type BadgeAction = SignalAction | 'REVISAR';
type ConvictionTier = 'strong' | 'standard' | 'speculative';

const actionStyle: Record<BadgeAction, { label: string; bg: string; text: string }> = {
  BUY: { label: 'COMPRAR', bg: 'bg-green-500/20', text: 'text-green-400' },
  SELL: { label: 'VENDER', bg: 'bg-red-500/20', text: 'text-red-400' },
  HOLD: { label: 'MANTENER', bg: 'bg-blue-500/20', text: 'text-blue-400' },
  WATCH: { label: 'OBSERVAR', bg: 'bg-yellow-500/20', text: 'text-yellow-400' },
  REVISAR: { label: 'REVISAR', bg: 'bg-amber-500/20', text: 'text-amber-400' },
};

function RecommendationCell({
  action,
  score,
  confidence,
  convictionTier,
  reasoning,
}: {
  action: BadgeAction;
  score: number;
  confidence: number;
  convictionTier?: ConvictionTier;
  reasoning?: string;
}) {
  const act = actionStyle[action] ?? actionStyle.WATCH;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-1.5 justify-end cursor-help">
          <Badge className={`text-[9px] h-4 font-bold ${act.bg} ${act.text}`}>{act.label}</Badge>
          {/* El score compuesto NO se muestra (coherencia con Hoy y Oportunidades, 2026-07-27):
              medido contra el índice no separa ganadores (r=0.064, ns). Se sigue calculando y
              persistiendo para poder re-medirlo. */}
          {convictionTier === 'strong' && (
            <Badge variant="outline" className="text-[8px] h-3.5 border-trading-green text-trading-green px-1">STRONG</Badge>
          )}
          {convictionTier === 'speculative' && (
            <Badge variant="outline" className="text-[8px] h-3.5 border-yellow-500 text-yellow-500 px-1">SPEC.</Badge>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs">
        <div className="space-y-1">
          <div>Confianza: {confidence}%</div>
          {reasoning && <div>{reasoning}</div>}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

export function PortfolioTable() {
  const [posDialogOpen, setPosDialogOpen] = useState(false);
  const [txDialogOpen, setTxDialogOpen] = useState(false);
  const [editData, setEditData] = useState<{ symbol: string; quantity: number; avgCost: number } | null>(null);
  const [txSymbol, setTxSymbol] = useState<string | undefined>();
  const [historySymbol, setHistorySymbol] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [watchlistTab, setWatchlistTab] = useState<'portfolio' | 'etfs' | 'acciones' | 'crypto'>('portfolio');
  const [watchlistSearch, setWatchlistSearch] = useState('');

  const { goToSymbol } = useNavigation();
  const utils = trpc.useUtils();
  const refetchInterval = useMarketRefetchInterval();
  const { data: portfolio, isLoading } = trpc.portfolio.get.useQuery(undefined, {
    refetchInterval,
  });
  const { data: scan } = trpc.opportunities.scan.useQuery(undefined, {
    staleTime: 5 * 60_000,
  });
  // Fuente ÚNICA de la DECISIÓN: la misma función que "Hoy" (trailing stop + tu costo).
  const { data: today } = trpc.opportunities.today.useQuery(undefined, { staleTime: 60_000, refetchInterval });

  // Build lookup map from latest scan: symbol → opportunity (score/análisis del motor)
  const opportunityMap = new Map(
    (scan?.opportunities ?? []).map((o) => [o.symbol, o]),
  );
  // Decisión por símbolo desde "Hoy" (MANTENER/VENDER) — para no contradecir.
  const todayMap = new Map((today?.portfolio ?? []).map((p) => [p.symbol.toUpperCase(), p]));
  const allPositions = portfolio?.positions ?? [];
  const displayedPositions = watchlistTab === 'portfolio' && watchlistSearch
    ? allPositions.filter(
        (p) => p.symbol.toLowerCase().includes(watchlistSearch.toLowerCase()) ||
               ((p as any).name ?? p.symbol).toLowerCase().includes(watchlistSearch.toLowerCase())
      )
    : allPositions;
  const deletePos = trpc.portfolio.positions.delete.useMutation({
    onSuccess: () => {
      utils.portfolio.positions.list.invalidate();
      utils.portfolio.get.invalidate();
    },
  });

  if (isLoading) {
    return <TableSkeleton rows={6} cols={8} />;
  }

  if (!portfolio) return null;

  function handleEdit(pos: { symbol: string; quantity: number; avgCost: number }) {
    setEditData(pos);
    setPosDialogOpen(true);
  }

  function handleDelete(symbol: string) {
    if (confirm(`Eliminar posicion de ${symbol}?`)) {
      deletePos.mutate({ symbol });
    }
  }

  function handleAddTx(symbol?: string) {
    setTxSymbol(symbol);
    setTxDialogOpen(true);
  }

  return (
    <>
    <TabInfo>
      <InfoSection title="Qué muestra">Posiciones actuales del portafolio con precio en tiempo real de Yahoo Finance.</InfoSection>
      <InfoSection title="Flujo">Historial de transacciones → precio promedio de compra por posición → enriquecimiento con precio actual (Yahoo Finance v8 API) → cálculo de P&L.</InfoSection>
      <InfoSection title="Valores">Precio promedio de compra · Precio actual · P&L en $ y % · Valor total de cada posición · Exposición total del portafolio.</InfoSection>
      <InfoSection title="Interacción">Click en un símbolo → detalle con chart histórico y análisis AI completo de esa acción.</InfoSection>
    </TabInfo>
    <div className="p-6 space-y-4">
      {/* Watchlist tabs + search bar */}
      <div className="flex flex-col gap-2 px-4 pt-3 pb-2 border-b border-border -mx-4">
        <div className="flex items-center gap-3">
          <Input
            placeholder="Buscar por símbolo o nombre..."
            value={watchlistSearch}
            onChange={(e) => setWatchlistSearch(e.target.value)}
            className="max-w-xs h-7 text-xs"
          />
        </div>
        <div className="flex gap-1">
          {(['portfolio', 'etfs', 'acciones', 'crypto'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setWatchlistTab(tab)}
              className={`text-xs px-3 py-1 rounded-sm transition-colors ${watchlistTab === tab ? 'bg-blue-500/20 text-blue-300' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {tab === 'portfolio' ? 'Portfolio' : tab === 'etfs' ? 'ETFs' : tab === 'acciones' ? 'Acciones' : 'Crypto'}
            </button>
          ))}
        </div>
      </div>

      {watchlistTab === 'portfolio' && (
        <>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Portfolio</h2>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => handleAddTx()}>
                + Operacion
              </Button>
              <Button size="sm" onClick={() => { setEditData(null); setPosDialogOpen(true); }}>
                + Posicion
              </Button>
            </div>
          </div>

          {/* Summary */}
          <div className="grid grid-cols-4 gap-3">
            <SummaryCard
              label="Valor Total"
              value={`$${portfolio.totalValue.toLocaleString('en-US', { minimumFractionDigits: 0 })}`}
            />
            <SummaryCard
              label="Costo Total"
              value={`$${portfolio.totalCost.toLocaleString('en-US', { minimumFractionDigits: 0 })}`}
            />
            <SummaryCard
              label="P&L"
              value={`${portfolio.totalPnl >= 0 ? '+' : ''}$${portfolio.totalPnl.toLocaleString('en-US', { minimumFractionDigits: 0 })}`}
              className={portfolio.totalPnl >= 0 ? 'text-trading-green' : 'text-trading-red'}
            />
            <SummaryCard
              label="P&L %"
              value={`${portfolio.totalPnlPercent >= 0 ? '+' : ''}${portfolio.totalPnlPercent.toFixed(1)}%`}
              className={portfolio.totalPnlPercent >= 0 ? 'text-trading-green' : 'text-trading-red'}
            />
          </div>

          {/* Mobile card layout */}
          <div className="lg:hidden space-y-2">
            {displayedPositions.length === 0 && watchlistSearch ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                No hay posiciones para '{watchlistSearch}'
              </div>
            ) : displayedPositions.map((pos) => (
              <Card key={pos.symbol} className="p-3 cursor-pointer" onClick={() => goToSymbol(pos.symbol)}>
                <div className="flex justify-between items-center">
                  <span className="font-bold font-mono">{pos.symbol}</span>
                  <Badge
                    variant={pos.pnlPercent >= 0 ? 'secondary' : 'destructive'}
                    className={pos.pnlPercent >= 0 ? 'bg-trading-green text-foreground' : ''}
                  >
                    {pos.pnlPercent >= 0 ? '+' : ''}{pos.pnlPercent.toFixed(1)}%
                  </Badge>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                  <span>{pos.quantity} @ ${pos.avgCost.toFixed(2)}</span>
                  <span className={pos.pnl >= 0 ? 'text-trading-green' : 'text-trading-red'}>
                    {pos.pnl >= 0 ? '+' : ''}${pos.pnl.toLocaleString('en-US', { minimumFractionDigits: 0 })}
                  </span>
                </div>
                <div className="flex justify-between text-xs mt-1">
                  <span className="flex items-center gap-1.5">
                    <span className="text-muted-foreground">${pos.currentPrice.toFixed(2)}</span>
                    <span className={`font-medium ${pos.changePercent >= 0 ? 'text-trading-green' : 'text-trading-red'}`}>
                      {pos.changePercent >= 0 ? '+' : ''}{pos.changePercent.toFixed(2)}%
                    </span>
                  </span>
                  <span>${pos.value.toLocaleString('en-US', { minimumFractionDigits: 0 })}</span>
                </div>
              </Card>
            ))}
          </div>

          {/* Desktop table */}
          <Table className="hidden lg:table">
            <TableHeader>
              <TableRow>
                <TableHead>Simbolo</TableHead>
                <TableHead className="text-right">Cantidad</TableHead>
                <TableHead className="text-right">Invertido</TableHead>
                <TableHead className="text-right">Costo Prom.</TableHead>
                <TableHead className="text-right">Precio</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead className="text-right">P&L</TableHead>
                <TableHead className="text-right">P&L %</TableHead>
                <TableHead className="text-right">Señal IA</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayedPositions.length === 0 && watchlistSearch ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-8 text-muted-foreground text-sm">
                    No hay posiciones para '{watchlistSearch}'
                  </TableCell>
                </TableRow>
              ) : null}
              {displayedPositions.map((pos) => (
                <TableRow key={pos.symbol}>
                  <TableCell
                    className="font-medium font-mono cursor-pointer hover:text-primary transition-colors"
                    onClick={() => goToSymbol(pos.symbol)}
                  >
                    {pos.symbol}
                  </TableCell>
                  <TableCell className="text-right">{pos.quantity}</TableCell>
                  <TableCell className="text-right font-mono">
                    ${(pos.quantity * pos.avgCost).toLocaleString('en-US', { minimumFractionDigits: 0 })}
                  </TableCell>
                  <TableCell className="text-right">${pos.avgCost.toFixed(2)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <span>${pos.currentPrice.toFixed(2)}</span>
                      <span className={`text-[10px] font-medium ${pos.changePercent >= 0 ? 'text-trading-green' : 'text-trading-red'}`}>
                        {pos.changePercent >= 0 ? '+' : ''}{pos.changePercent.toFixed(2)}%
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    ${pos.value.toLocaleString('en-US', { minimumFractionDigits: 0 })}
                  </TableCell>
                  <TableCell className="text-right">
                    <span className={pos.pnl >= 0 ? 'text-trading-green' : 'text-trading-red'}>
                      {pos.pnl >= 0 ? '+' : ''}${pos.pnl.toLocaleString('en-US', { minimumFractionDigits: 0 })}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge
                      variant={pos.pnlPercent >= 0 ? 'secondary' : 'destructive'}
                      className={pos.pnlPercent >= 0 ? 'bg-trading-green text-foreground' : ''}
                    >
                      {pos.pnlPercent >= 0 ? '+' : ''}{pos.pnlPercent.toFixed(1)}%
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {(() => {
                      const opp = opportunityMap.get(pos.symbol);
                      const dec = todayMap.get(pos.symbol.toUpperCase());
                      if (!opp && !dec) return <span className="text-[9px] text-muted-foreground/40">—</span>;
                      // La ACCIÓN es la decisión de "Hoy" (VENDER/REVISAR/MANTENER); el score queda como análisis del motor.
                      const action: BadgeAction = dec
                        ? (dec.verb === 'VENDER' ? 'SELL' : dec.verb === 'REVISAR' ? 'REVISAR' : 'HOLD')
                        : (opp!.action as SignalAction);
                      return (
                        <RecommendationCell
                          action={action}
                          score={opp?.opportunityScore ?? 0}
                          confidence={opp?.confidence ?? 0}
                          convictionTier={(opp as any)?.convictionTier as ConvictionTier | undefined}
                          reasoning={dec?.reason ?? (opp as any)?.simpleReasoning ?? opp?.reasoning}
                        />
                      );
                    })()}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        onClick={() => goToSymbol(pos.symbol)}
                      >
                        Ver
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        onClick={() => handleAddTx(pos.symbol)}
                      >
                        Op.
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        onClick={() => handleEdit(pos)}
                      >
                        Editar
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs text-destructive"
                        onClick={() => handleDelete(pos.symbol)}
                      >
                        X
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {/* Dialogs */}
          <PositionDialog
            open={posDialogOpen}
            onOpenChange={setPosDialogOpen}
            editData={editData}
          />
          <TransactionDialog
            open={txDialogOpen}
            onOpenChange={setTxDialogOpen}
            defaultSymbol={txSymbol}
          />
          <SymbolHistoryDialog
            open={historyOpen}
            onOpenChange={setHistoryOpen}
            symbol={historySymbol}
          />
        </>
      )}

      {watchlistTab === 'etfs' && (
        <p className="text-muted-foreground text-sm p-8 text-center">
          Ver watchlist completo en la tab "ETFs"
        </p>
      )}
      {watchlistTab === 'acciones' && (
        <p className="text-muted-foreground text-sm p-8 text-center">
          Acciones curadas — próximamente
        </p>
      )}
      {watchlistTab === 'crypto' && (
        <p className="text-muted-foreground text-sm p-8 text-center">
          Crypto — próximamente
        </p>
      )}
    </div>
    </>
  );
}

function SummaryCard({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
      <p className={`text-lg font-semibold font-mono ${className ?? ''}`}>{value}</p>
    </div>
  );
}
