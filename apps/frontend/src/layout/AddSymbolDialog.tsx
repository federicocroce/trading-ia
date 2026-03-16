import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { trpc } from '@/shared/trpc';

interface AddSymbolDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function useDebounce(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function AddSymbolDialog({ open, onOpenChange }: AddSymbolDialogProps) {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 300);
  const utils = trpc.useUtils();

  const { data: existingSymbols } = trpc.portfolio.symbols.list.useQuery();
  const existingSet = new Set(existingSymbols?.map((s) => s.symbol) ?? []);

  const { data: results, isLoading } = trpc.portfolio.symbols.search.useQuery(
    { query: debouncedQuery },
    { enabled: debouncedQuery.length >= 1 },
  );

  const addMutation = trpc.portfolio.symbols.add.useMutation({
    onSuccess: () => {
      utils.portfolio.symbols.list.invalidate();
      utils.prices.getAll.invalidate();
    },
  });

  const handleAdd = (result: { symbol: string; name: string; type: 'adr' | 'us' | 'crypto'; flag: string }) => {
    addMutation.mutate({
      symbol: result.symbol,
      name: result.name,
      type: result.type,
      flag: result.flag,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Agregar Simbolo</DialogTitle>
        </DialogHeader>

        <Input
          placeholder="Buscar simbolo (ej: MELI, AAPL, BTC)..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />

        <ScrollArea className="max-h-[300px]">
          {isLoading && debouncedQuery.length >= 1 && (
            <p className="text-sm text-muted-foreground py-4 text-center">Buscando...</p>
          )}

          {!isLoading && results && results.length === 0 && debouncedQuery.length >= 1 && (
            <p className="text-sm text-muted-foreground py-4 text-center">Sin resultados</p>
          )}

          {results?.map((result) => {
            const alreadyAdded = existingSet.has(result.symbol);
            return (
              <div
                key={result.symbol}
                className="flex items-center justify-between px-2 py-2.5 hover:bg-accent rounded-md"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs">{result.flag}</span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium font-mono">{result.symbol}</span>
                      <Badge variant="outline" className="text-[9px]">{result.type}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{result.name}</p>
                    <p className="text-[10px] text-muted-foreground">{result.exchange}</p>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant={alreadyAdded ? 'ghost' : 'secondary'}
                  disabled={alreadyAdded || addMutation.isPending}
                  onClick={() => handleAdd(result)}
                  className="shrink-0 text-xs"
                >
                  {alreadyAdded ? 'Agregado' : 'Agregar'}
                </Button>
              </div>
            );
          })}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
