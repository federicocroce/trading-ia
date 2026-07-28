import { trpc } from '@/shared/trpc';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

/**
 * Detalle del riesgo de concentración. La versión corta vive en Hoy (una tarjeta); acá
 * está el desglose con los números que la sostienen.
 *
 * Mide cuántas apuestas INDEPENDIENTES hay detrás de N posiciones. La cartera real del
 * dueño: 8 posiciones ≈ 1.8 apuestas, 48% de volatilidad anual. Contar filas no es contar
 * riesgo — un stop protege de que UNA se dé vuelta, no de que se den vuelta todas juntas.
 */
export function ConcentrationPanel() {
  const { data, isLoading } = trpc.portfolio.concentration.useQuery(undefined, { staleTime: 600_000 });

  if (isLoading) return <div className="text-xs text-muted-foreground p-4">Midiendo correlaciones…</div>;
  if (!data) {
    return (
      <Card size="sm"><CardContent>
        <p className="text-xs text-muted-foreground py-3">
          Sin datos suficientes para medir concentración (hacen falta posiciones con precio e histórico).
        </p>
      </CardContent></Card>
    );
  }

  const color = data.veredicto === 'concentrada' ? 'red' : data.veredicto === 'moderada' ? 'amber' : 'green';
  const cls = {
    red: { border: 'border-l-red-500', badge: 'bg-red-500/20 text-red-400', bar: 'bg-red-500' },
    amber: { border: 'border-l-amber-500', badge: 'bg-amber-500/20 text-amber-400', bar: 'bg-amber-500' },
    green: { border: 'border-l-trading-green', badge: 'bg-trading-green/20 text-trading-green', bar: 'bg-trading-green' },
  }[color];

  // Escala visual: 5+ apuestas efectivas se considera bien repartido para una cartera chica.
  const pctBarra = Math.min(100, (data.effectiveBets / 5) * 100);

  return (
    <Card className={`border-l-4 ${cls.border}`}>
      <CardHeader>
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
          Riesgo del conjunto — cuántas apuestas tenés de verdad
        </span>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge className={`text-[10px] font-bold ${cls.badge}`}>CARTERA {data.veredicto.toUpperCase()}</Badge>
          <span className="text-lg font-bold font-mono">{data.effectiveBets.toFixed(1)}</span>
          <span className="text-xs text-muted-foreground">
            apuestas independientes, sobre {data.positions} posiciones
          </span>
        </div>

        <div>
          <div className="h-2 w-full rounded bg-muted/30 overflow-hidden">
            <div className={`h-full ${cls.bar}`} style={{ width: `${pctBarra}%` }} />
          </div>
          <div className="flex justify-between text-[9px] text-muted-foreground mt-1">
            <span>1 = una sola apuesta disfrazada</span>
            <span>5+ = bien repartida</span>
          </div>
        </div>

        <p className="text-[11px] text-foreground">{data.mensaje}</p>

        <div className="grid grid-cols-2 gap-3 text-[10px]">
          <Metric label="Volatilidad anual de la cartera" value={`${(data.portfolioVol * 100).toFixed(1)}%`} />
          <Metric label="Si nada correlacionara" value={`${(data.weightedVol * 100).toFixed(1)}%`} />
          <Metric label="Ratio de diversificación" value={data.diversificationRatio.toFixed(2)} hint="1.00 = ninguna" />
          <Metric
            label="Mayor posición"
            value={data.topHolding ? `${data.topHolding.symbol} ${(data.topHolding.weight * 100).toFixed(0)}%` : '—'}
          />
        </div>

        {data.coverage < 0.99 && (
          <p className="text-[10px] text-amber-400">
            ⚠ Medido sobre el {(data.coverage * 100).toFixed(0)}% del capital — el resto no tenía serie de precios
            y se descartó (nunca se rellena con ceros: eso inflaría la diversificación).
          </p>
        )}
        <p className="text-[9px] text-muted-foreground/70">
          Sobre {data.observations} ruedas · símbolos medidos: {data.symbolsUsed.join(', ')}
        </p>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className="text-muted-foreground">{label}</div>
      <div className="font-mono font-semibold text-sm text-foreground">
        {value} {hint && <span className="text-[9px] font-normal text-muted-foreground">{hint}</span>}
      </div>
    </div>
  );
}
