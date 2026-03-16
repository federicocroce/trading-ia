import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { trpc } from '@/shared/trpc';

interface PositionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editData?: { symbol: string; quantity: number; avgCost: number } | null;
}

export function PositionDialog({ open, onOpenChange, editData }: PositionDialogProps) {
  const [symbol, setSymbol] = useState('');
  const [quantity, setQuantity] = useState('');
  const [avgCost, setAvgCost] = useState('');
  const [notes, setNotes] = useState('');

  const utils = trpc.useUtils();
  const upsert = trpc.portfolio.positions.upsert.useMutation({
    onSuccess: () => {
      utils.portfolio.positions.list.invalidate();
      utils.portfolio.get.invalidate();
      onOpenChange(false);
      reset();
    },
  });

  useEffect(() => {
    if (editData) {
      setSymbol(editData.symbol);
      setQuantity(editData.quantity.toString());
      setAvgCost(editData.avgCost.toString());
    } else {
      reset();
    }
  }, [editData, open]);

  function reset() {
    setSymbol('');
    setQuantity('');
    setAvgCost('');
    setNotes('');
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!symbol || !quantity || !avgCost) return;
    upsert.mutate({
      symbol: symbol.toUpperCase(),
      quantity: parseFloat(quantity),
      avgCost: parseFloat(avgCost),
      notes: notes || undefined,
    });
  }

  const isEdit = !!editData;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Editar Posicion' : 'Agregar Posicion'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="symbol">Simbolo</Label>
            <Input
              id="symbol"
              placeholder="VIST, YPF, BTC-USD..."
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              disabled={isEdit}
              className="font-mono uppercase"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="quantity">Cantidad</Label>
              <Input
                id="quantity"
                type="number"
                step="any"
                min="0"
                placeholder="150"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="avgCost">Precio Promedio (USD)</Label>
              <Input
                id="avgCost"
                type="number"
                step="any"
                min="0"
                placeholder="42.50"
                value={avgCost}
                onChange={(e) => setAvgCost(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes">Notas (opcional)</Label>
            <Input
              id="notes"
              placeholder="Comprado en Balanz..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={upsert.isPending}>
              {upsert.isPending ? 'Guardando...' : isEdit ? 'Actualizar' : 'Agregar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
