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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { trpc } from '@/shared/trpc';

interface TransactionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultSymbol?: string;
}

export function TransactionDialog({ open, onOpenChange, defaultSymbol }: TransactionDialogProps) {
  const [symbol, setSymbol] = useState(defaultSymbol ?? '');
  const [type, setType] = useState<'BUY' | 'SELL' | 'DIVIDEND'>('BUY');
  const [quantity, setQuantity] = useState('');
  const [price, setPrice] = useState('');
  const [fees, setFees] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [totalAmountOverride, setTotalAmountOverride] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [platform, setPlatform] = useState('');
  const [externalId, setExternalId] = useState('');
  const [notes, setNotes] = useState('');

  const utils = trpc.useUtils();
  const addTx = trpc.portfolio.transactions.add.useMutation({
    onSuccess: () => {
      utils.portfolio.transactions.list.invalidate();
      utils.portfolio.positions.list.invalidate();
      utils.portfolio.get.invalidate();
      onOpenChange(false);
      reset();
    },
  });

  const { data: symbols } = trpc.portfolio.symbols.list.useQuery();

  // Auto-set currency when platform changes
  useEffect(() => {
    if (platform === 'Buenbit') setCurrency('USDC');
  }, [platform]);

  function reset() {
    setSymbol(defaultSymbol ?? '');
    setType('BUY');
    setQuantity('');
    setPrice('');
    setFees('');
    setCurrency('USD');
    setTotalAmountOverride('');
    setDate(new Date().toISOString().split('T')[0]);
    setPlatform('');
    setExternalId('');
    setNotes('');
  }

  const calculatedTotal = quantity && price
    ? parseFloat(quantity) * parseFloat(price) + (fees ? parseFloat(fees) : 0)
    : 0;

  const totalAmount = totalAmountOverride ? parseFloat(totalAmountOverride) : calculatedTotal;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!symbol || !quantity || !price || !date) return;
    addTx.mutate({
      symbol: symbol.toUpperCase(),
      type,
      quantity: parseFloat(quantity),
      price: parseFloat(price),
      fees: fees ? parseFloat(fees) : undefined,
      date,
      currency: currency || undefined,
      totalAmount: totalAmount > 0 ? totalAmount : undefined,
      platform: platform || undefined,
      externalId: externalId || undefined,
      notes: notes || undefined,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Registrar Operacion</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Simbolo</Label>
              <Select value={symbol} onValueChange={setSymbol}>
                <SelectTrigger className="font-mono">
                  <SelectValue placeholder="Seleccionar..." />
                </SelectTrigger>
                <SelectContent>
                  {symbols?.map((s) => (
                    <SelectItem key={s.symbol} value={s.symbol}>
                      {s.flag} {s.symbol} - {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select value={type} onValueChange={(v) => setType(v as 'BUY' | 'SELL' | 'DIVIDEND')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="BUY">Compra</SelectItem>
                  <SelectItem value="SELL">Venta</SelectItem>
                  <SelectItem value="DIVIDEND">Dividendo</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="tx-qty">Cantidad</Label>
              <Input
                id="tx-qty"
                type="number"
                step="any"
                min="0"
                placeholder="42.0487"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tx-price">Precio ({currency})</Label>
              <Input
                id="tx-price"
                type="number"
                step="any"
                min="0"
                placeholder="47.56"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tx-fees">Comision ({currency})</Label>
              <Input
                id="tx-fees"
                type="number"
                step="any"
                min="0"
                placeholder="0"
                value={fees}
                onChange={(e) => setFees(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Moneda</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="USDC">USDC</SelectItem>
                  <SelectItem value="ARS">ARS</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="tx-date">Fecha</Label>
              <Input
                id="tx-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Plataforma</Label>
              <Select value={platform} onValueChange={setPlatform}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Buenbit">Buenbit</SelectItem>
                  <SelectItem value="Balanz">Balanz</SelectItem>
                  <SelectItem value="IOL">IOL (InvertirOnline)</SelectItem>
                  <SelectItem value="Binance">Binance</SelectItem>
                  <SelectItem value="Otro">Otro</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="tx-total">Monto total ({currency})</Label>
              <Input
                id="tx-total"
                type="number"
                step="any"
                min="0"
                placeholder={calculatedTotal > 0 ? calculatedTotal.toFixed(2) : '2000.00'}
                value={totalAmountOverride}
                onChange={(e) => setTotalAmountOverride(e.target.value)}
              />
              {!totalAmountOverride && calculatedTotal > 0 && (
                <p className="text-[10px] text-muted-foreground">Auto: {calculatedTotal.toFixed(2)}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="tx-extid">Nro. operacion (opcional)</Label>
              <Input
                id="tx-extid"
                placeholder="bcf4940...d8b0c92"
                value={externalId}
                onChange={(e) => setExternalId(e.target.value)}
                className="font-mono text-xs"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tx-notes">Notas (opcional)</Label>
            <Input
              id="tx-notes"
              placeholder="Detalle de la operacion..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {totalAmount > 0 && (
            <div className="rounded-md bg-muted p-3 text-sm">
              <span className="text-muted-foreground">Total: </span>
              <span className="font-mono font-medium">
                {totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })} {currency}
              </span>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={addTx.isPending}>
              {addTx.isPending ? 'Guardando...' : 'Registrar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
