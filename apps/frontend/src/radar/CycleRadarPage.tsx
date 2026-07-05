import { trpc } from '@/shared/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

// Orden y estilo por fase: girando (lo que busca el radar) primero.
const FASES: Array<{ key: string; titulo: string; badge: string; descripcion: string }> = [
  { key: 'girando', titulo: 'Girando', badge: 'bg-emerald-600', descripcion: 'Cruce alcista reciente de SMA200 con fuerza relativa positiva — gestación confirmándose' },
  { key: 'odiado', titulo: 'Odiado', badge: 'bg-sky-700', descripcion: 'Abajo de la SMA200 hace ≥120 sesiones con RS 6m negativa — candidato a vigilar, no a comprar' },
  { key: 'tendencia', titulo: 'Tendencia', badge: 'bg-teal-600', descripcion: 'Arriba de la SMA200 hace >60 sesiones con RS no negativa' },
  { key: 'neutro', titulo: 'Neutro', badge: 'bg-zinc-500', descripcion: 'Sin fase definida' },
  { key: 'extendido', titulo: 'Extendido', badge: 'bg-amber-600', descripcion: '>20% sobre la SMA200 — tarde para gestación' },
];

const fmt = (v: number | null, suffix = '%') => (v === null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}${suffix}`);

const rsColor = (v: number | null) =>
  v === null ? 'text-muted-foreground' : v > 0 ? 'text-emerald-600' : v < 0 ? 'text-red-500' : 'text-muted-foreground';

export function CycleRadarPage() {
  const { data, isLoading } = trpc.radar.getLatest.useQuery(undefined, { refetchInterval: 5 * 60 * 1000 });

  if (isLoading) return <div className="p-4 text-sm text-muted-foreground">Cargando radar…</div>;
  if (!data || !data.date) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground">
          Sin snapshots del radar todavía — se genera con el pipeline diario (o corrida manual).
        </CardContent>
      </Card>
    );
  }

  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
  const porFase = new Map<string, typeof data.snapshots>();
  for (const s of data.snapshots) {
    const key = s.cycleState ?? 'sin-datos';
    if (!porFase.has(key)) porFase.set(key, []);
    porFase.get(key)!.push(s);
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-3 text-xs text-muted-foreground">
          <span className="font-semibold">Contexto de ciclos — NO es señal de entrada.</span>{' '}
          Los setups los decide el scan de siempre. Snapshot: {data.date}
          {data.date < hoy && <span className="text-amber-600"> (dato de un día anterior)</span>}
          {' · '}Flujos: {data.historyDays >= 21 ? 'activos' : `acumulando historia (${data.historyDays}/21 días)`}
        </CardContent>
      </Card>

      {FASES.map(fase => {
        const filas = porFase.get(fase.key) ?? [];
        if (filas.length === 0) return null;
        return (
          <Card key={fase.key}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Badge className={fase.badge}>{fase.titulo}</Badge>
                <span className="text-xs font-normal text-muted-foreground">{fase.descripcion}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="py-1 pr-3">Canasta</th>
                    <th className="py-1 pr-3">Tipo</th>
                    <th className="py-1 pr-3 text-right">RS 3m</th>
                    <th className="py-1 pr-3 text-right">RS 6m</th>
                    <th className="py-1 pr-3 text-right">vs SMA200</th>
                    <th className="py-1 pr-3 text-right">Flujo 20d</th>
                    <th className="py-1 text-right">Sesiones en lado</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map(s => (
                    <tr key={s.symbol} className="border-t border-border/40">
                      <td className="py-1.5 pr-3 font-medium">{s.label} <span className="text-xs text-muted-foreground">{s.symbol}</span></td>
                      <td className="py-1.5 pr-3 text-xs">{s.categoria === 'pais' ? 'País' : 'Sector'}</td>
                      <td className={`py-1.5 pr-3 text-right ${rsColor(s.rs3m)}`}>{fmt(s.rs3m, ' pp')}</td>
                      <td className={`py-1.5 pr-3 text-right ${rsColor(s.rs6m)}`}>{fmt(s.rs6m, ' pp')}</td>
                      <td className="py-1.5 pr-3 text-right">{fmt(s.distSma200Pct)}</td>
                      <td className="py-1.5 pr-3 text-right">
                        {s.sharesOutstanding === null ? '—' : s.flowDelta20d === null ? 'acumulando' : fmt(s.flowDelta20d)}
                      </td>
                      <td className="py-1.5 text-right">{s.sesionesEnLado ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        );
      })}

      {((porFase.get('sin-datos') ?? []).length > 0 || data.missing.length > 0) && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Sin datos suficientes</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {(porFase.get('sin-datos') ?? []).map(s => (
              <div key={s.symbol}>{s.label} ({s.symbol}): {s.stateReason ?? 'sin razón registrada'}</div>
            ))}
            {data.missing.map(b => (
              <div key={b.symbol}>{b.label} ({b.symbol}): sin snapshot hoy (fetch fallido)</div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
