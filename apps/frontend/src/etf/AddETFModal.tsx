import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { trpc } from '@/shared/trpc';

const CATEGORIES = [
  { value: 'indices', label: 'Índices' },
  { value: 'sectores', label: 'Sectores' },
  { value: 'bonos', label: 'Bonos' },
  { value: 'commodities', label: 'Commodities' },
  { value: 'latam', label: 'Latam' },
  { value: 'internacional', label: 'Internacional' },
  { value: 'crypto', label: 'Crypto' },
  { value: 'factor', label: 'Factor' },
] as const;

type Category = typeof CATEGORIES[number]['value'];

interface AddETFModalProps {
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
}

export function AddETFModal({ open, onClose, onAdded }: AddETFModalProps) {
  const [symbol, setSymbol] = useState('');
  const [category, setCategory] = useState<Category>('indices');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');

  const addMutation = trpc.etf.addToWatchlist.useMutation({
    onSuccess: () => {
      setSymbol('');
      setDescription('');
      setError('');
      onAdded();
      onClose();
    },
    onError: (e) => setError(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Agregar ETF al watchlist</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 pt-2">
          <Input
            placeholder="Símbolo (ej: VOO)"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          />
          <select
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
            value={category}
            onChange={(e) => setCategory(e.target.value as Category)}
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
          <Input
            placeholder="Descripción (opcional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={onClose}>Cancelar</Button>
            <Button
              disabled={!symbol || addMutation.isPending}
              onClick={() => addMutation.mutate({ symbol, category, description: description || undefined })}
            >
              {addMutation.isPending ? 'Verificando...' : 'Agregar'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
