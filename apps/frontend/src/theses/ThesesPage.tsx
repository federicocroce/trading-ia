import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@trading/backend/trpc';
import { trpc } from '@/shared/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TabInfo, InfoSection } from '@/shared/TabInfo';

type ThesisRow = inferRouterOutputs<AppRouter>['theses']['list'][number];

const DIRECTION_STYLE: Record<string, string> = {
  alcista: 'bg-green-500/20 text-green-400',
  bajista: 'bg-red-500/20 text-red-400',
};

const STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  activa: { label: 'Activa', cls: 'bg-blue-500/20 text-blue-400' },
  gatillada: { label: 'Gatillada', cls: 'bg-amber-500/20 text-amber-400' },
  cumplida: { label: 'Cumplida', cls: 'bg-green-500/20 text-green-400' },
  invalidada: { label: 'Invalidada', cls: 'bg-red-500/20 text-red-400' },
  expirada: { label: 'Expirada', cls: 'bg-zinc-500/20 text-zinc-400' },
};

const TERMINAL_STATUSES = new Set(['cumplida', 'invalidada', 'expirada']);

const fmtPct = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`);
const fmtPrice = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 2 });

function GenerateButton() {
  const utils = trpc.useUtils();
  const generate = trpc.theses.generate.useMutation({
    onSuccess: () => utils.theses.list.invalidate(),
  });
  return (
    <Button size="sm" variant="secondary" onClick={() => generate.mutate()} disabled={generate.isPending}>
      {generate.isPending ? 'Generando…' : 'Generar tesis ahora'}
    </Button>
  );
}

function EvaluateButton() {
  const utils = trpc.useUtils();
  const evaluate = trpc.theses.evaluate.useMutation({
    onSuccess: () => utils.theses.list.invalidate(),
  });
  return (
    <Button size="sm" variant="outline" onClick={() => evaluate.mutate()} disabled={evaluate.isPending}>
      {evaluate.isPending ? 'Evaluando…' : 'Re-evaluar'}
    </Button>
  );
}

function ThesisCard({ t }: { t: ThesisRow }) {
  const statusInfo = STATUS_STYLE[t.status] ?? { label: t.status, cls: 'bg-zinc-500/20 text-zinc-400' };
  const isTerminal = TERMINAL_STATUSES.has(t.status);
  let symbols: string[] = [];
  try {
    const parsed: unknown = JSON.parse(t.symbols);
    if (Array.isArray(parsed)) symbols = parsed as string[];
  } catch {
    symbols = [];
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <span>{t.title}</span>
          <Badge className={DIRECTION_STYLE[t.direction] ?? 'bg-zinc-500/20 text-zinc-400'}>
            {t.direction === 'alcista' ? 'Alcista' : t.direction === 'bajista' ? 'Bajista' : t.direction}
          </Badge>
          <Badge className={statusInfo.cls}>{statusInfo.label}</Badge>
          <span className="text-xs font-normal text-muted-foreground">
            {t.primarySymbol}{symbols.length > 1 ? ` (+ ${symbols.filter(s => s !== t.primarySymbol).join(', ')})` : ''}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>{t.narrative}</p>
        {t.catalyst && (
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Catalizador:</span> {t.catalyst}
          </p>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1 pr-3">Entrada</th>
                <th className="py-1 pr-3">Invalidación</th>
                <th className="py-1 pr-3">Horizonte</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-border/40">
                <td className="py-1.5 pr-3">
                  {t.entryComparator === 'above' ? '≥' : '≤'} {fmtPrice(t.entryTriggerPrice)}
                  <div className="text-muted-foreground">{t.entryConditionText}</div>
                </td>
                <td className="py-1.5 pr-3">
                  {fmtPrice(t.invalidationPrice)}
                  <div className="text-muted-foreground">{t.invalidationReason}</div>
                </td>
                <td className="py-1.5 pr-3">{t.horizonDays} días</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
          <span>Creada: {t.createdDate}</span>
          {t.triggeredAt && <span>Gatillada: {t.triggeredAt}</span>}
          {t.resolvedAt && <span>Resuelta: {t.resolvedAt}</span>}
        </div>

        {isTerminal && (
          <div className="rounded-md bg-muted/20 border border-border/40 p-2 text-xs">
            <span className="font-medium">Outcome:</span>{' '}
            {t.outcomeReturnPct === null
              ? 'no calculable (sin históricos)'
              : `${fmtPct(t.outcomeReturnPct)}${t.outcomeVsSpyPct !== null ? ` (vs SPY: ${fmtPct(t.outcomeVsSpyPct)})` : ' (sin vs-benchmark)'}`}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TrackRecordFooter({ theses }: { theses: ThesisRow[] }) {
  const terminal = theses.filter(t => TERMINAL_STATUSES.has(t.status));
  if (terminal.length === 0) {
    return (
      <Card>
        <CardContent className="p-3 text-xs text-muted-foreground">
          Sin tesis resueltas todavía — el track record aparece acá.
        </CardContent>
      </Card>
    );
  }

  const cumplidas = terminal.filter(t => t.status === 'cumplida').length;
  const pctCumplidas = (cumplidas / terminal.length) * 100;
  // Excluir tesis expirada del retorno medio: una tesis expirada jamás gatilló, por lo que su
  // retorno "no se operó" — contarla sería humo. El conteo de "resueltas" incluye expiradas
  // (para cerrar el ciclo de la tesis), pero el retorno medio solo sobre cumplidas e invalidadas.
  const operadas = terminal.filter(t => t.status !== 'expirada');
  const returns = operadas.map(t => t.outcomeReturnPct).filter((v): v is number => v !== null);
  const vsSpy = operadas.map(t => t.outcomeVsSpyPct).filter((v): v is number => v !== null);
  const avgReturn = returns.length > 0 ? returns.reduce((s, v) => s + v, 0) / returns.length : null;
  const avgVsSpy = vsSpy.length > 0 ? vsSpy.reduce((s, v) => s + v, 0) / vsSpy.length : null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Track record</CardTitle>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground space-y-1">
        <p>{terminal.length} tesis resueltas · {pctCumplidas.toFixed(0)}% cumplidas ({cumplidas}/{terminal.length})</p>
        <p>
          Retorno medio: {avgReturn === null ? '—' : fmtPct(avgReturn)}
          {avgVsSpy !== null && <> · vs SPY: {fmtPct(avgVsSpy)}</>}
        </p>
      </CardContent>
    </Card>
  );
}

export function ThesesPage() {
  const { data, isLoading } = trpc.theses.list.useQuery();

  return (
    <>
      <TabInfo>
        <InfoSection title="Qué es">
          Una tesis es una hipótesis de mediano plazo (5 a 120 días) generada por LLM a partir del radar de
          ciclos, eventos macro recientes y el top del scan técnico: una dirección, un catalizador, una
          condición de entrada verificable y un nivel que la invalida. El motor la genera una vez por semana
          y la re-evalúa todos los días contra precio vivo.
        </InfoSection>
        <InfoSection title="Caveat">
          Opinión generada por LLM sobre los insumos del sistema. Medida como todo lo demás — track record
          visible. NO es una orden.
        </InfoSection>
      </TabInfo>
      <div className="p-4 space-y-4">
        <div className="flex items-center gap-2">
          <GenerateButton />
          <EvaluateButton />
        </div>

        {isLoading && <div className="text-sm text-muted-foreground">Cargando tesis…</div>}

        {!isLoading && (!data || data.length === 0) && (
          <Card>
            <CardContent className="p-4 text-sm text-muted-foreground">
              Sin tesis todavía — generá la primera con el botón.
            </CardContent>
          </Card>
        )}

        {data && data.length > 0 && (
          <div className="space-y-3">
            {data.map(t => <ThesisCard key={t.id} t={t} />)}
          </div>
        )}

        {data && <TrackRecordFooter theses={data} />}
      </div>
    </>
  );
}
