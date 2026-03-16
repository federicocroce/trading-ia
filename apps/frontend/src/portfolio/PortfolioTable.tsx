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
import { trpc } from '@/shared/trpc';
import { useNavigation } from '@/shared/navigation';
import { PositionDialog } from './PositionDialog';
import { TransactionDialog } from './TransactionDialog';
import { SymbolHistoryDialog } from './SymbolHistoryDialog';

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
    refetchInterval: 10_000,
  });
  const deletePos = trpc.portfolio.positions.delete.useMutation({
    onSuccess: () => {
      utils.portfolio.positions.list.invalidate();
      utils.portfolio.get.invalidate();
    },
  });

  if (isLoading) {
    return <div className="p-6 text-muted-foreground">Cargando portfolio...</div>;
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

      {/* Positions table */}
      <Table>
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
