import { useState } from 'react';
import { trpc } from '@/shared/trpc';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { EvidenceSignal, EvidenceConviction, EvidenceDeepAnalysis } from '@trading/shared';

type Filter = 'all' | 'high' | 'medium' | 'pead' | 'insider' | 'options' | 'buy' | 'actionable';

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

function VerdictBadge({ verdict }: { verdict: EvidenceDeepAnalysis['verdict'] }) {
  const styles: Record<EvidenceDeepAnalysis['verdict'], string> = {
    BUY_SETUP: 'bg-green-500/20 text-green-400 border-green-500/30',
    WAIT:      'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    PASS:      'bg-red-500/20 text-red-400 border-red-500/30',
  };
  const labels: Record<EvidenceDeepAnalysis['verdict'], string> = {
    BUY_SETUP: '🟢 BUY SETUP',
    WAIT:      '🟡 ESPERAR',
    PASS:      '🔴 PASAR',
  };
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${styles[verdict]}`}>
      {labels[verdict]}
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

function SignalCard({
  signal,
  analysis,
  isAnalyzing,
  aScore,
}: {
  signal: EvidenceSignal;
  analysis: EvidenceDeepAnalysis | null;
  isAnalyzing: boolean;
  aScore: number;
}) {
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
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="font-bold text-base">{signal.symbol}</span>
              {signal.currentPrice != null && (
                <span className="text-sm text-muted-foreground">${signal.currentPrice.toFixed(2)}</span>
              )}
              <ConvictionBadge conviction={signal.regimeAdjustedConviction ?? signal.conviction} />
              {signal.regimeAdjustedConviction && signal.regimeAdjustedConviction !== signal.conviction && (
                <span className="text-[10px] text-red-400 font-medium">⬇ mkt</span>
              )}
              {analysis && <VerdictBadge verdict={analysis.verdict} />}
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
            <div className="text-[10px] text-muted-foreground">score señal</div>
            {analysis && (
              <div className="text-[10px] text-muted-foreground mt-0.5">{analysis.confidence}% conf. AI</div>
            )}
            {(() => {
              const color = aScore >= 8 ? 'text-green-400' : aScore >= 5 ? 'text-yellow-400' : 'text-muted-foreground';
              return (
                <div className={`text-[10px] font-semibold mt-1 ${color}`}>{aScore}/10 accionable</div>
              );
            })()}
          </div>
        </div>

        {expanded && (
          <div className="mt-4 space-y-3 border-t border-border pt-3">
            {signal.pead.active && (
              <div className="space-y-0.5">
                <div className="text-xs font-semibold text-primary">PEAD — Post-Earnings Drift</div>
                <div className="text-xs text-muted-foreground">
                  Beat <span className="text-foreground font-medium">{signal.pead.beatPercent.toFixed(1)}%</span>
                  {signal.pead.epsActual != null && (
                    <>{' '}· EPS actual: <span className="text-foreground">{signal.pead.epsActual}</span>
                    {' '}vs est.: <span className="text-foreground">{signal.pead.epsEstimate ?? '—'}</span></>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {signal.pead.daysSinceEarnings}d desde earnings · {signal.pead.daysInDriftWindow}d restantes en ventana
                  {signal.pead.consecutiveBeats > 1 && (
                    <span className="ml-2 text-amber-400 font-medium">🔥 {signal.pead.consecutiveBeats} beats consecutivos</span>
                  )}
                </div>
                {signal.pead.priceChangePct != null && (
                  <div className={`text-xs font-medium ${signal.pead.priceChangePct >= 1.5 ? 'text-green-400' : 'text-red-400'}`}>
                    Precio post-earnings: {signal.pead.priceChangePct >= 0 ? '+' : ''}{signal.pead.priceChangePct.toFixed(1)}%
                    {' '}({signal.pead.priceConfirmed ? '✓ confirmado' : '✗ no confirmó drift'})
                  </div>
                )}
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
                <div className="text-xs font-semibold text-primary">OPTIONS — Flujo inusual OTM</div>
                <div className="text-xs text-muted-foreground">
                  <span className="text-foreground font-medium">{signal.optionsFlow.unusualStrikes}</span> strikes OTM con V/OI inusual
                  {' '}· C/P ratio: <span className="text-foreground font-medium">{signal.optionsFlow.callPutRatio}x</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {signal.optionsFlow.callVolume.toLocaleString()} calls OTM inusuales · vence: {signal.optionsFlow.nearestExpiry}
                </div>
              </div>
            )}

            {/* Deep AI Analysis */}
            <div className="border-t border-border pt-3 space-y-2">
              <div className="text-xs font-semibold text-primary">Análisis AI</div>
              {analysis ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <VerdictBadge verdict={analysis.verdict} />
                    <span className="text-[10px] text-muted-foreground">
                      confianza {analysis.confidence}% · {analysis.timeframe}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">{analysis.reasoning}</p>
                  {analysis.verdict === 'BUY_SETUP' && analysis.entryZone !== 'N/A' && (
                    <div className="grid grid-cols-3 gap-2 text-[10px]">
                      <div className="bg-green-500/10 rounded p-1.5 text-center">
                        <div className="text-muted-foreground">Entrada</div>
                        <div className="font-medium text-green-400">{analysis.entryZone}</div>
                      </div>
                      <div className="bg-primary/10 rounded p-1.5 text-center">
                        <div className="text-muted-foreground">Target</div>
                        <div className="font-medium text-primary">{analysis.target}</div>
                      </div>
                      <div className="bg-red-500/10 rounded p-1.5 text-center">
                        <div className="text-muted-foreground">Stop</div>
                        <div className="font-medium text-red-400">{analysis.stopLoss}</div>
                      </div>
                    </div>
                  )}
                  {analysis.keyRisks.length > 0 && (
                    <div className="space-y-0.5">
                      <div className="text-[10px] text-muted-foreground font-medium">Riesgos:</div>
                      {analysis.keyRisks.map((r, i) => (
                        <div key={i} className="text-[10px] text-muted-foreground pl-2 border-l border-border">
                          {r}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="text-[10px] text-muted-foreground">
                    R/R: {analysis.riskReward} · {analysis.model}
                  </div>
                </div>
              ) : isAnalyzing ? (
                <div className="text-[10px] text-muted-foreground animate-pulse">
                  Analizando con AI...
                </div>
              ) : (
                <div className="text-[10px] text-muted-foreground">
                  Sin análisis — ejecutá un nuevo scan
                </div>
              )}
            </div>
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

  const { data, refetch, error } = trpc.evidenceSignals.getAll.useQuery(undefined, {
    staleTime: 30_000,
    refetchInterval: 10_000,
  });

  const { data: status } = trpc.evidenceSignals.scanStatus.useQuery(undefined, {
    refetchInterval: 3_000,
  });

  const { data: analyses } = trpc.evidenceSignals.getAllDeepAnalyses.useQuery(undefined, {
    staleTime: 30_000,
    refetchInterval: 15_000,
  });

  const { data: accuracyStats, refetch: refetchStats } = trpc.evidenceSignals.getAccuracyStats.useQuery(undefined, {
    staleTime: 60_000,
  });

  const resolveMutation = trpc.evidenceSignals.resolveSignals.useMutation({
    onSuccess: () => refetchStats(),
  });

  const analysisMap = new Map(
    (analyses ?? []).map((a) => [a.symbol, a])
  );

  const isScanning = status?.state === 'scanning';
  const isAnalyzing = status?.analysisState === 'analyzing';

  const refreshMutation = trpc.evidenceSignals.refresh.useMutation({
    onSuccess: () => refetch(),
  });

  // Composite actionable score 0-10: regime + sector + conviction + AI verdict
  // Used to sort signals from most to least actionable for a 3-6m hold
  function actionableScore(s: EvidenceSignal): number {
    const regime = data?.marketRegime?.regime ?? 'neutral';
    const analysis = analysisMap.get(s.symbol);
    let score = 0;
    // Market regime (0-3)
    if (regime === 'bull') score += 3;
    else if (regime === 'neutral') score += 1;
    // regime bear = 0 (no bonus)
    // Regime-adjusted conviction (0-3)
    if (s.regimeAdjustedConviction === 'high') score += 3;
    else if (s.regimeAdjustedConviction === 'medium') score += 2;
    else if (s.regimeAdjustedConviction === 'low') score += 1;
    // AI verdict (0-2)
    if (analysis?.verdict === 'BUY_SETUP') score += 2;
    else if (analysis?.verdict === 'WAIT') score += 1;
    // Consecutive beats bonus (0-1)
    if (s.pead.active && s.pead.consecutiveBeats >= 2) score += 1;
    // Insider recent buy bonus (0-1)
    if (s.insider.active && s.insider.numberOfBuyers >= 2) score += 1;
    return score;
  }

  const filtered = (data?.signals ?? [])
    .filter((s) => {
      if (filter === 'high') return s.conviction === 'high';
      if (filter === 'medium') return s.conviction === 'medium' || s.conviction === 'high';
      if (filter === 'pead') return s.pead.active;
      if (filter === 'insider') return s.insider.active;
      if (filter === 'options') return s.optionsFlow.active;
      if (filter === 'buy') return analysisMap.get(s.symbol)?.verdict === 'BUY_SETUP';
    if (filter === 'actionable') return actionableScore(s) >= 7;
      return s.activeSignals > 0;
    })
    .sort((a, b) => actionableScore(b) - actionableScore(a));

  const filters: { id: Filter; label: string }[] = [
    { id: 'all', label: 'Con señales' },
    { id: 'high', label: 'Alta convicción' },
    { id: 'medium', label: 'Media+' },
    { id: 'pead', label: 'PEAD' },
    { id: 'insider', label: 'Insider' },
    { id: 'options', label: 'Options' },
    { id: 'buy', label: '🟢 BUY Setup' },
    { id: 'actionable', label: '⭐ Accionable (7+/10)' },
  ];

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">Señales V2 — Evidence-Based</h2>
          <p className="text-xs text-muted-foreground">
            PEAD · Insider Buying · Options Flow · Análisis AI
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

      {/* Analysis progress bar */}
      {isAnalyzing && status && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Analizando señales con AI (Gemini)...</span>
            <span>{status.analyzedCount}/{status.analysisTotal}</span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 transition-all duration-500 rounded-full"
              style={{
                width: status.analysisTotal > 0
                  ? `${(status.analyzedCount / status.analysisTotal) * 100}%`
                  : '0%',
              }}
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

      {/* Market Regime Banner */}
      {data?.marketRegime && (
        <div className={`rounded-lg border px-4 py-2 flex items-center gap-3 text-sm font-medium ${
          data.marketRegime.regime === 'bull'
            ? 'border-green-500/40 bg-green-500/10 text-green-400'
            : data.marketRegime.regime === 'bear'
            ? 'border-red-500/40 bg-red-500/10 text-red-400'
            : 'border-yellow-500/40 bg-yellow-500/10 text-yellow-400'
        }`}>
          <span className="text-lg">
            {data.marketRegime.regime === 'bull' ? '📈' : data.marketRegime.regime === 'bear' ? '📉' : '⚠️'}
          </span>
          <span>
            Régimen de mercado:{' '}
            <strong>{data.marketRegime.regime === 'bull' ? 'ALCISTA' : data.marketRegime.regime === 'bear' ? 'BAJISTA' : 'NEUTRAL'}</strong>
            {' '}— SPY ${data.marketRegime.spyPrice.toFixed(0)} / SMA200 ${data.marketRegime.sma200.toFixed(0)}
            {' '}({data.marketRegime.priceVsSma200Pct > 0 ? '+' : ''}{data.marketRegime.priceVsSma200Pct.toFixed(1)}%)
          </span>
          {data.marketRegime.regime === 'bear' && (
            <span className="ml-auto text-xs opacity-80">⚠️ ALTO RIESGO: señales LONG en mercado bajista</span>
          )}
        </div>
      )}

      {/* Accuracy Stats */}
      {accuracyStats && (
        <div className="rounded-lg border border-border bg-muted/30 px-4 py-2 flex items-center gap-4 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Historial:</span>
          {accuracyStats.totalTracked === 0 ? (
            <span>Sin señales rastreadas aún — ejecuta un scan para empezar a medir</span>
          ) : (
            <>
              <span>{accuracyStats.totalTracked} rastreadas</span>
              {accuracyStats.resolved > 0 ? (
                <>
                  <span className={accuracyStats.winRate != null && accuracyStats.winRate >= 50 ? 'text-green-400 font-semibold' : 'text-red-400 font-semibold'}>
                    {accuracyStats.winRate}% win rate
                  </span>
                  <span>({accuracyStats.wins}G / {accuracyStats.losses}P)</span>
                  {accuracyStats.avgReturn30d != null && (
                    <span className={accuracyStats.avgReturn30d >= 0 ? 'text-green-400' : 'text-red-400'}>
                      Avg 30d: {accuracyStats.avgReturn30d > 0 ? '+' : ''}{accuracyStats.avgReturn30d}%
                    </span>
                  )}
                </>
              ) : (
                <span className="text-yellow-500">
                  {accuracyStats.pending} pendiente{accuracyStats.pending !== 1 ? 's' : ''} — esperando 30 días para resolver
                </span>
              )}
              {accuracyStats.pending > 0 && accuracyStats.resolved > 0 && (
                <span>{accuracyStats.pending} pendientes</span>
              )}
            </>
          )}
          <button
            className="ml-auto text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 disabled:opacity-50"
            onClick={() => resolveMutation.mutate()}
            disabled={resolveMutation.isPending}
          >
            {resolveMutation.isPending ? 'Resolviendo...' : 'Resolver ahora'}
          </button>
        </div>
      )}

      {/* Top Picks — highest actionable score + BUY_SETUP */}
      {(() => {
        const topPicks = (data?.signals ?? [])
          .filter((s) => analysisMap.get(s.symbol)?.verdict === 'BUY_SETUP')
          .sort((a, b) => actionableScore(b) - actionableScore(a))
          .slice(0, 3);
        if (topPicks.length === 0) return null;
        return (
          <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-4 space-y-3">
            <div className="text-xs font-semibold text-green-400 uppercase tracking-wide">
              ⭐ Top Picks — BUY SETUP más accionables ahora
            </div>
            <div className="grid gap-2">
              {topPicks.map((signal) => {
                const analysis = analysisMap.get(signal.symbol)!;
                const as = actionableScore(signal);
                return (
                  <div key={signal.symbol} className="flex items-center gap-3 bg-background/60 rounded-md px-3 py-2">
                    <div className="font-bold text-sm w-16 shrink-0">{signal.symbol}</div>
                    {signal.currentPrice && (
                      <div className="text-xs text-muted-foreground w-16 shrink-0">${signal.currentPrice.toFixed(2)}</div>
                    )}
                    <div className="flex gap-2 flex-1 min-w-0 text-xs flex-wrap">
                      {analysis.entryZone !== 'N/A' && (
                        <span className="text-muted-foreground">Entrada: <span className="text-foreground font-medium">{analysis.entryZone}</span></span>
                      )}
                      {analysis.target !== 'N/A' && (
                        <span className="text-muted-foreground">Target: <span className="text-green-400 font-medium">{analysis.target}</span></span>
                      )}
                      {analysis.stopLoss !== 'N/A' && (
                        <span className="text-muted-foreground">Stop: <span className="text-red-400 font-medium">{analysis.stopLoss}</span></span>
                      )}
                      {analysis.riskReward !== 'N/A' && (
                        <span className="text-muted-foreground">R/R: <span className="text-yellow-400 font-medium">{analysis.riskReward}</span></span>
                      )}
                    </div>
                    <div className={`text-xs font-bold shrink-0 ${as >= 8 ? 'text-green-400' : 'text-yellow-400'}`}>{as}/10</div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Stats */}
      {data && data.totalSymbols > 0 && (
        <div className="grid grid-cols-4 gap-3">
          <Card>
            <CardContent className="p-3 text-center">
              <div className="text-2xl font-bold text-green-400">{data.highConviction}</div>
              <div className="text-xs text-muted-foreground">Alta conv.</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <div className="text-2xl font-bold text-yellow-400">{data.mediumConviction}</div>
              <div className="text-xs text-muted-foreground">Media conv.</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <div className="text-2xl font-bold text-primary">
                {analyses?.filter((a) => a.verdict === 'BUY_SETUP').length ?? 0}
              </div>
              <div className="text-xs text-muted-foreground">BUY Setup</div>
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
          <p className="text-xs text-muted-foreground">Tarda ~1-2 min. El análisis AI corre automáticamente después.</p>
        </div>
      )}

      {/* No results after scan */}
      {!error && !isScanning && data && data.totalSymbols > 0 && filtered.length === 0 && (
        <div className="text-center py-8 space-y-1">
          <p className="text-muted-foreground text-sm">Sin señales con este filtro.</p>
          <p className="text-xs text-muted-foreground">
            {data.totalSymbols} símbolos escaneados · ninguno activó señales con los umbrales actuales.
          </p>
        </div>
      )}

      {/* Results */}
      {filtered.length > 0 && (
        <div className="space-y-3">
          {filtered.map((signal) => (
            <SignalCard
              key={signal.symbol}
              signal={signal}
              analysis={analysisMap.get(signal.symbol) ?? null}
              isAnalyzing={isAnalyzing}
              aScore={actionableScore(signal)}
            />
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
