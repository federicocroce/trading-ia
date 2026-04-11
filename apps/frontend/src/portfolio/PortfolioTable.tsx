import { useState } from 'react';
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { trpc } from '@/shared/trpc';
import { useNavigation } from '@/shared/navigation';
import { TableSkeleton } from '@/shared/Skeleton';
import { PositionDialog } from './PositionDialog';
import { TransactionDialog } from './TransactionDialog';
import { SymbolHistoryDialog } from './SymbolHistoryDialog';

type SignalAction = 'BUY' | 'SELL' | 'HOLD' | 'WATCH';
type ConvictionTier = 'strong' | 'standard' | 'speculative';

const actionStyle: Record<SignalAction, { label: string; bg: string; text: string }> = {
  BUY: { label: 'COMPRAR', bg: 'bg-green-500/20', text: 'text-green-400' },
  SELL: { label: 'VENDER', bg: 'bg-red-500/20', text: 'text-red-400' },
  HOLD: { label: 'MANTENER', bg: 'bg-blue-500/20', text: 'text-blue-400' },
  WATCH: { label: 'OBSERVAR', bg: 'bg-yellow-500/20', text: 'text-yellow-400' },
};

function RecommendationCell({
  action,
  score,
  confidence,
  convictionTier,
  reasoning,
}: {
  action: SignalAction;
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
          <span className="text-[9px] font-mono text-muted-foreground">{score}</span>
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

  const { goToSymbol } = useNavigation();
  const utils = trpc.useUtils();
  const { data: portfolio, isLoading } = trpc.portfolio.get.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const { data: scan } = trpc.opportunities.scan.useQuery(undefined, {
    staleTime: 5 * 60_000,
  });

  // Build lookup map from latest scan: symbol → opportunity
  const opportunityMap = new Map(
    (scan?.opportunities ?? []).map((o) => [o.symbol, o]),
  );
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
    <div className="p-6 space-y-4">
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
        {portfolio.positions.map((pos) => (
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
              <span className="text-muted-foreground">${pos.currentPrice.toFixed(2)}</span>
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
          {portfolio.positions.map((pos) => (
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
              <TableCell className="text-right">${pos.currentPrice.toFixed(2)}</TableCell>
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
                  if (!opp) return <span className="text-[9px] text-muted-foreground/40">—</span>;
                  return (
                    <RecommendationCell
                      action={opp.action as SignalAction}
                      score={opp.opportunityScore}
                      confidence={opp.confidence}
                      convictionTier={(opp as any).convictionTier as ConvictionTier | undefined}
                      reasoning={(opp as any).simpleReasoning ?? opp.reasoning}
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
    </div>
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
