import { useState } from 'react';
import { usePrintSection } from '@/shared/usePrintSection';
import { printWithTitle } from '@/shared/printWithTitle';
import { TabInfo, InfoSection } from '@/shared/TabInfo';
import { trpc } from '@/shared/trpc';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { EvidenceSignal, EvidenceConviction, EvidenceDeepAnalysis } from '@trading/shared';
import { WatchlistButton } from '@/shared/WatchlistButton';

type Filter = 'all' | 'high' | 'medium' | 'pead' | 'insider' | 'options' | 'buy' | 'actionable' | 'portfolio';

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
  forceExpanded = false,
}: {
  signal: EvidenceSignal;
  analysis: EvidenceDeepAnalysis | null;
  isAnalyzing: boolean;
  aScore: number;
  forceExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const isExpanded = expanded || forceExpanded;

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
              <WatchlistButton symbol={signal.symbol} />
            </div>
            <div className="flex flex-wrap gap-1 mb-2">
              <SignalPill label="PEAD" active={signal.pead.active} score={signal.pead.score} />
              <SignalPill label="INSIDER" active={signal.insider.active} score={signal.insider.score} />
              <SignalPill label="OPTIONS" active={signal.optionsFlow.active} score={signal.optionsFlow.score} />
            </div>
            {signal.sectorTrend && (
              <div className={`text-[10px] font-medium mb-1 ${
                signal.sectorTrend.trend === 'outperforming' ? 'text-green-400' :
                signal.sectorTrend.trend === 'underperforming' ? 'text-red-400' : 'text-muted-foreground'
              }`}>
                {signal.sectorTrend.trend === 'outperforming' ? '📈' : signal.sectorTrend.trend === 'underperforming' ? '📉' : '➡️'}{' '}
                {signal.sectorTrend.name} ({signal.sectorTrend.etf}): {signal.sectorTrend.priceVsSma50Pct > 0 ? '+' : ''}{signal.sectorTrend.priceVsSma50Pct.toFixed(1)}% vs SMA50
              </div>
            )}
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

        {isExpanded && (
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

            {/* Tech + Fundamental Snapshot */}
            {(signal.techSnapshot || signal.fundamentalSnapshot) && (
              <div className="border-t border-border pt-3">
                <div className="text-xs font-semibold text-primary mb-2">Técnico &amp; Fundamental</div>
                <div className="grid grid-cols-2 gap-3">
                  {signal.techSnapshot && (
                    <div className="space-y-1">
                      <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Técnico</div>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]">
                        {signal.techSnapshot.rsi14 != null && (
                          <>
                            <span className="text-muted-foreground">RSI14</span>
                            <span className={`font-medium ${signal.techSnapshot.rsi14 > 70 ? 'text-red-400' : signal.techSnapshot.rsi14 < 30 ? 'text-green-400' : 'text-foreground'}`}>
                              {signal.techSnapshot.rsi14}
                            </span>
                          </>
                        )}
                        {signal.techSnapshot.sma20 != null && (
                          <>
                            <span className="text-muted-foreground">SMA20</span>
                            <span className="font-medium text-foreground">{signal.techSnapshot.sma20.toFixed(2)}</span>
                          </>
                        )}
                        {signal.techSnapshot.sma50 != null && (
                          <>
                            <span className="text-muted-foreground">SMA50</span>
                            <span className="font-medium text-foreground">{signal.techSnapshot.sma50.toFixed(2)}</span>
                          </>
                        )}
                        {signal.techSnapshot.momentum5d != null && (
                          <>
                            <span className="text-muted-foreground">Mom5d</span>
                            <span className={`font-medium ${signal.techSnapshot.momentum5d > 0 ? 'text-green-400' : 'text-red-400'}`}>
                              {signal.techSnapshot.momentum5d > 0 ? '+' : ''}{signal.techSnapshot.momentum5d.toFixed(1)}%
                            </span>
                          </>
                        )}
                        <span className="text-muted-foreground">Tend.</span>
                        <span className={`font-medium ${signal.techSnapshot.trend === 'bullish' ? 'text-green-400' : signal.techSnapshot.trend === 'bearish' ? 'text-red-400' : 'text-yellow-400'}`}>
                          {signal.techSnapshot.trend === 'bullish' ? '▲ alcista' : signal.techSnapshot.trend === 'bearish' ? '▼ bajista' : '↔ mixto'}
                        </span>
                      </div>
                    </div>
                  )}
                  {signal.fundamentalSnapshot && (
                    <div className="space-y-1">
                      <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Fundamental</div>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]">
                        {signal.fundamentalSnapshot.peRatio != null && (
                          <>
                            <span className="text-muted-foreground">P/E</span>
                            <span className="font-medium text-foreground">{signal.fundamentalSnapshot.peRatio.toFixed(1)}x</span>
                          </>
                        )}
                        {signal.fundamentalSnapshot.forwardPE != null && (
                          <>
                            <span className="text-muted-foreground">Fwd P/E</span>
                            <span className="font-medium text-foreground">{signal.fundamentalSnapshot.forwardPE.toFixed(1)}x</span>
                          </>
                        )}
                        {signal.fundamentalSnapshot.revenueGrowth != null && (
                          <>
                            <span className="text-muted-foreground">Rev. YoY</span>
                            <span className={`font-medium ${signal.fundamentalSnapshot.revenueGrowth > 10 ? 'text-green-400' : signal.fundamentalSnapshot.revenueGrowth < -5 ? 'text-red-400' : 'text-foreground'}`}>
                              {signal.fundamentalSnapshot.revenueGrowth > 0 ? '+' : ''}{signal.fundamentalSnapshot.revenueGrowth.toFixed(1)}%
                            </span>
                          </>
                        )}
                        {signal.fundamentalSnapshot.operatingMargin != null && (
                          <>
                            <span className="text-muted-foreground">Mg. Op.</span>
                            <span className={`font-medium ${signal.fundamentalSnapshot.operatingMargin > 15 ? 'text-green-400' : signal.fundamentalSnapshot.operatingMargin < 0 ? 'text-red-400' : 'text-foreground'}`}>
                              {signal.fundamentalSnapshot.operatingMargin.toFixed(1)}%
                            </span>
                          </>
                        )}
                        {signal.fundamentalSnapshot.debtToEquity != null && (
                          <>
                            <span className="text-muted-foreground">D/E</span>
                            <span className={`font-medium ${signal.fundamentalSnapshot.debtToEquity > 2 ? 'text-red-400' : 'text-foreground'}`}>
                              {signal.fundamentalSnapshot.debtToEquity.toFixed(2)}
                            </span>
                          </>
                        )}
                        {signal.fundamentalSnapshot.beta != null && (
                          <>
                            <span className="text-muted-foreground">Beta</span>
                            <span className="font-medium text-foreground">{signal.fundamentalSnapshot.beta.toFixed(2)}</span>
                          </>
                        )}
                      </div>
                    </div>
                  )}
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
  usePrintSection('evidence-signals-print');
  const today = new Date().toISOString().slice(0, 10);
  const [selectedDate, setSelectedDate] = useState(today);
  const [activeTab, setActiveTab] = useState<'signals' | 'confluencia'>('signals');
  const [filter, setFilter] = useState<Filter>('all');
  const [allExpanded, setAllExpanded] = useState(false);
  const [portfolioSize, setPortfolioSize] = useState<number>(() => {
    const saved = localStorage.getItem('trading_portfolio_size');
    return saved ? Number(saved) : 10000;
  });
  const [mutationError, setMutationError] = useState<string | null>(null);

  const isToday = selectedDate === today;

  const { data: scanDates = [] } = trpc.evidenceSignals.scanDates.useQuery(undefined, { staleTime: 5 * 60_000 });
  const dates = scanDates.includes(today) ? scanDates : [today, ...scanDates];

  const { data: liveData, refetch, error } = trpc.evidenceSignals.getAll.useQuery(undefined, {
    staleTime: 30_000,
    refetchInterval: isToday ? 10_000 : false,
    enabled: isToday,
  });

  const { data: historicalSnapshot } = trpc.evidenceSignals.snapshotByDate.useQuery(
    { date: selectedDate },
    { enabled: !isToday, staleTime: 30 * 60_000 }
  );

  const data = isToday ? liveData : (historicalSnapshot ? {
    signals: historicalSnapshot.signals as EvidenceSignal[],
    marketRegime: historicalSnapshot.marketRegime as { regime: 'bull' | 'bear' | 'neutral'; spyPrice: number; sma200: number; priceVsSma200Pct: number } | null,
    totalSymbols: historicalSnapshot.totalSymbols,
    highConviction: historicalSnapshot.highConviction,
    mediumConviction: historicalSnapshot.mediumConviction,
    scannedAt: historicalSnapshot.scannedAt,
  } : undefined);

  const { data: status } = trpc.evidenceSignals.scanStatus.useQuery(undefined, {
    refetchInterval: isToday ? 3_000 : false,
    enabled: isToday,
  });

  const { data: liveAnalyses } = trpc.evidenceSignals.getAllDeepAnalyses.useQuery(undefined, {
    staleTime: 30_000,
    refetchInterval: isToday ? 15_000 : false,
    enabled: isToday,
  });

  const analyses = isToday ? liveAnalyses : (historicalSnapshot?.analyses ?? []) as EvidenceDeepAnalysis[];

  const { data: accuracyStats, refetch: refetchStats } = trpc.evidenceSignals.getAccuracyStats.useQuery(undefined, {
    staleTime: 60_000,
  });

  const { data: scanHistory } = trpc.evidenceSignals.getScanHistory.useQuery(undefined, {
    staleTime: 30_000,
  });

  const { data: portfolioSymbolsList } = trpc.portfolio.symbols.list.useQuery(undefined, {
    staleTime: 5 * 60_000,
  });
  const portfolioSet = new Set(
    (portfolioSymbolsList ?? [])
      .filter((s) => s.type === 'us' || s.type === 'adr')
      .map((s) => s.symbol)
  );

  const { data: convergence } = trpc.evidenceSignals.getConvergence.useQuery(undefined, {
    staleTime: 60_000,
    refetchInterval: isToday ? 30_000 : false,
    enabled: isToday,
  });

  const resolveMutation = trpc.evidenceSignals.resolveSignals.useMutation({
    onSuccess: () => { refetchStats(); setMutationError(null); },
    onError: (e) => setMutationError(`Error al resolver señales: ${e.message}`),
  });

  const analysisMap = new Map(
    (analyses ?? []).map((a) => [a.symbol, a])
  );

  const isScanning = status?.state === 'scanning';
  const isAnalyzing = status?.analysisState === 'analyzing';

  const refreshMutation = trpc.evidenceSignals.refresh.useMutation({
    onSuccess: () => { refetch(); setMutationError(null); },
    onError: (e) => setMutationError(`Error al iniciar scan: ${e.message}`),
  });

  const newsPipelineMutation = trpc.evidenceSignals.newsPipelineTrigger.useMutation({
    onSuccess: () => setMutationError(null),
    onError: (e) => setMutationError(`Error al iniciar pipeline: ${e.message}`),
  });

  const { data: newsPipelineStatus } = trpc.evidenceSignals.newsPipelineStatus.useQuery(undefined, {
    refetchInterval: isToday ? 2_500 : false,
    enabled: isToday,
  });

  const isNewsPipelineRunning = newsPipelineStatus?.state === 'running';
  const newsPipelineCurrentStage = newsPipelineStatus?.currentStage;

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

  const allSignals = data?.signals ?? [];
  const scannedSymbolSet = new Set(allSignals.map((s) => s.symbol));

  const filtered = (filter === 'portfolio'
    ? allSignals.filter((s) => portfolioSet.has(s.symbol))
    : allSignals.filter((s) => {
        if (filter === 'high') return s.conviction === 'high';
        if (filter === 'medium') return s.conviction === 'medium' || s.conviction === 'high';
        if (filter === 'pead') return s.pead.active;
        if (filter === 'insider') return s.insider.active;
        if (filter === 'options') return s.optionsFlow.active;
        if (filter === 'buy') return analysisMap.get(s.symbol)?.verdict === 'BUY_SETUP';
        if (filter === 'actionable') return actionableScore(s) >= 7;
        return s.activeSignals > 0;
      })
  ).sort((a, b) => actionableScore(b) - actionableScore(a));

  // Portfolio symbols not yet scanned (no cache entry)
  const unscannedPortfolioSymbols = filter === 'portfolio'
    ? [...portfolioSet].filter((sym) => !scannedSymbolSet.has(sym))
    : [];

  const filters: { id: Filter; label: string }[] = [
    { id: 'portfolio', label: `📁 Portfolio (${portfolioSet.size})` },
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
    <div id="evidence-signals-print" className="p-4 space-y-4">
      <TabInfo>
        <InfoSection title="Qué es">Sistema de señales basado en evidencia concreta (no solo opinión LLM). Detecta setups de alta probabilidad antes de que el precio se mueva.</InfoSection>
        <InfoSection title="Tipos de señal">PEAD (Post-Earnings Announcement Drift): la acción tiende a seguir subiendo días/semanas después de resultados positivos sorpresivos · Insider Buying: directivos comprando acciones propias con su propio dinero · Options Flow: flujo inusual de opciones que sugiere que alguien sabe algo.</InfoSection>
        <InfoSection title="Convicción">HIGH: 2+ señales activas convergentes · MEDIUM: 1 señal activa · LOW: señal débil o única · NONE: sin evidencia. La convicción se ajusta por régimen de mercado (bull/bear/neutral).</InfoSection>
        <InfoSection title="Deep Analysis & Score">Cuando convicción ≥ MEDIUM, el LLM hace análisis profundo y emite veredicto: BUY_SETUP / WAIT / PASS. Score accionable 0-10: régimen (0-3) + convicción ajustada (0-3) + veredicto AI (0-2) + señales adicionales (0-2). Score 7+ = Accionable.</InfoSection>
      </TabInfo>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">Señales V2 — Evidence-Based</h2>
          <p className="text-xs text-muted-foreground">
            PEAD · Insider Buying · Options Flow · Análisis AI
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="h-8 rounded border border-border/50 bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {dates.map((d) => (
              <option key={d} value={d}>{d === today ? `${d} (hoy)` : d}</option>
            ))}
          </select>
          {!isToday && (
            <span className="text-[9px] bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded px-1.5 py-0.5">
              Historico
            </span>
          )}
          {isToday && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => refreshMutation.mutate()}
                disabled={refreshMutation.isPending || isScanning || isNewsPipelineRunning}
              >
                {isScanning ? 'Escaneando...' : 'Escanear'}
              </Button>
              <Button
                size="sm"
                variant="default"
                onClick={() => newsPipelineMutation.mutate()}
                disabled={newsPipelineMutation.isPending || isNewsPipelineRunning || isScanning}
              >
                {isNewsPipelineRunning ? 'Analizando...' : '📰 Analizar desde Noticias'}
              </Button>
            </>
          )}
          <button
            onClick={() => setAllExpanded((v) => !v)}
            title={allExpanded ? 'Colapsar todas las cards' : 'Expandir todas las cards'}
            className="h-8 px-2 rounded border border-border/50 text-[10px] text-muted-foreground hover:text-foreground hover:border-border transition-colors"
          >
            {allExpanded ? '▲ Colapsar' : '▼ Expandir'}
          </button>
          <button
            onClick={() => printWithTitle('señales-v2', selectedDate)}
            title="Imprimir / Guardar como PDF"
            className="h-8 px-2 rounded border border-border/50 text-[10px] text-muted-foreground hover:text-foreground hover:border-border transition-colors flex items-center gap-1"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            PDF
          </button>
        </div>
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

      {/* News pipeline progress */}
      {isNewsPipelineRunning && newsPipelineStatus && (
        <div className="rounded-md border border-border/50 bg-muted/30 p-3 space-y-2">
          <p className="text-xs font-medium text-foreground">Pipeline News-First en ejecución...</p>
          {(Object.entries(newsPipelineStatus.stages) as [string, { status: string; detail: string; count?: number; total?: number }][]).map(([name, stage]) => {
            const labels: Record<string, string> = {
              newsRefresh: '1. Noticias',
              sectorAnalysis: '2. Sectores (IA)',
              symbolDiscovery: '3. Símbolos',
              evidenceSignals: '4. Señales',
              deepAnalysis: '5. Análisis IA',
              digest: '6. Digest',
            };
            const icon = stage.status === 'ok' ? '✅' : stage.status === 'failed' ? '❌' : stage.status === 'running' ? '⏳' : stage.status === 'skipped' ? '⏭️' : '○';
            return (
              <div key={name} className="space-y-0.5">
                <div className="flex justify-between text-[11px] text-muted-foreground">
                  <span>{icon} {labels[name] ?? name}{stage.detail ? ` — ${stage.detail}` : ''}</span>
                  {stage.count != null && stage.total != null && <span>{stage.count}/{stage.total}</span>}
                </div>
                {stage.status === 'running' && stage.total != null && stage.count != null && (
                  <div className="h-1 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 transition-all duration-300 rounded-full"
                      style={{ width: stage.total > 0 ? `${(stage.count / stage.total) * 100}%` : '5%' }}
                    />
                  </div>
                )}
                {stage.status === 'running' && (stage.total == null || stage.count == null) && (
                  <div className="h-1 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full animate-pulse" style={{ width: '40%' }} />
                  </div>
                )}
              </div>
            );
          })}
          {newsPipelineStatus.discoveredSymbols.length > 0 && (
            <p className="text-[10px] text-muted-foreground">
              Símbolos descubiertos: {newsPipelineStatus.discoveredSymbols.join(', ')}
            </p>
          )}
        </div>
      )}

      {/* Backend connection error */}
      {error && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-400 flex items-start gap-2">
          <span>⚠️</span>
          <div>
            <span className="font-medium">Error al conectar con el backend</span>
            <span className="text-xs block text-red-400/70">{(error as any)?.message}</span>
          </div>
        </div>
      )}

      {/* Mutation error */}
      {mutationError && (
        <div className="rounded-md border border-orange-500/40 bg-orange-500/10 px-4 py-2 text-sm text-orange-400 flex items-center justify-between">
          <span>⚠️ {mutationError}</span>
          <button className="text-xs underline ml-2" onClick={() => setMutationError(null)}>Cerrar</button>
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
        <>
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
              {/* AI verdict win rate */}
              {accuracyStats.aiStats?.buySetup?.count > 0 && (
                <span className="text-green-400">
                  🤖 BUY_SETUP: {accuracyStats.aiStats.buySetup.winRate}% ({accuracyStats.aiStats.buySetup.count})
                </span>
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
        {/* Component signal breakdown */}
        {accuracyStats && accuracyStats.componentStats?.some((c) => c.count > 0) && (
          <div className="mt-1 flex flex-wrap gap-3 text-[10px] text-muted-foreground px-4 pb-2">
            {accuracyStats.componentStats.filter((c) => c.count > 0).map((c) => (
              <span key={c.signal}>
                <span className="text-foreground font-medium uppercase">{c.signal}</span>:{' '}
                <span className={c.winRate != null && c.winRate >= 50 ? 'text-green-400' : 'text-red-400'}>
                  {c.winRate ?? '—'}%
                </span>{' '}
                ({c.count})
              </span>
            ))}
            {accuracyStats.regimeStats?.filter((r) => r.count > 0).map((r) => (
              <span key={r.regime}>
                <span className={`font-medium ${r.regime === 'bull' ? 'text-green-400' : r.regime === 'bear' ? 'text-red-400' : 'text-yellow-400'}`}>{r.regime}</span>:{' '}
                <span className={r.winRate != null && r.winRate >= 50 ? 'text-green-400' : 'text-red-400'}>
                  {r.winRate ?? '—'}%
                </span>{' '}
                ({r.count})
              </span>
            ))}
          </div>
        )}
        </>
      )}

      {/* Top Picks — highest actionable score + BUY_SETUP */}
      {(() => {
        const topPicks = (data?.signals ?? [])
          .filter((s) => analysisMap.get(s.symbol)?.verdict === 'BUY_SETUP')
          .sort((a, b) => actionableScore(b) - actionableScore(a))
          .slice(0, 3);
        if (topPicks.length === 0) return null;

        // Correlation check: group picks by sector
        const sectorGroups = topPicks.reduce<Record<string, string[]>>((acc, s) => {
          const sec = s.sectorTrend?.name ?? 'Unknown';
          acc[sec] = [...(acc[sec] ?? []), s.symbol];
          return acc;
        }, {});
        const hasSectorConcentration = Object.values(sectorGroups).some((g) => g.length >= 2);

        // Position sizing: risk 2% of portfolio per trade
        const riskPerTrade = portfolioSize * 0.02;

        // Export text for broker/TradingView
        const exportText = topPicks.map((s) => {
          const a = analysisMap.get(s.symbol);
          return `${s.symbol} | Precio: $${s.currentPrice?.toFixed(2) ?? '?'} | Entrada: ${a?.entryZone ?? 'N/A'} | Target: ${a?.target ?? 'N/A'} | Stop: ${a?.stopLoss ?? 'N/A'} | R/R: ${a?.riskReward ?? 'N/A'} | ${a?.timeframe ?? '3-6m'}`;
        }).join('\n');

        return (
          <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-green-400 uppercase tracking-wide">
                ⭐ Top Picks — BUY SETUP más accionables ahora
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span>Portfolio:</span>
                  <span className="text-foreground font-medium">$</span>
                  <input
                    type="number"
                    value={portfolioSize}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (v > 0) { setPortfolioSize(v); localStorage.setItem('trading_portfolio_size', String(v)); }
                    }}
                    className="w-20 bg-background border border-border rounded px-1.5 py-0.5 text-xs text-foreground"
                    min={1000}
                    step={1000}
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
                <button
                  className="text-[10px] text-muted-foreground hover:text-foreground border border-border rounded px-2 py-0.5"
                  onClick={() => { navigator.clipboard.writeText(exportText); }}
                >
                  📋 Copiar picks
                </button>
              </div>
            </div>
            {hasSectorConcentration && (
              <div className="text-[10px] text-yellow-400 border border-yellow-500/30 bg-yellow-500/10 rounded px-2 py-1">
                ⚠️ Concentración sectorial: {Object.entries(sectorGroups).filter(([, g]) => g.length >= 2).map(([sec, syms]) => `${syms.join('+')} en ${sec}`).join(', ')} — considera diversificar
              </div>
            )}
            <div className="grid gap-2">
              {topPicks.map((signal) => {
                const analysis = analysisMap.get(signal.symbol)!;
                const as = actionableScore(signal);
                return (
                  <div key={signal.symbol} className="bg-background/60 rounded-md px-3 py-2 space-y-1.5">
                    <div className="flex items-center gap-3">
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
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[10px] text-muted-foreground">{analysis.timeframe}</span>
                        <div className={`text-xs font-bold ${as >= 8 ? 'text-green-400' : 'text-yellow-400'}`}>{as}/10</div>
                      </div>
                    </div>
                    {analysis.reasoning && (
                      <div className="text-xs text-muted-foreground leading-relaxed border-t border-border/50 pt-1.5">
                        {analysis.reasoning}
                      </div>
                    )}
                    {analysis.keyRisks && analysis.keyRisks.length > 0 && (
                      <div className="text-[10px] text-red-400/80">
                        ⚠️ {analysis.keyRisks.slice(0, 2).join(' · ')}
                      </div>
                    )}
                    {signal.currentPrice && analysis.stopLoss !== 'N/A' && (() => {
                      const stopNum = parseFloat(analysis.stopLoss.replace(/[^0-9.]/g, ''));
                      const stopDist = Math.abs(signal.currentPrice - stopNum);
                      if (stopDist > 0 && stopNum > 0) {
                        const shares = Math.floor(riskPerTrade / stopDist);
                        return (
                          <div className="text-[10px] text-muted-foreground border-t border-border/30 pt-1">
                            Sizing 2%: <span className="text-foreground font-medium">~{shares} acciones</span>
                            {' '}· Riesgo máx: <span className="text-red-400 font-medium">${riskPerTrade.toFixed(0)}</span>
                            {' '}de ${portfolioSize.toLocaleString()}
                          </div>
                        );
                      }
                      return null;
                    })()}
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

      {/* Tab switcher */}
      <div className="flex gap-1 border-b border-border pb-1">
        <button
          onClick={() => setActiveTab('signals')}
          className={`text-xs px-4 py-1.5 rounded-t-lg transition-colors ${
            activeTab === 'signals'
              ? 'bg-primary/10 text-primary border border-primary/30 border-b-transparent'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Señales
        </button>
        <button
          onClick={() => setActiveTab('confluencia')}
          className={`text-xs px-4 py-1.5 rounded-t-lg transition-colors flex items-center gap-1.5 ${
            activeTab === 'confluencia'
              ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/30 border-b-transparent'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          ⭐ Confluencia
          {convergence && convergence.intersection.length > 0 && (
            <span className="text-[9px] bg-yellow-500/20 text-yellow-400 rounded px-1">
              {convergence.intersection.length}
            </span>
          )}
        </button>
      </div>

      {/* Filters */}
      {activeTab === 'signals' && (data && data.totalSymbols > 0 || portfolioSet.size > 0) && (
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

      {activeTab === 'signals' && <>
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
      {!error && !isScanning && data && data.totalSymbols > 0 && filtered.length === 0 && unscannedPortfolioSymbols.length === 0 && (
        <div className="text-center py-8 space-y-1">
          <p className="text-muted-foreground text-sm">Sin señales con este filtro.</p>
          <p className="text-xs text-muted-foreground">
            {data.totalSymbols} símbolos escaneados · ninguno activó señales con los umbrales actuales.
          </p>
        </div>
      )}

      {/* Results */}
      {(filtered.length > 0 || unscannedPortfolioSymbols.length > 0) && (
        <div className="space-y-3">
          {filtered.map((signal) => (
            <SignalCard
              key={signal.symbol}
              signal={signal}
              analysis={analysisMap.get(signal.symbol) ?? null}
              isAnalyzing={isAnalyzing}
              aScore={actionableScore(signal)}
              forceExpanded={allExpanded}
            />
          ))}
          {unscannedPortfolioSymbols.length > 0 && (
            <div className="rounded-md border border-border/50 p-3">
              <p className="text-xs text-muted-foreground mb-2">
                {unscannedPortfolioSymbols.length} símbolo(s) de tu portfolio sin scan todavía — ejecutá "Escanear" para verlos:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {unscannedPortfolioSymbols.map((sym) => (
                  <span key={sym} className="text-xs font-medium px-2 py-0.5 rounded bg-muted text-muted-foreground">
                    {sym}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      {data && data.totalSymbols > 0 && (
        <p className="text-[10px] text-muted-foreground text-center">
          Última actualización: {new Date(data.scannedAt).toLocaleString('es-AR')} · Cache 6h
        </p>
      )}

      {/* Scan history */}
      {scanHistory && scanHistory.length > 0 && (
        <details className="text-[10px] text-muted-foreground">
          <summary className="cursor-pointer hover:text-foreground select-none">
            Historial de scans ({scanHistory.length})
          </summary>
          <div className="mt-2 space-y-1">
            {scanHistory.map((run) => (
              <div key={run.id} className={`flex items-center gap-3 px-2 py-1 rounded text-[10px] ${run.errorMessage ? 'bg-red-500/10 text-red-400' : 'bg-muted/30'}`}>
                <span className={run.errorMessage ? 'text-red-400' : run.completedAt ? 'text-green-400' : 'text-yellow-400'}>
                  {run.errorMessage ? '✗' : run.completedAt ? '✓' : '⟳'}
                </span>
                <span>{run.startedAt ? new Date(run.startedAt).toLocaleString('es-AR') : '—'}</span>
                {run.completedAt && run.totalSymbols && (
                  <span>{run.scannedOk}/{run.totalSymbols} ok {run.failedCount ? `· ${run.failedCount} errores` : ''}</span>
                )}
                {run.withSignals != null && <span>· {run.withSignals} señales</span>}
                {run.marketRegime && (
                  <span className={run.marketRegime === 'bull' ? 'text-green-400' : run.marketRegime === 'bear' ? 'text-red-400' : 'text-yellow-400'}>
                    {run.marketRegime}
                  </span>
                )}
                {run.durationMs && <span>{(run.durationMs / 1000).toFixed(0)}s</span>}
                {run.errorMessage && <span className="truncate max-w-xs">{run.errorMessage}</span>}
              </div>
            ))}
          </div>
        </details>
      )}

      <TrackedSignals />
      </>}

      {/* ─── Confluencia tab ───────────────────────────────────────── */}
      {activeTab === 'confluencia' && (
        <div className="space-y-4">
          {!convergence || (convergence.intersection.length === 0 && convergence.onlyInScan.length === 0 && convergence.onlyInNews.length === 0) ? (
            <div className="text-center py-16 space-y-2">
              <p className="text-muted-foreground text-sm">Sin datos de confluencia todavía.</p>
              <p className="text-xs text-muted-foreground">Ejecutá "Escanear" y "Analizar desde Noticias" para cruzar ambos pipelines.</p>
            </div>
          ) : (
            <>
              {convergence.intersection.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-yellow-400">En ambos pipelines</span>
                    <span className="text-[10px] text-muted-foreground">Señales técnicas + confirmación noticial</span>
                    <span className="ml-auto text-[10px] bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 rounded px-1.5 py-0.5">
                      {convergence.intersection.length} símbolos
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {convergence.intersection.map((item) => {
                      const verdictColor = item.analysis?.verdict === 'BUY_SETUP' ? 'text-green-400' : item.analysis?.verdict === 'WAIT' ? 'text-yellow-400' : item.analysis?.verdict === 'PASS' ? 'text-red-400' : 'text-muted-foreground';
                      const impactColor = item.sectorImpact === 'positive' ? 'text-green-400' : item.sectorImpact === 'negative' ? 'text-red-400' : 'text-muted-foreground';
                      const scoreColor = item.combinedScore >= 8 ? 'text-green-400 font-bold' : item.combinedScore >= 5 ? 'text-yellow-400' : 'text-muted-foreground';
                      return (
                        <div key={item.symbol} className="flex items-center gap-2 rounded-lg bg-yellow-500/5 border border-yellow-500/20 px-3 py-2 text-xs">
                          <span className="font-bold w-14 shrink-0">{item.symbol}</span>
                          {item.currentPrice && <span className="text-muted-foreground w-16 shrink-0">${item.currentPrice.toFixed(2)}</span>}
                          <div className="flex gap-1 shrink-0">
                            {item.signals.pead && <span className="px-1 py-0.5 rounded text-[9px] bg-blue-500/20 text-blue-400">PEAD</span>}
                            {item.signals.insider && <span className="px-1 py-0.5 rounded text-[9px] bg-purple-500/20 text-purple-400">INS</span>}
                            {item.signals.options && <span className="px-1 py-0.5 rounded text-[9px] bg-orange-500/20 text-orange-400">OPT</span>}
                          </div>
                          {item.sector && (
                            <span className={`text-[10px] shrink-0 ${impactColor}`}>
                              {item.sector}
                            </span>
                          )}
                          {item.analysis && (
                            <span className={`text-[10px] font-semibold shrink-0 ${verdictColor}`}>
                              {item.analysis.verdict === 'BUY_SETUP' ? '🟢 BUY' : item.analysis.verdict === 'WAIT' ? '🟡 WAIT' : '🔴 PASS'}
                            </span>
                          )}
                          {item.analysis?.entryZone && item.analysis.entryZone !== 'N/A' && (
                            <span className="text-[10px] text-muted-foreground shrink-0">
                              entrada <span className="text-foreground font-medium">{item.analysis.entryZone}</span>
                            </span>
                          )}
                          {item.analysis?.riskReward && (
                            <span className="text-[10px] text-muted-foreground shrink-0">R/R {item.analysis.riskReward}</span>
                          )}
                          <span className={`ml-auto text-xs font-bold shrink-0 ${scoreColor}`}>{item.combinedScore}/9</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                {convergence.onlyInScan.length > 0 && (
                  <div className="rounded-lg border border-border p-3 space-y-1.5">
                    <div className="text-xs font-semibold text-muted-foreground">Solo señales técnicas <span className="text-foreground">({convergence.onlyInScan.length})</span></div>
                    <div className="text-[10px] text-muted-foreground">Sin confirmación noticial todavía</div>
                    <div className="space-y-1">
                      {convergence.onlyInScan.map((s) => (
                        <div key={s.symbol} className="flex items-center gap-2 text-[10px]">
                          <span className="font-medium text-foreground w-12">{s.symbol}</span>
                          <span className="text-muted-foreground">{s.conviction}</span>
                          <span className="ml-auto text-muted-foreground">{s.compositeScore}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {convergence.onlyInNews.length > 0 && (
                  <div className="rounded-lg border border-border p-3 space-y-1.5">
                    <div className="text-xs font-semibold text-muted-foreground">Solo noticias <span className="text-foreground">({convergence.onlyInNews.length})</span></div>
                    <div className="text-[10px] text-muted-foreground">Sin señales técnicas todavía</div>
                    <div className="space-y-1">
                      {convergence.onlyInNews.map((s) => (
                        <div key={s.symbol} className="flex items-center gap-2 text-[10px]">
                          <span className="font-medium text-foreground w-12">{s.symbol}</span>
                          {s.sector && <span className={`${s.sectorImpact === 'positive' ? 'text-green-400' : s.sectorImpact === 'negative' ? 'text-red-400' : 'text-muted-foreground'}`}>{s.sector}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
