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
import { TransactionDialog } from './TransactionDialog';

export function TransactionHistory() {
  const [txDialogOpen, setTxDialogOpen] = useState(false);
  const [symbolFilter, setSymbolFilter] = useState('');

  const utils = trpc.useUtils();
  const { data: transactions, isLoading } = trpc.portfolio.transactions.list.useQuery();
  const deleteTx = trpc.portfolio.transactions.delete.useMutation({
    onSuccess: () => {
      utils.portfolio.transactions.list.invalidate();
    },
  });

  if (isLoading) {
    return <div className="p-6 text-muted-foreground">Cargando transacciones...</div>;
  }

  const filteredTransactions = (transactions ?? []).filter((tx) =>
    !symbolFilter || tx.symbol.includes(symbolFilter)
  );

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Historial de Operaciones</h2>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Buscar símbolo..."
            value={symbolFilter}
            onChange={(e) => setSymbolFilter(e.target.value.toUpperCase())}
            className="h-7 px-2 text-xs rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring w-36"
          />
          <Button size="sm" onClick={() => setTxDialogOpen(true)}>
            + Operacion
          </Button>
        </div>
      </div>

      {!filteredTransactions || filteredTransactions.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          {symbolFilter ? (
            <p className="text-sm">No hay operaciones para '{symbolFilter}'</p>
          ) : (
            <>
              <p className="text-sm">No hay operaciones registradas.</p>
              <p className="text-xs mt-1">Usa el boton "+ Operacion" para registrar compras y ventas.</p>
            </>
          )}
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Simbolo</TableHead>
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
            {filteredTransactions.map((tx) => {
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
                  <TableCell className="font-medium font-mono">{tx.symbol}</TableCell>
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
      )}

      <TransactionDialog
        open={txDialogOpen}
        onOpenChange={setTxDialogOpen}
      />
    </div>
  );
}
