import { useEffect, useMemo, useState } from 'react';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { trpc } from '@/shared/trpc';
import { useNavigation } from '@/shared/navigation';
import {
  classifyInstrument,
  INSTRUMENT_LABELS,
  type InstrumentFilter,
} from '@/shared/instrumentType';
import { ETF_CATEGORY_LABELS, ETF_CATEGORY_ORDER, type EtfCategory } from '@/etf/categories';
import { AddSymbolDialog } from './AddSymbolDialog';

interface SidebarProps {
  open?: boolean;
  onClose?: () => void;
}

type SortMode = 'default' | 'changeDesc' | 'changeAsc' | 'category';

const SORT_STORAGE_KEY = 'watchlist:sort';
const SORT_VALUES: readonly SortMode[] = ['default', 'changeDesc', 'changeAsc', 'category'];

function readStoredSort(): SortMode {
  if (typeof window === 'undefined') return 'default';
  const v = window.localStorage.getItem(SORT_STORAGE_KEY);
  return (SORT_VALUES as readonly string[]).includes(v ?? '') ? (v as SortMode) : 'default';
}

export function Sidebar({ open = true, onClose }: SidebarProps) {
  const { goToSymbol } = useNavigation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<InstrumentFilter>('all');
  const [sortMode, setSortMode] = useState<SortMode>(readStoredSort);
  const utils = trpc.useUtils();

  const { data: symbols } = trpc.portfolio.symbols.list.useQuery();
  const { data: prices } = trpc.prices.getAll.useQuery(undefined, {
    refetchInterval: 5 * 60_000, // 5 min fallback (WS provides real-time)
  });
  const { data: etfWatchlist } = trpc.etf.getWatchlist.useQuery(undefined, {
    staleTime: 5 * 60_000,
  });
  const deleteMutation = trpc.portfolio.symbols.delete.useMutation({
    onSuccess: () => {
      utils.portfolio.symbols.list.invalidate();
      utils.prices.getAll.invalidate();
    },
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(SORT_STORAGE_KEY, sortMode);
  }, [sortMode]);

  const priceMap = useMemo(
    () => new Map(prices?.map((p) => [p.symbol, p]) ?? []),
    [prices],
  );

  const etfCategoryMap = useMemo(
    () => new Map<string, EtfCategory>(
      (etfWatchlist ?? []).map((e) => [e.symbol, e.category as EtfCategory]),
    ),
    [etfWatchlist],
  );

  const filteredSymbols = useMemo(() => {
    if (!symbols) return [];
    const q = searchQuery.trim().toLowerCase();
    return symbols.filter((s) => {
      if (typeFilter !== 'all' && classifyInstrument(s) !== typeFilter) return false;
      if (q && !s.symbol.toLowerCase().includes(q) && !(s.name ?? '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [symbols, searchQuery, typeFilter]);

  const sortedSymbols = useMemo(() => {
    if (sortMode !== 'changeDesc' && sortMode !== 'changeAsc') return filteredSymbols;
    const dir = sortMode === 'changeDesc' ? -1 : 1;
    return [...filteredSymbols].sort((a, b) => {
      const pa = priceMap.get(a.symbol)?.changePercent;
      const pb = priceMap.get(b.symbol)?.changePercent;
      if (pa == null && pb == null) return 0;
      if (pa == null) return 1;
      if (pb == null) return -1;
      return (pa - pb) * dir;
    });
  }, [filteredSymbols, sortMode, priceMap]);

  type SymbolRow = (typeof filteredSymbols)[number];

  const groupedSymbols = useMemo(() => {
    if (sortMode !== 'category') return null;
    const groups = new Map<EtfCategory | 'otros', SymbolRow[]>();
    for (const s of filteredSymbols) {
      const cat = etfCategoryMap.get(s.symbol) ?? 'otros';
      const list = groups.get(cat);
      if (list) list.push(s);
      else groups.set(cat, [s]);
    }
    const ordered: { key: EtfCategory | 'otros'; label: string; items: SymbolRow[] }[] = [];
    for (const cat of ETF_CATEGORY_ORDER) {
      const items = groups.get(cat);
      if (items && items.length > 0) ordered.push({ key: cat, label: ETF_CATEGORY_LABELS[cat], items });
    }
    const otros = groups.get('otros');
    if (otros && otros.length > 0) ordered.push({ key: 'otros', label: 'Otros', items: otros });
    return ordered;
  }, [filteredSymbols, sortMode, etfCategoryMap]);

  const handleSymbolClick = (symbol: string) => {
    goToSymbol(symbol);
    onClose?.(); // Close sidebar on mobile after selection
  };

  const renderRow = (stock: SymbolRow) => {
    const price = priceMap.get(stock.symbol);
    return (
      <div
        key={stock.symbol}
        className="group flex items-center justify-between px-4 py-3 hover:bg-accent cursor-pointer transition-colors"
        onClick={() => handleSymbolClick(stock.symbol)}
      >
        <div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs">{stock.flag}</span>
            <span className="font-medium text-sm">{stock.symbol}</span>
          </div>
          <span className="text-xs text-muted-foreground">{stock.name}</span>
        </div>
        <div className="flex items-center gap-2">
          {price ? (
            <div className="text-right">
              <div className="text-sm font-medium">${price.current.toFixed(2)}</div>
              <div className={`text-xs font-medium ${price.changePercent >= 0 ? 'text-trading-green' : 'text-trading-red'}`}>
                {price.changePercent >= 0 ? '+' : ''}{price.changePercent.toFixed(2)}%
              </div>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">...</div>
          )}
          <button
            className="hidden group-hover:block text-muted-foreground hover:text-destructive text-xs p-1"
            aria-label={`Eliminar ${stock.symbol}`}
            onClick={(e) => {
              e.stopPropagation();
              deleteMutation.mutate({ symbol: stock.symbol });
            }}
          >
            ×
          </button>
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Mobile overlay backdrop */}
      {open && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside className={`
        bg-card border-r border-border flex flex-col overflow-hidden transition-all duration-200
        ${open ? 'w-64' : 'w-0 overflow-hidden'}
        fixed lg:relative inset-y-0 left-0 z-50 lg:z-auto
        lg:w-64
      `}>
        <div className="p-4 pb-2 flex items-center justify-between">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Watchlist
          </h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDialogOpen(true)}
            className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
            aria-label="Agregar simbolo"
          >
            +
          </Button>
        </div>
        <div className="px-4 pb-3 space-y-2">
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar por símbolo o nombre"
            className="h-8 text-xs"
          />
          <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as InstrumentFilter)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Tipo" />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(INSTRUMENT_LABELS) as InstrumentFilter[]).map((k) => (
                <SelectItem key={k} value={k} className="text-xs">{INSTRUMENT_LABELS[k]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sortMode} onValueChange={(v) => setSortMode(v as SortMode)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Orden" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default" className="text-xs">Orden de agregado</SelectItem>
              <SelectItem value="changeDesc" className="text-xs">Mayor % del día ↓</SelectItem>
              <SelectItem value="changeAsc" className="text-xs">Menor % del día ↑</SelectItem>
              <SelectItem value="category" className="text-xs">Por categoría ETF</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Separator />
        <div className="flex-1 overflow-y-auto min-h-0">
          {symbols?.length === 0 && (
            <p className="text-xs text-muted-foreground p-4 text-center">
              Agrega simbolos a tu watchlist con el boton +
            </p>
          )}
          {symbols && symbols.length > 0 && filteredSymbols.length === 0 && (
            <p className="text-xs text-muted-foreground p-4 text-center">
              Sin resultados para los filtros aplicados
            </p>
          )}
          {sortMode === 'category' && groupedSymbols
            ? groupedSymbols.map((group, idx) => (
                <div key={group.key}>
                  {idx > 0 && <Separator />}
                  <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-4 pt-3 pb-1">
                    {group.label}
                  </h3>
                  {group.items.map(renderRow)}
                </div>
              ))
            : sortedSymbols.map(renderRow)}
        </div>
        <AddSymbolDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      </aside>
    </>
  );
}
