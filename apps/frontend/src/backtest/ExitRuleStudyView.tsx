import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { trpc } from '@/shared/trpc';

const pct = (n: number) => `${n >= 0 ? '+' : ''}${n}%`;

export function ExitRuleStudyView() {
  const [scope, setScope] = useState<'portfolio' | 'universe'>('portfolio');
  const run = trpc.quant.exitRuleBacktest.useMutation();
  const data = run.data;
  const a = data?.aggregate;

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Validación: ¿vender en la advertencia o dejar correr?</h3>
        <p className="text-[11px] text-muted-foreground mt-1">
          Backtest enfrentado, mismos datos: <span className="text-foreground">"vender en divergencia"</span> (lo que sugiere el motor)
          vs <span className="text-foreground">"dejar correr con trailing stop"</span> (lo que decide "Hoy"). Misma entrada y mismo stop;
          la única diferencia es si la divergencia te saca. Point-in-time, con costos. Los números deciden, no la opinión.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <select value={scope} onChange={(e) => setScope(e.target.value as 'portfolio' | 'universe')}
          className="h-8 rounded-md border border-border bg-card px-2 text-xs">
          <option value="portfolio">Tu cartera + benchmarks (rápido)</option>
          <option value="universe">Universo completo (lento, ~minutos)</option>
        </select>
        <Button size="sm" disabled={run.isPending} onClick={() => run.mutate({ scope, years: 7 })}>
          {run.isPending ? 'Corriendo… (tarda)' : 'Correr validación'}
        </Button>
      </div>

      {run.isPending && <p className="text-xs text-muted-foreground">Calculando sobre años de historia… puede tardar 30-60s.</p>}
      {run.error && <p className="text-xs text-red-400">Error: {run.error.message}</p>}

      {a && (
        <>
          <Card size="sm">
            <CardContent className="py-3">
              <div className="text-[11px] text-muted-foreground mb-2">Agregado — {a.evaluated} símbolos, {data!.params.years} años</div>
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-muted-foreground text-left">
                    <th className="font-medium py-1"></th>
                    <th className="font-medium py-1 text-right">Vender en divergencia</th>
                    <th className="font-medium py-1 text-right">Dejar correr (Hoy)</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  <Row label="Retorno medio" a={pct(a.avgReturnSellOnWarning)} b={pct(a.avgReturnLetItRun)} bWins={a.avgReturnLetItRun >= a.avgReturnSellOnWarning} />
                  <Row label="Drawdown medio (menos = mejor)" a={pct(a.avgMaxDdSellOnWarning)} b={pct(a.avgMaxDdLetItRun)} bWins={a.avgMaxDdLetItRun <= a.avgMaxDdSellOnWarning} />
                  <Row label="Profit factor (más = mejor)" a={String(a.avgProfitFactorSellOnWarning)} b={String(a.avgProfitFactorLetItRun)} bWins={a.avgProfitFactorLetItRun >= a.avgProfitFactorSellOnWarning} />
                </tbody>
              </table>
              <p className="text-[11px] text-foreground mt-2">
                "Hoy" (dejar correr) ganó en retorno en <span className="font-semibold text-green-400">{a.letItRunWinsReturn} de {a.evaluated}</span> símbolos.
                {a.letItRunWinsReturn < a.evaluated && <span className="text-muted-foreground"> No es universal: en algunos, vender en la divergencia capturó más.</span>}
              </p>
            </CardContent>
          </Card>

          <Card size="sm">
            <CardContent className="py-3">
              <div className="text-[11px] text-muted-foreground mb-2">Por símbolo (retorno · profit factor)</div>
              <div className="space-y-1">
                {data!.perSymbol.map((s) => {
                  const hoyWins = s.letItRun.totalReturn >= s.sellOnWarning.totalReturn;
                  return (
                    <div key={s.symbol} className="flex items-center gap-2 text-[11px] font-mono">
                      <span className="w-14 font-semibold">{s.symbol}</span>
                      <span className="w-40 text-right text-muted-foreground">motor {pct(s.sellOnWarning.totalReturn)} · PF {s.sellOnWarning.profitFactor}</span>
                      <span className="w-40 text-right">Hoy {pct(s.letItRun.totalReturn)} · PF {s.letItRun.profitFactor}</span>
                      <Badge className={`text-[8px] ${hoyWins ? 'bg-green-500/20 text-green-400' : 'bg-amber-500/20 text-amber-400'}`}>
                        {hoyWins ? 'Hoy' : 'motor'}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Row({ label, a, b, bWins }: { label: string; a: string; b: string; bWins: boolean }) {
  return (
    <tr>
      <td className="py-1 text-muted-foreground font-sans">{label}</td>
      <td className={`py-1 text-right ${bWins ? 'text-muted-foreground' : 'text-foreground'}`}>{a}</td>
      <td className={`py-1 text-right ${bWins ? 'text-green-400 font-semibold' : 'text-muted-foreground'}`}>{b}</td>
    </tr>
  );
}
