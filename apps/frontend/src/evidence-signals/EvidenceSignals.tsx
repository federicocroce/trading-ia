import { useState, useEffect } from 'react';
import { trpc } from '@/shared/trpc';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
                  Beat <span className="text-foreground font-medium">{signal.pead.beatPercent.toFixed(1)}%</span>
                  {' '}· EPS actual: <span className="text-foreground">{signal.pead.epsActual ?? '—'}</span>
                  {' '}vs est.: <span className="text-foreground">{signal.pead.epsEstimate ?? '—'}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {signal.pead.daysSinceEarnings}d desde earnings · {signal.pead.daysInDriftWindow}d restantes en ventana de drift
                </div>
              </div>
            )}
            {signal.insider.active && (
              <div className="space-y-0.5">
                <div className="text-xs font-semibold text-primary">INSIDER — Compras de directivos</div>
                <div className="text-xs text-muted-foreground">
                  <span className="text-foreground font-medium">{signal.insider.numberOfBuyers}</span> insider(s)
                  {' '}compraron <span className="text-foreground font-medium">{formatCurrency(signal.insider.totalValue)}</span>
                  {' '}· última: {signal.insider.mostRecentBuyDate}
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
                  C/P ratio: <span className="text-foreground font-medium">{signal.optionsFlow.callPutRatio}x</span>
                  {' '}· {signal.optionsFlow.callVolume.toLocaleString()} calls vs {signal.optionsFlow.putVolume.toLocaleString()} puts
                </div>
                <div className="text-xs text-muted-foreground">Vencimiento: {signal.optionsFlow.nearestExpiry}</div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TrackedSignals() {
  const { data } = trpc.evidenceSignals.getTracked.useQuery({ limit: 30 });
  if (!data?.length) return null;

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-muted-foreground">Paper Trading ({data.length})</h3>
      <div className="space-y-1">
        {data.map((s) => {
          const outcome = s.outcome ?? 'pending';
          const ret30 = s.returnAfter30d;
          const outcomeColor = outcome === 'win' ? 'text-green-400' : outcome === 'loss' ? 'text-red-400' : 'text-muted-foreground';
          return (
            <div key={s.id} className="flex items-center justify-between text-xs px-3 py-2 bg-muted/30 rounded">
              <div className="flex items-center gap-3">
                <span className="font-bold">{s.symbol}</span>
                <span className="text-muted-foreground">entrada ${s.entryPrice.toFixed(2)}</span>
                <span className="text-muted-foreground">{s.signalDate}</span>
              </div>
              <div className="flex items-center gap-3">
                {ret30 != null && (
                  <span className={ret30 >= 0 ? 'text-green-400' : 'text-red-400'}>
                    {ret30 >= 0 ? '+' : ''}{ret30.toFixed(1)}% (30d)
                  </span>
                )}
                <span className={`font-medium capitalize ${outcomeColor}`}>{outcome}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function EvidenceSignals() {
  const [filter, setFilter] = useState<Filter>('all');

  // getAll reads from cache — instant response
  const { data, refetch, error } = trpc.evidenceSignals.getAll.useQuery(undefined, {
    staleTime: 30_000,
    refetchInterval: 10_000, // poll every 10s while scan runs
  });

  // Scan status — polls to show progress
  const { data: status } = trpc.evidenceSignals.scanStatus.useQuery(undefined, {
    refetchInterval: 3_000,
  });

  const isScanning = status?.state === 'scanning';

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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">Señales V2 — Evidence-Based</h2>
          <p className="text-xs text-muted-foreground">
            PEAD · Insider Buying · Options Flow
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => refreshMutation.mutate()}
          disabled={refreshMutation.isPending || isScanning}
        >
          {isScanning ? 'Escaneando...' : 'Escanear'}
        </Button>
      </div>

      {/* Scan progress bar */}
      {isScanning && status && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Escaneando símbolos en Yahoo Finance...</span>
            <span>{status.scannedCount}/{status.totalCount}</span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-500 rounded-full"
              style={{ width: status.totalCount > 0 ? `${(status.scannedCount / status.totalCount) * 100}%` : '0%' }}
            />
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="text-center py-6 space-y-2">
          <p className="text-red-400 text-sm font-medium">Error al conectar con el backend</p>
          <p className="text-xs text-muted-foreground">{(error as any)?.message}</p>
        </div>
      )}

      {/* Stats */}
      {data && data.totalSymbols > 0 && (
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
              <div className="text-xs text-muted-foreground">Escaneados</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      {data && data.totalSymbols > 0 && (
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
      )}

      {/* Empty / no scan yet */}
      {!error && !isScanning && data?.totalSymbols === 0 && (
        <div className="text-center py-16 space-y-3">
          <p className="text-muted-foreground text-sm">Nunca se corrió un scan todavía.</p>
          <Button onClick={() => refreshMutation.mutate()} disabled={refreshMutation.isPending}>
            Iniciar primer scan
          </Button>
          <p className="text-xs text-muted-foreground">Tarda ~1-2 min. Podés seguir el progreso en el log del backend.</p>
        </div>
      )}

      {/* No results after scan */}
      {!error && !isScanning && data && data.totalSymbols > 0 && filtered.length === 0 && (
        <div className="text-center py-8 space-y-1">
          <p className="text-muted-foreground text-sm">Sin señales con este filtro.</p>
          <p className="text-xs text-muted-foreground">
            {data.totalSymbols} símbolos escaneados · ninguno activó señales PEAD/Insider/Options con los umbrales actuales.
          </p>
        </div>
      )}

      {/* Results */}
      {filtered.length > 0 && (
        <div className="space-y-3">
          {filtered.map((signal) => (
            <SignalCard key={signal.symbol} signal={signal} />
          ))}
        </div>
      )}

      {/* Footer */}
      {data && data.totalSymbols > 0 && (
        <p className="text-[10px] text-muted-foreground text-center">
          Última actualización: {new Date(data.scannedAt).toLocaleString('es-AR')} · Cache 6h
        </p>
      )}

      <TrackedSignals />
    </div>
  );
}
