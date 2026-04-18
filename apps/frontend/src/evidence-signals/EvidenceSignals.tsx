import { useState } from 'react';
import { trpc } from '@/shared/trpc';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { EvidenceSignal, EvidenceConviction } from '@trading/shared';

type Filter = 'all' | 'high' | 'medium' | 'pead' | 'insider' | 'options';

function ConvictionBadge({ conviction }: { conviction: EvidenceConviction }) {
  const styles: Record<EvidenceConviction, string> = {
    high: 'bg-green-500/20 text-green-400 border-green-500/30',
    medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    low: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    none: 'bg-muted text-muted-foreground',
  };
  const labels: Record<EvidenceConviction, string> = {
    high: 'ALTA', medium: 'MEDIA', low: 'BAJA', none: 'SIN SEÑAL',
  };
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${styles[conviction]}`}>
      {labels[conviction]}
    </span>
  );
}

function SignalPill({ label, active, score }: { label: string; active: boolean; score: number }) {
  if (!active) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
      {label}
      <span className="opacity-70">{score}</span>
    </span>
  );
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1,
  }).format(value);
}

function SignalCard({ signal }: { signal: EvidenceSignal }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card
      className={`cursor-pointer transition-colors hover:border-primary/30 ${
        signal.conviction === 'high' ? 'border-green-500/30' :
        signal.conviction === 'medium' ? 'border-yellow-500/30' : ''
      }`}
      onClick={() => setExpanded(!expanded)}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-bold text-base">{signal.symbol}</span>
              {signal.currentPrice != null && (
                <span className="text-sm text-muted-foreground">${signal.currentPrice.toFixed(2)}</span>
              )}
              <ConvictionBadge conviction={signal.conviction} />
            </div>

            <div className="flex flex-wrap gap-1 mb-2">
              <SignalPill label="PEAD" active={signal.pead.active} score={signal.pead.score} />
              <SignalPill label="INSIDER" active={signal.insider.active} score={signal.insider.score} />
              <SignalPill label="OPTIONS" active={signal.optionsFlow.active} score={signal.optionsFlow.score} />
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">{signal.reasoning}</p>
          </div>

          <div className="text-right shrink-0">
            <div className="text-2xl font-bold text-primary">{signal.compositeScore}</div>
            <div className="text-[10px] text-muted-foreground">score</div>
          </div>
        </div>

        {expanded && (
          <div className="mt-4 space-y-3 border-t border-border pt-3">
            {signal.pead.active && (
              <div className="space-y-0.5">
                <div className="text-xs font-semibold text-primary">PEAD — Post-Earnings Drift</div>
                <div className="text-xs text-muted-foreground">
                  Bate estimados por <span className="text-foreground font-medium">{signal.pead.beatPercent.toFixed(1)}%</span>
                  {' '}| EPS actual: <span className="text-foreground">{signal.pead.epsActual ?? '—'}</span>
                  {' '}vs estimado: <span className="text-foreground">{signal.pead.epsEstimate ?? '—'}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {signal.pead.daysSinceEarnings}d desde earnings
                  {' '}· {signal.pead.daysInDriftWindow}d restantes en ventana de drift (60d total)
                </div>
              </div>
            )}

            {signal.insider.active && (
              <div className="space-y-0.5">
                <div className="text-xs font-semibold text-primary">INSIDER — Compras de directivos</div>
                <div className="text-xs text-muted-foreground">
                  <span className="text-foreground font-medium">{signal.insider.numberOfBuyers}</span> insider(s)
                  {' '}compraron <span className="text-foreground font-medium">{formatCurrency(signal.insider.totalValue)}</span>
                  {' '}· última compra: {signal.insider.mostRecentBuyDate}
                </div>
                {signal.insider.recentBuys.slice(0, 3).map((b, i) => (
                  <div key={i} className="text-[10px] text-muted-foreground pl-2 border-l border-border">
                    {b.filerName} ({b.relation}) — {formatCurrency(b.valueUsd)} el {b.date}
                  </div>
                ))}
              </div>
            )}

            {signal.optionsFlow.active && (
              <div className="space-y-0.5">
                <div className="text-xs font-semibold text-primary">OPTIONS — Flujo inusual</div>
                <div className="text-xs text-muted-foreground">
                  Call/Put ratio: <span className="text-foreground font-medium">{signal.optionsFlow.callPutRatio}x</span>
                  {' '}· {signal.optionsFlow.callVolume.toLocaleString()} calls vs {signal.optionsFlow.putVolume.toLocaleString()} puts
                </div>
                <div className="text-xs text-muted-foreground">
                  Vencimiento más cercano: {signal.optionsFlow.nearestExpiry}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function EvidenceSignals() {
  const [filter, setFilter] = useState<Filter>('all');
  const { data, isLoading, refetch, isFetching } = trpc.evidenceSignals.getAll.useQuery(undefined, {
    staleTime: 5 * 60_000,
  });
  const refreshMutation = trpc.evidenceSignals.refresh.useMutation({
    onSuccess: () => refetch(),
  });

  const filtered = (data?.signals ?? []).filter((s) => {
    if (filter === 'high') return s.conviction === 'high';
    if (filter === 'medium') return s.conviction === 'medium' || s.conviction === 'high';
    if (filter === 'pead') return s.pead.active;
    if (filter === 'insider') return s.insider.active;
    if (filter === 'options') return s.optionsFlow.active;
    return s.activeSignals > 0;
  });

  const filters: { id: Filter; label: string }[] = [
    { id: 'all', label: 'Con señales' },
    { id: 'high', label: 'Alta convicción' },
    { id: 'medium', label: 'Media+' },
    { id: 'pead', label: 'PEAD' },
    { id: 'insider', label: 'Insider' },
    { id: 'options', label: 'Options' },
  ];

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">Señales V2 — Evidence-Based</h2>
          <p className="text-xs text-muted-foreground">
            PEAD · Insider Buying · Options Flow — solo señales con evidencia académica
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => refreshMutation.mutate()}
          disabled={refreshMutation.isPending || isFetching}
        >
          {refreshMutation.isPending || isFetching ? 'Escaneando...' : 'Actualizar'}
        </Button>
      </div>

      {data && (
        <div className="grid grid-cols-3 gap-3">
          <Card>
            <CardContent className="p-3 text-center">
              <div className="text-2xl font-bold text-green-400">{data.highConviction}</div>
              <div className="text-xs text-muted-foreground">Alta convicción</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <div className="text-2xl font-bold text-yellow-400">{data.mediumConviction}</div>
              <div className="text-xs text-muted-foreground">Media convicción</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <div className="text-2xl font-bold">{data.totalSymbols}</div>
              <div className="text-xs text-muted-foreground">Símbolos escaneados</div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {filters.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`text-xs px-3 py-1 rounded-full border transition-colors ${
              filter === f.id
                ? 'bg-primary text-primary-foreground border-primary'
                : 'border-border text-muted-foreground hover:border-primary/50'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          Escaneando señales... puede tardar 1-2 minutos la primera vez.
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          Sin señales activas con el filtro seleccionado.
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((signal) => (
            <SignalCard key={signal.symbol} signal={signal} />
          ))}
        </div>
      )}

      {data && (
        <p className="text-[10px] text-muted-foreground text-center">
          Última actualización: {new Date(data.scannedAt).toLocaleString('es-AR')} · Cache 6h
        </p>
      )}
    </div>
  );
}
