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
                    <th className="font-medium py-1 text-right">Comprar y no tocar</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  <Row label="Retorno medio" a={pct(a.avgReturnSellOnWarning)} b={pct(a.avgReturnLetItRun)}
                    c={a.avgReturnBuyHold != null ? pct(a.avgReturnBuyHold) : 's/d'}
                    bWins={a.avgReturnLetItRun >= a.avgReturnSellOnWarning} />
                  <Row label="Drawdown medio (menos = mejor)" a={pct(a.avgMaxDdSellOnWarning)} b={pct(a.avgMaxDdLetItRun)}
                    c={a.avgMaxDdBuyHold != null ? pct(a.avgMaxDdBuyHold) : 's/d'}
                    bWins={a.avgMaxDdLetItRun <= a.avgMaxDdSellOnWarning} />
                  <Row label="Profit factor (más = mejor)" a={String(a.avgProfitFactorSellOnWarning)} b={String(a.avgProfitFactorLetItRun)} c="—"
                    bWins={a.avgProfitFactorLetItRun >= a.avgProfitFactorSellOnWarning} />
                </tbody>
              </table>
              <p className="text-[11px] text-foreground mt-2">
                Contra el motor, "Hoy" ganó en <span className="font-semibold">{a.letItRunWinsReturn} de {a.evaluated}</span>.
                {' '}Pero la pregunta que decide es contra <span className="text-foreground">comprar y no tocar</span>:{' '}
                {a.evaluatedBuyHold === 0 ? (
                  <span className="text-amber-400">no se pudo calcular en ningún símbolo.</span>
                ) : (
                  <span className={a.letItRunBeatsBuyHold * 2 >= a.evaluatedBuyHold ? 'font-semibold text-green-400' : 'font-semibold text-red-400'}>
                    le gana en {a.letItRunBeatsBuyHold} de {a.evaluatedBuyHold}.
                  </span>
                )}
              </p>
              <p className="text-[10px] text-muted-foreground mt-1">
                Ganarle a la otra regla no alcanza: si el trailing rinde menos que comprar el papel y no mirarlo, operar destruye
                valor aunque gane el duelo. Esta columna faltaba hasta el 2026-07-29 (AD-014).
              </p>
            </CardContent>
          </Card>

          <Card size="sm">
            <CardContent className="py-3">
              <div className="text-[11px] text-muted-foreground mb-2">Por símbolo (retorno · profit factor)</div>
              <div className="space-y-1">
                {data!.perSymbol.map((s) => (
                  <div key={s.symbol} className="flex items-center gap-2 text-[11px] font-mono">
                    <span className="w-14 font-semibold">{s.symbol}</span>
                    <span className="w-32 text-right text-muted-foreground">motor {pct(s.sellOnWarning.totalReturn)}</span>
                    <span className="w-32 text-right">Hoy {pct(s.letItRun.totalReturn)}</span>
                    <span className="w-36 text-right text-muted-foreground">
                      no tocar {s.buyHold != null ? pct(s.buyHold.totalReturn) : 's/d'}
                    </span>
                    {/* El badge responde la pregunta que importa, no el duelo entre reglas. */}
                    <Badge className={`text-[8px] ${
                      s.letItRunBeatsBuyHold == null ? 'bg-muted text-muted-foreground'
                        : s.letItRunBeatsBuyHold ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                      {s.letItRunBeatsBuyHold == null ? 's/d' : s.letItRunBeatsBuyHold ? 'operar pagó' : 'no tocar ganaba'}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Row({ label, a, b, c, bWins }: { label: string; a: string; b: string; c: string; bWins: boolean }) {
  return (
    <tr>
      <td className="py-1 text-muted-foreground font-sans">{label}</td>
      <td className={`py-1 text-right ${bWins ? 'text-muted-foreground' : 'text-foreground'}`}>{a}</td>
      <td className={`py-1 text-right ${bWins ? 'text-green-400 font-semibold' : 'text-muted-foreground'}`}>{b}</td>
      <td className="py-1 text-right text-foreground">{c}</td>
    </tr>
  );
}
