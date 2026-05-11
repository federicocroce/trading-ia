import { useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus } from 'lucide-react';
import { trpc } from '@/shared/trpc';
import { ETFCard } from './ETFCard';
import { AddETFModal } from './AddETFModal';

const CATEGORY_LABELS: Record<string, string> = {
  indices: 'Índices',
  sectores: 'Sectores',
  bonos: 'Bonos',
  commodities: 'Commodities',
  latam: 'Latam',
  internacional: 'Internacional',
  crypto: 'Crypto',
  factor: 'Factor',
};

type ActionFilter = 'all' | 'BUY' | 'SELL' | 'HOLD' | 'WATCH' | 'unanalyzed';

const ACTION_LABELS: Record<ActionFilter, string> = {
  all: 'Todas las señales',
  BUY: 'BUY',
  SELL: 'SELL',
  HOLD: 'HOLD',
  WATCH: 'WATCH',
  unanalyzed: 'Sin analizar',
};

export function ETFWatchlistPage() {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [actionFilter, setActionFilter] = useState<ActionFilter>('all');
  const [showAddModal, setShowAddModal] = useState(false);

  const { data: etfs = [], refetch, isLoading } = trpc.etf.getEnrichedWatchlist.useQuery(undefined, {
    refetchInterval: 5 * 60_000,
  });
  const removeMutation = trpc.etf.removeFromWatchlist.useMutation({ onSuccess: () => refetch() });

  const categories = useMemo(() => [...new Set(etfs.map((e) => e.category))].sort(), [etfs]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return etfs.filter((e) => {
      const matchesSearch = !q
        || e.symbol.toLowerCase().includes(q)
        || e.name.toLowerCase().includes(q)
        || (e.description ?? '').toLowerCase().includes(q);
      const matchesCategory = !categoryFilter || e.category === categoryFilter;
      const matchesAction =
        actionFilter === 'all' ||
        (actionFilter === 'unanalyzed' ? e.action == null : e.action === actionFilter);
      return matchesSearch && matchesCategory && matchesAction;
    });
  }, [etfs, search, categoryFilter, actionFilter]);

  // Stats: how many analyzed, BUY/SELL counts
  const stats = useMemo(() => {
    const analyzed = etfs.filter(e => e.action != null);
    return {
      total: etfs.length,
      analyzed: analyzed.length,
      buy: analyzed.filter(e => e.action === 'BUY').length,
      sell: analyzed.filter(e => e.action === 'SELL').length,
      hold: analyzed.filter(e => e.action === 'HOLD').length,
      watch: analyzed.filter(e => e.action === 'WATCH').length,
    };
  }, [etfs]);

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Top: stats banner */}
      {!isLoading && etfs.length > 0 && (
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          <span>{stats.total} ETFs</span>
          <span>·</span>
          <span>{stats.analyzed} analizados</span>
          {stats.buy > 0 && <><span>·</span><span className="text-trading-green">BUY: {stats.buy}</span></>}
          {stats.sell > 0 && <><span>·</span><span className="text-trading-red">SELL: {stats.sell}</span></>}
          {stats.hold > 0 && <><span>·</span><span className="text-yellow-400">HOLD: {stats.hold}</span></>}
          {stats.watch > 0 && <><span>·</span><span className="text-blue-400">WATCH: {stats.watch}</span></>}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <Input
          placeholder="Buscar por símbolo o nombre..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Button size="sm" onClick={() => setShowAddModal(true)}>
          <Plus className="h-4 w-4 mr-1" />
          Agregar ETF
        </Button>
      </div>

      {/* Action filter chips */}
      <div className="flex gap-2 flex-wrap">
        {(Object.keys(ACTION_LABELS) as ActionFilter[]).map((a) => (
          <Badge
            key={a}
            variant="outline"
            className={`cursor-pointer text-xs transition-all ${actionFilter === a ? 'bg-blue-500/30 text-blue-300' : 'hover:bg-blue-500/10'}`}
            onClick={() => setActionFilter(a)}
          >
            {ACTION_LABELS[a]}
          </Badge>
        ))}
      </div>

      {/* Category filter chips */}
      <div className="flex gap-2 flex-wrap">
        <Badge
          variant="outline"
          className={`cursor-pointer text-xs transition-all ${!categoryFilter ? 'bg-blue-500/30 text-blue-300' : 'hover:bg-blue-500/10'}`}
          onClick={() => setCategoryFilter(null)}
        >
          Todas las categorías ({etfs.length})
        </Badge>
        {categories.map((cat) => {
          const count = etfs.filter((e) => e.category === cat).length;
          return (
            <Badge
              key={cat}
              variant="outline"
              className={`cursor-pointer text-xs transition-all ${categoryFilter === cat ? 'bg-blue-500/30 text-blue-300' : 'hover:bg-blue-500/10'}`}
              onClick={() => setCategoryFilter(categoryFilter === cat ? null : cat)}
            >
              {CATEGORY_LABELS[cat] ?? cat} ({count})
            </Badge>
          );
        })}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {filtered.map((etf) => (
          <ETFCard
            key={etf.symbol}
            etf={etf}
            onRemove={(symbol) => removeMutation.mutate({ symbol })}
          />
        ))}
      </div>

      {filtered.length === 0 && !isLoading && (
        <p className="text-muted-foreground text-sm text-center py-8">
          No hay ETFs que coincidan con los filtros.
        </p>
      )}

      <AddETFModal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        onAdded={() => refetch()}
      />
    </div>
  );
}
