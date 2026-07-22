import { useState } from 'react';
import { trpc } from '@/shared/trpc';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const LAYER_LABELS: Record<string, string> = {
  nucleo: 'Núcleo',
  cobertura: 'Cobertura',
  riesgo: 'Riesgo',
};

function usd(value: number): string {
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 0 })}`;
}

/** Color binario: rojo si el backend reportó violación para esta capa, verde en otro caso.
 *  La violación debe contener el nombre de la capa. Si algún día hay estados intermedios,
 *  vendrán en el payload, no inventados en el frontend. */
function layerBarColor(layer: { layer: string; pct: number; targetPct: number }, violations: string[]): string {
  const hasViolation = violations.some((v) => v.toLowerCase().includes(layer.layer.toLowerCase()));
  return hasViolation ? 'bg-trading-red/70' : 'bg-trading-green/60';
}

export function AllocationPlanPanel() {
  const [inputValue, setInputValue] = useState('0');
  const [newCashUsd, setNewCashUsd] = useState(0);

  const { data, isLoading } = trpc.portfolio.allocationPlan.useQuery({ newCashUsd });

  const calcular = () => {
    const parsed = Number(inputValue);
    setNewCashUsd(Number.isFinite(parsed) && parsed >= 0 ? parsed : 0);
  };

  if (isLoading) {
    return <div className="p-6 text-muted-foreground text-sm">Calculando plan de asignación...</div>;
  }
  if (!data) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
          Cartera por capas — plan de aportes
        </span>
        <p className="text-[10px] text-muted-foreground/80 mt-0.5">
          Núcleo (índices amplios), cobertura (oro/renta fija corta) y riesgo (todo lo demás) vs. sus targets. El aporte nuevo se reparte para acercar las capas defensivas a su target — el riesgo nunca recibe plata fresca.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {!data.ok ? (
          <p className="text-xs text-trading-red">⚠️ {data.reason}</p>
        ) : (
          <>
            {/* Barras de capas: % actual vs target */}
            <div className="space-y-1.5">
              {data.layers.map((l) => (
                <div key={l.layer} className="flex items-center gap-2 text-xs">
                  <span className="w-20 shrink-0 font-mono uppercase">{LAYER_LABELS[l.layer] ?? l.layer}</span>
                  <div className="flex-1 h-2 bg-muted/40 rounded overflow-hidden relative">
                    <div
                      className={`h-full ${layerBarColor(l, data.violations)}`}
                      style={{ width: `${Math.min(100, Math.max(0, l.pct))}%` }}
                    />
                    <div
                      className="absolute top-0 bottom-0 w-0.5 bg-foreground/60"
                      style={{ left: `${Math.min(100, Math.max(0, l.targetPct))}%` }}
                      title={`Target ${l.targetPct.toFixed(0)}%`}
                    />
                  </div>
                  <span className="w-24 text-right tabular-nums">
                    {l.pct.toFixed(1)}% <span className="text-muted-foreground">/ {l.targetPct.toFixed(0)}%</span>
                  </span>
                </div>
              ))}
            </div>

            {/* Violaciones */}
            {data.violations.length > 0 && (
              <div className="space-y-1">
                {data.violations.map((v, i) => (
                  <p key={i} className="text-[11px] text-trading-red">⚠️ {v}</p>
                ))}
              </div>
            )}

            {/* Input de aporte + cálculo del plan */}
            <div className="flex items-center gap-2 border-t border-border/50 pt-3">
              <label htmlFor="allocation-plan-cash" className="text-[11px] text-muted-foreground uppercase tracking-wider shrink-0">
                USD nuevos a invertir
              </label>
              <Input
                id="allocation-plan-cash"
                type="number"
                min={0}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && calcular()}
                className="w-28"
              />
              <Button size="sm" variant="outline" onClick={calcular}>
                Calcular
              </Button>
            </div>

            {/* Tabla de contribuciones sugeridas */}
            {data.contributions.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Capa</TableHead>
                    <TableHead className="text-right">USD</TableHead>
                    <TableHead>Instrumentos</TableHead>
                    <TableHead>Nota</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.contributions.map((c, i) => (
                    <TableRow key={`${c.layer}-${i}`}>
                      <TableCell className="font-mono uppercase text-xs">{LAYER_LABELS[c.layer] ?? c.layer}</TableCell>
                      <TableCell className="text-right tabular-nums">{usd(c.usd)}</TableCell>
                      <TableCell className="text-xs">{c.instruments.length > 0 ? c.instruments.join(', ') : '—'}</TableCell>
                      <TableCell className="text-[11px] text-muted-foreground">{c.nota}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {/* Excedente sin destino */}
            {data.unallocatedUsd > 0 && (
              <p className="text-xs text-muted-foreground">
                Sin asignar (mantener líquido): <span className="tabular-nums">{usd(data.unallocatedUsd)}</span>
              </p>
            )}
          </>
        )}

        <p className="text-[10px] text-muted-foreground/70 border-t border-border/50 pt-2">
          Advisory: el sistema no ejecuta órdenes. El riesgo se llena con setups del scan.
        </p>
      </CardContent>
    </Card>
  );
}
