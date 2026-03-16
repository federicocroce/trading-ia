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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { trpc } from '@/shared/trpc';

interface SymbolHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  symbol: string;
}

export function SymbolHistoryDialog({ open, onOpenChange, symbol }: SymbolHistoryDialogProps) {
  const utils = trpc.useUtils();
  const { data: transactions, isLoading } = trpc.portfolio.transactions.list.useQuery(
    { symbol },
    { enabled: open && !!symbol },
  );
  const deleteTx = trpc.portfolio.transactions.delete.useMutation({
    onSuccess: () => {
      utils.portfolio.transactions.list.invalidate();
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-mono">Operaciones de {symbol}</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="py-8 text-center text-muted-foreground text-sm">Cargando...</div>
        ) : !transactions || transactions.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">
            <p className="text-sm">No hay operaciones registradas para {symbol}.</p>
          </div>
        ) : (
          <>
            {/* Summary */}
            <div className="grid grid-cols-4 gap-3 mb-2">
              <SumCard
                label="Compras"
                value={transactions.filter((t) => t.type === 'BUY').length}
                total={transactions.filter((t) => t.type === 'BUY').reduce((s, t) => s + (t.totalAmount ?? t.quantity * t.price), 0)}
              />
              <SumCard
                label="Ventas"
                value={transactions.filter((t) => t.type === 'SELL').length}
                total={transactions.filter((t) => t.type === 'SELL').reduce((s, t) => s + (t.totalAmount ?? t.quantity * t.price), 0)}
              />
              <SumCard
                label="Dividendos"
                value={transactions.filter((t) => t.type === 'DIVIDEND').length}
                total={transactions.filter((t) => t.type === 'DIVIDEND').reduce((s, t) => s + (t.totalAmount ?? t.quantity * t.price), 0)}
              />
              <SumCard
                label="Comisiones"
                value={transactions.length}
                total={transactions.reduce((s, t) => s + (t.fees ?? 0), 0)}
                isCommission
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
                  <TableHead className="text-right">Comision</TableHead>
                  <TableHead>Plataforma</TableHead>
                  <TableHead className="text-right"></TableHead>
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
                      <TableCell className="text-right">{tx.quantity}</TableCell>
                      <TableCell className="text-right">{tx.price.toFixed(2)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{cur}</TableCell>
                      <TableCell className="text-right font-mono">
                        {total.toLocaleString('en-US', { minimumFractionDigits: 2 })} {cur}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {tx.fees ? `${tx.fees.toFixed(2)}` : '-'}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {tx.platform ?? '-'}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs text-destructive"
                          onClick={() => {
                            if (confirm('Eliminar esta operacion?')) {
                              deleteTx.mutate({ id: tx.id });
                            }
                          }}
                        >
                          X
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SumCard({ label, value, total, isCommission }: { label: string; value: number; total: number; isCommission?: boolean }) {
  return (
    <div className="rounded-md border border-border p-2">
      <p className="text-[10px] text-muted-foreground uppercase">{label}</p>
      <p className="text-sm font-mono font-medium">
        {isCommission ? '' : `${value} op. · `}${total > 0 ? '$' : ''}
        {total.toLocaleString('en-US', { minimumFractionDigits: 2 })}
      </p>
    </div>
  );
}
