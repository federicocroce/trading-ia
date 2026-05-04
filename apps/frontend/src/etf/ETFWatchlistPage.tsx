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

export function ETFWatchlistPage() {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  const { data: etfs = [], refetch } = trpc.etf.getWatchlist.useQuery();
  const removeMutation = trpc.etf.removeFromWatchlist.useMutation({ onSuccess: () => refetch() });

  const categories = useMemo(() => [...new Set(etfs.map((e) => e.category))].sort(), [etfs]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return etfs.filter((e) => {
      const matchesSearch = !q || e.symbol.toLowerCase().includes(q) || e.name.toLowerCase().includes(q) || (e.description ?? '').toLowerCase().includes(q);
      const matchesCategory = !categoryFilter || e.category === categoryFilter;
      return matchesSearch && matchesCategory;
    });
  }, [etfs, search, categoryFilter]);

  return (
    <div className="flex flex-col gap-4 p-4">
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

      <div className="flex gap-2 flex-wrap">
        <Badge
          variant="outline"
          className={`cursor-pointer text-xs transition-all ${!categoryFilter ? 'bg-blue-500/30 text-blue-300' : 'hover:bg-blue-500/10'}`}
          onClick={() => setCategoryFilter(null)}
        >
          Todos ({etfs.length})
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

      {filtered.length === 0 && (
        <p className="text-muted-foreground text-sm text-center py-8">
          No hay ETFs que coincidan con la búsqueda.
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
