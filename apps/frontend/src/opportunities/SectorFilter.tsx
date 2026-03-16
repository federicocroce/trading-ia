import { Badge } from '@/components/ui/badge';

type OpportunitySector = 'argentina-energy' | 'argentina-finance' | 'us-energy' | 'us-tech' | 'crypto';

const SECTORS: Array<{ key: OpportunitySector; label: string }> = [
  { key: 'argentina-energy', label: 'Energia ARG' },
  { key: 'argentina-finance', label: 'Finanzas ARG' },
  { key: 'us-energy', label: 'Energia US' },
  { key: 'us-tech', label: 'Tech US' },
  { key: 'crypto', label: 'Crypto' },
];

interface SectorFilterProps {
  selected: OpportunitySector[];
  onChange: (sectors: OpportunitySector[]) => void;
}

export function SectorFilter({ selected, onChange }: SectorFilterProps) {
  const allSelected = selected.length === 0 || selected.length === SECTORS.length;

  function toggleAll() {
    onChange([]);
  }

  function toggleSector(sector: OpportunitySector) {
    if (allSelected) {
      // From "all" to just this one
      onChange([sector]);
      return;
    }

    if (selected.includes(sector)) {
      const next = selected.filter((s) => s !== sector);
      if (next.length === 0) {
        onChange([]); // back to all
      } else {
        onChange(next);
      }
    } else {
      const next = [...selected, sector];
      if (next.length === SECTORS.length) {
        onChange([]); // all selected = reset
      } else {
        onChange(next);
      }
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge
        variant={allSelected ? 'default' : 'outline'}
        className="cursor-pointer text-[10px]"
        onClick={toggleAll}
      >
        Todos
      </Badge>
      {SECTORS.map((s) => (
        <Badge
          key={s.key}
          variant={!allSelected && selected.includes(s.key) ? 'default' : 'outline'}
          className="cursor-pointer text-[10px]"
          onClick={() => toggleSector(s.key)}
        >
          {s.label}
        </Badge>
      ))}
    </div>
  );
}
