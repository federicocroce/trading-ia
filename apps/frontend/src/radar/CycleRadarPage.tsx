import { trpc } from '@/shared/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { printWithTitle } from '@/shared/printWithTitle';
import { usePrintSection } from '@/shared/usePrintSection';

// Orden y estilo por fase: "despertándose" (lo que busca el radar) primero.
// Los nombres son deliberadamente coloquiales: la tab la lee una persona, no un quant.
const FASES: Array<{ key: string; titulo: string; badge: string; descripcion: string }> = [
  {
    key: 'girando',
    titulo: '🌅 Despertándose',
    badge: 'bg-emerald-600',
    descripcion: 'Acaba de arrancar después de estar caído y le empieza a ganar al mercado. Esta es la fase que el radar busca.',
  },
  {
    key: 'odiado',
    titulo: '🥶 Planchado',
    badge: 'bg-sky-700',
    descripcion: 'Lleva 6+ meses caído y olvidado. No se compra: se vigila — de acá suelen salir los próximos despertares.',
  },
  {
    key: 'tendencia',
    titulo: '🚶 En marcha',
    badge: 'bg-teal-600',
    descripcion: 'Viene subiendo hace rato sin perderle al mercado. Sano, pero ya no es temprano.',
  },
  {
    key: 'neutro',
    titulo: '😴 Sin novedades',
    badge: 'bg-zinc-500',
    descripcion: 'Ni despertándose ni planchado. La mayoría vive acá — y está bien que así sea.',
  },
  {
    key: 'extendido',
    titulo: '🚀 Ya corrió',
    badge: 'bg-amber-600',
    descripcion: 'Está 20%+ arriba de su promedio del año: el tramo fácil ya pasó. Si tenés algo de acá, no es para agrandar.',
  },
];

const fmt = (v: number | null, suffix = '%') => (v === null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}${suffix}`);

const rsColor = (v: number | null) =>
  v === null ? 'text-muted-foreground' : v > 0 ? 'text-emerald-600' : v < 0 ? 'text-red-500' : 'text-muted-foreground';

// Resumen en criollo: 2-4 frases deterministas armadas desde las fases del día. Sin LLM.
function resumenEnCriollo(porFase: Map<string, Array<{ label: string }>>): string[] {
  const nombres = (k: string) => (porFase.get(k) ?? []).map(s => s.label).join(', ');
  const frases: string[] = [];
  if ((porFase.get('girando') ?? []).length > 0) {
    frases.push(`🌅 Se está despertando: ${nombres('girando')}. Acá vale la pena buscar tickers para la watchlist — si hay entrada la decide el scan de siempre.`);
  } else {
    frases.push('Hoy nadie se está despertando: no hay ciclo nuevo asomando. Eso también es información — no hay que inventar nada.');
  }
  if ((porFase.get('odiado') ?? []).length > 0) {
    frases.push(`🥶 Planchados y olvidados: ${nombres('odiado')}. No se compran — se vigilan: de acá suelen salir los próximos despertares.`);
  }
  if ((porFase.get('extendido') ?? []).length > 0) {
    frases.push(`🚀 Ya corrieron de más: ${nombres('extendido')}. Tarde para entrar tranquilo.`);
  }
  if ((porFase.get('tendencia') ?? []).length > 0) {
    frases.push(`🚶 En marcha sana: ${nombres('tendencia')}.`);
  }
  return frases;
}

export function CycleRadarPage() {
  usePrintSection('cycle-radar-print');
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
  const frases = resumenEnCriollo(porFase);

  return (
    <div id="cycle-radar-print" className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-base">
            <span>En criollo, hoy:</span>
            <button
              onClick={() => printWithTitle('radar', data.date)}
              title="Imprimir / Guardar como PDF"
              className="h-7 px-2 rounded border border-border/50 text-[10px] font-normal text-muted-foreground hover:text-foreground hover:border-border transition-colors flex items-center gap-1"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              PDF
            </button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5 text-sm">
          {frases.map((f, i) => (
            <p key={i}>{f}</p>
          ))}
          <details className="pt-2 text-xs text-muted-foreground">
            <summary className="cursor-pointer font-medium">¿Cómo leo esta tab? (30 segundos)</summary>
            <div className="mt-2 space-y-1.5">
              <p>Este radar responde UNA pregunta: <span className="font-medium">¿en qué país o sector se está por gestar un ciclo grande?</span> — medido con precio y plata real, no con opiniones.</p>
              <p>1. ¿Apareció algo en <span className="font-medium">🌅 Despertándose</span>? → ese mercado merece research y tickers a la watchlist. Nada más: la entrada la decide el scan de siempre.</p>
              <p>2. ¿Algo de <span className="font-medium">🥶 Planchado</span> viene mejorando su "vs S&P" mes a mes? → candidato a despertarse; seguilo.</p>
              <p>3. ¿Lo que tenés en cartera está en <span className="font-medium">🚀 Ya corrió</span>? → no es venta, es recordatorio de no agrandar.</p>
              <p>Las columnas: <span className="font-medium">vs S&P</span> = cuántos puntos le ganó (verde) o perdió (rojo) al S&P 500 en 3 y 6 meses — es LA columna. <span className="font-medium">vs su promedio anual</span> = qué tan lejos está de su media de 200 días (cerca de 0 = en la frontera; muy arriba = caro). <span className="font-medium">¿Entra plata?</span> = si el ETF crece o se achica (plata institucional entrando/saliendo; necesita ~1 mes de historia para activarse). <span className="font-medium">Ruedas así</span> = hace cuántas ruedas está de este lado de su promedio (pocas = giro fresco).</p>
            </div>
          </details>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-3 text-xs text-muted-foreground">
          <span className="font-semibold">Contexto de ciclos — NO es señal de entrada.</span>{' '}
          Los setups los decide el scan de siempre. Snapshot: {data.date}
          {data.date < hoy && <span className="text-amber-600"> (dato de un día anterior)</span>}
          {' · '}Plata entrando/saliendo: {data.historyDays >= 21 ? 'midiendo' : `le falta historia (${data.historyDays}/21 días)`}
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
                    <th className="py-1 pr-3">Mercado</th>
                    <th className="py-1 pr-3">Tipo</th>
                    <th className="py-1 pr-3 text-right">vs S&P (3m)</th>
                    <th className="py-1 pr-3 text-right">vs S&P (6m)</th>
                    <th className="py-1 pr-3 text-right">vs su promedio anual</th>
                    <th className="py-1 pr-3 text-right">¿Entra plata?</th>
                    <th className="py-1 text-right">Ruedas así</th>
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
                        {s.sharesOutstanding === null ? '—' : s.flowDelta20d === null ? 'midiendo…' : fmt(s.flowDelta20d)}
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
              <div key={b.symbol}>{b.label} ({b.symbol}): sin snapshot del día (símbolo nuevo o fetch fallido)</div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
