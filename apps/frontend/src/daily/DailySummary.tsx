import { useState } from 'react';
import { trpc } from '@/shared/trpc';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MarketReportView } from './MarketReportView';
import { AccuracyPanel } from './AccuracyPanel';
import { usePipeline } from '../pipeline/usePipeline';
import { usePrintSection } from '@/shared/usePrintSection';
import { useAiModeModal } from '@/shared/AiModeModal';

function MarketReportSection({ date }: { date: string }) {
  return <MarketReportView date={date} />;
}

function SectorImpactsSection() {
  const { data: sectors } = trpc.intelligence.sectorReports.useQuery(undefined, {
    staleTime: 5 * 60_000,
  });

  const utils = trpc.useUtils();
  const addToWatchlist = trpc.opportunities.addToWatchlist.useMutation({
    onSuccess: () => utils.opportunities.scan.invalidate(),
  });

  if (!sectors || sectors.length === 0) return null;

  const impactColor = {
    positive: 'border-l-green-500',
    negative: 'border-l-red-500',
    mixed: 'border-l-yellow-500',
  };

  const impactBadge = {
    positive: 'bg-green-500/20 text-green-400',
    negative: 'bg-red-500/20 text-red-400',
    mixed: 'bg-yellow-500/20 text-yellow-400',
  };

  const impactLabel = {
    positive: 'Positivo',
    negative: 'Negativo',
    mixed: 'Mixto',
  };

  const conviccionBadge = {
    alta: 'bg-blue-500/20 text-blue-400',
    media: 'bg-muted text-muted-foreground',
    baja: 'bg-gray-500/10 text-gray-500',
  };

  return (
    <div className="space-y-2">
      <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
        Sectores impactados por noticias ({sectors.length})
      </span>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {sectors.map((s, i) => (
          <Card key={i} size="sm" className={`border-l-4 ${impactColor[s.impact as keyof typeof impactColor] ?? 'border-l-muted'}`}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold">{s.sector}</span>
                <div className="flex items-center gap-1.5">
                  {(s as any).conviccion && (
                    <Badge className={`text-[8px] ${conviccionBadge[(s as any).conviccion as keyof typeof conviccionBadge] ?? conviccionBadge.media}`}>
                      Conv. {(s as any).conviccion}
                    </Badge>
                  )}
                  <Badge className={`text-[8px] ${impactBadge[s.impact as keyof typeof impactBadge] ?? ''}`}>
                    {impactLabel[s.impact as keyof typeof impactLabel] ?? s.impact}
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-[10px] text-foreground leading-relaxed">{s.summary}</p>

              {/* Tension warning */}
              {(s as any).tension && (
                <div className="rounded bg-amber-500/10 border border-amber-500/20 px-2 py-1">
                  <p className="text-[9px] text-amber-400">⚡ {(s as any).tension}</p>
                </div>
              )}

              {/* Catalysts */}
              {(s as any).catalysts?.length > 0 && (
                <div className="rounded bg-green-500/5 border border-green-500/20 px-2 py-1.5 space-y-0.5">
                  <span className="text-[8px] text-green-400 uppercase tracking-wider font-medium">Catalizadores</span>
                  {(s as any).catalysts.map((c: string, j: number) => (
                    <p key={j} className="text-[9px] text-foreground/80">+ {c}</p>
                  ))}
                </div>
              )}

              {s.keyNews.length > 0 && (
                <div className="space-y-0.5">
                  <span className="text-[8px] text-muted-foreground uppercase">Noticias clave</span>
                  {s.keyNews.slice(0, 2).map((n, j) => (
                    <p key={j} className="text-[9px] text-muted-foreground">- {n}</p>
                  ))}
                </div>
              )}

              {s.suggestedTickers.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {s.suggestedTickers.map((t, j) => (
                    <Button
                      key={j}
                      size="sm"
                      variant="outline"
                      className="h-5 text-[9px] px-1.5 font-mono"
                      onClick={() => addToWatchlist.mutate({ symbol: t })}
                    >
                      {t} +
                    </Button>
                  ))}
                </div>
              )}

              {s.riskFactors.length > 0 && (
                <div className="space-y-0.5">
                  <span className="text-[8px] text-red-500 uppercase">Riesgos</span>
                  {s.riskFactors.map((r, j) => (
                    <p key={j} className="text-[9px] text-muted-foreground">- {r}</p>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

type SignalAction = 'BUY' | 'SELL' | 'HOLD' | 'WATCH';

const actionStyle: Record<SignalAction, { label: string; bg: string; text: string }> = {
  BUY: { label: 'COMPRAR', bg: 'bg-green-500/20', text: 'text-green-400' },
  SELL: { label: 'VENDER', bg: 'bg-red-500/20', text: 'text-red-400' },
  HOLD: { label: 'MANTENER', bg: 'bg-blue-500/20', text: 'text-blue-400' },
  WATCH: { label: 'OBSERVAR', bg: 'bg-yellow-500/20', text: 'text-yellow-400' },
};


function TrackingHistory() {
  const { data: history } = trpc.opportunities.trackingHistory.useQuery({ limit: 30 }, {
    staleTime: 60_000,
  });

  if (!history || history.length === 0) return null;

  return (
    <Card size="sm">
      <CardHeader>
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Historial de senales</span>
      </CardHeader>
      <CardContent>
        <div className="space-y-0.5 max-h-80 overflow-y-auto">
          {history.map((s, idx) => {
            const act = actionStyle[(s.action as SignalAction) ?? 'WATCH'] ?? actionStyle.WATCH;
            const returnPct = s.returnAfter7d ?? s.returnAfter30d;
            const isResolved = s.outcome !== 'pending';
            const prevDate = idx > 0 ? history[idx - 1].signalDate : null;
            const isNewDate = s.signalDate !== prevDate;

            return (
              <div key={s.id}>
                {isNewDate && (
                  <div className="flex items-center gap-2 pt-2 pb-1 first:pt-0">
                    <div className="h-px flex-1 bg-border" />
                    <span className="text-[9px] font-medium text-muted-foreground shrink-0">{s.signalDate}</span>
                    <div className="h-px flex-1 bg-border" />
                  </div>
                )}
                <div className="flex items-center justify-between py-1 px-2 rounded hover:bg-muted/30 text-[10px]">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-semibold text-[11px]">{s.symbol}</span>
                    <Badge className={`text-[8px] h-4 ${act.bg} ${act.text}`}>{act.label}</Badge>
                    <span className="text-muted-foreground">${s.entryPrice.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {isResolved ? (
                      <>
                        <Badge className={`text-[8px] h-4 ${
                          s.outcome === 'win' ? 'bg-green-500/20 text-green-400'
                            : s.outcome === 'loss' ? 'bg-red-500/20 text-red-400'
                            : 'bg-gray-500/20 text-gray-400'
                        }`}>
                          {s.outcome === 'win' ? 'GANO' : s.outcome === 'loss' ? 'PERDIO' : 'NEUTRAL'}
                        </Badge>
                        {returnPct != null && (
                          <span className={`font-mono ${returnPct > 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {returnPct > 0 ? '+' : ''}{returnPct.toFixed(1)}%
                          </span>
                        )}
                      </>
                    ) : (
                      <Badge className="text-[8px] h-4 bg-muted text-muted-foreground">PENDIENTE</Badge>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function PortfolioAlerts({ symbolFilter }: { symbolFilter: string }) {
  const { data: portfolio } = trpc.portfolio.get.useQuery(undefined, { staleTime: 60_000 });
  const { data: scan } = trpc.opportunities.scan.useQuery(undefined, { staleTime: 5 * 60_000 });

  if (!portfolio || !scan) return null;

  const opportunities = scan.opportunities ?? [];
  const oppMap = new Map(opportunities.map(o => [o.symbol, o]));

  // Posiciones del portfolio con señal IA
  const positionsWithSignals = (portfolio.positions ?? [])
    .filter((p: any) => p.quantity > 0)
    .filter((p: any) => !symbolFilter || p.symbol.toUpperCase().includes(symbolFilter.toUpperCase()))
    .map((p: any) => {
      const opp = oppMap.get(p.symbol);
      return { ...p, opp };
    })
    .sort((a: any, b: any) => {
      // Prioridad: SELL primero, luego los que tienen conflictos/timing
      const actionPriority: Record<string, number> = { SELL: 0, WATCH: 1, HOLD: 2, BUY: 3 };
      const aPri = actionPriority[a.opp?.action ?? 'HOLD'] ?? 2;
      const bPri = actionPriority[b.opp?.action ?? 'HOLD'] ?? 2;
      if (aPri !== bPri) return aPri - bPri;
      // Luego por valor (mayor posición primero)
      return (b.currentValue ?? 0) - (a.currentValue ?? 0);
    });

  if (positionsWithSignals.length === 0) return null;

  return (
    <Card size="sm">
      <CardHeader>
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Mis posiciones hoy</span>
          <Badge className="text-[9px] bg-muted text-muted-foreground">{positionsWithSignals.length} activos</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {positionsWithSignals.map((p: any) => {
            const opp = p.opp;
            const act = actionStyle[(opp?.action as SignalAction) ?? 'HOLD'] ?? actionStyle.HOLD;
            const tv = opp?.timingView;
            const conflicts = opp?.signalConflicts as Array<{ signalA: string; signalB: string; implication: string }> | undefined;
            const pnlPct = p.totalCost > 0 ? ((p.currentValue - p.totalCost) / p.totalCost) * 100 : 0;
            const hasAlert = (conflicts && conflicts.length > 0) || opp?.action === 'SELL'
              || (tv?.triggers?.length > 0 && (tv.timing === 'now' || tv.timing === 'soon'));

            return (
              <div key={p.symbol} className={`rounded-md p-2 space-y-1 ${hasAlert ? 'bg-muted/40 border border-muted' : 'bg-muted/20'}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono font-semibold">{p.symbol}</span>
                    <Badge className={`text-[9px] h-4 ${act.bg} ${act.text}`}>{act.label}</Badge>
                    {opp?.opportunityScore != null && (
                      <span className="text-[10px] font-mono text-muted-foreground">{opp.opportunityScore}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-[10px]">
                    <span className="text-muted-foreground">${p.currentPrice?.toFixed(2) ?? opp?.currentPrice?.toFixed(2) ?? '—'}</span>
                    <span className={`font-mono font-medium ${pnlPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%
                    </span>
                  </div>
                </div>

                {/* Simple reasoning */}
                {opp?.simpleReasoning && (
                  <p className="text-[10px] text-foreground/80">{opp.simpleReasoning}</p>
                )}

                {/* Signal conflicts */}
                {conflicts && conflicts.length > 0 && (
                  <div className="rounded bg-yellow-500/10 border border-yellow-500/20 px-2 py-1">
                    {conflicts.map((c, i) => (
                      <p key={i} className="text-[9px] text-yellow-400">
                        ⚠ {c.signalB}
                      </p>
                    ))}
                  </div>
                )}

                {/* Timing triggers */}
                {tv?.triggers?.slice(0, 2).map((t: any, i: number) => (
                  <p key={i} className="text-[9px] text-muted-foreground">
                    {t.impact === 'high' ? '! ' : '- '}{t.description}
                    {t.estimatedDays != null && <span className="text-blue-400 ml-1">(~{t.estimatedDays}d)</span>}
                  </p>
                ))}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function ActiveAlerts({ symbolFilter }: { symbolFilter: string }) {
  const { data: scan, isLoading } = trpc.opportunities.scan.useQuery(undefined, {
    staleTime: 5 * 60_000,
  });

  if (isLoading) {
    return (
      <Card size="sm">
        <CardContent className="py-6">
          <div className="text-center space-y-2">
            <p className="text-xs text-muted-foreground">Cargando datos del ultimo analisis...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!scan) {
    return (
      <Card size="sm">
        <CardContent className="py-6">
          <div className="text-center space-y-2">
            <p className="text-sm text-muted-foreground">No hay datos de analisis todavia</p>
            <p className="text-xs text-muted-foreground">
              Presiona <span className="font-semibold text-foreground">Actualizar analisis</span> en el header para ejecutar el primer escaneo.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const allOpportunities = scan?.opportunities ?? [];
  const opportunities = symbolFilter
    ? allOpportunities.filter(o => o.symbol.toUpperCase().includes(symbolFilter.toUpperCase()))
    : allOpportunities;

  // Filtrar oportunidades con timing activo O divergencias semanales
  // Incluye WATCH con timing activo — son las señales de anticipación más valiosas
  const activeAlerts = opportunities.filter(o => {
    const tv = (o as any).timingView;
    const divs = (o as any).divergences as Array<{ timeframe: string }> | undefined;
    const hasWeeklyDivergence = divs?.some(d => d.timeframe === 'weekly');
    const hasActiveTiming = tv && tv.triggers.length > 0 && (tv.timing === 'now' || tv.timing === 'soon');
    return (hasActiveTiming || hasWeeklyDivergence)
      && (o.action === 'BUY' || o.action === 'SELL' || o.action === 'WATCH');
  });

  // Top BUY/SELL/WATCH-con-timing del día
  const topSignals = opportunities
    .filter(o => {
      if (o.action === 'BUY' || o.action === 'SELL') return true;
      const tv = (o as any).timingView;
      return o.action === 'WATCH' && tv && tv.triggers.length >= 2 && (tv.timing === 'now' || tv.timing === 'soon');
    })
    .slice(0, 8);

  return (
    <div className="space-y-4">
      {/* Alertas de timing activas */}
      <Card size="sm">
        <CardHeader>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Alertas activas hoy</span>
            <Badge className="text-[9px] bg-muted text-muted-foreground">{activeAlerts.length} alertas</Badge>
          </div>
        </CardHeader>
        <CardContent>
          {activeAlerts.length === 0 ? (
            <p className="text-xs text-muted-foreground">No hay alertas de timing activas ahora mismo.</p>
          ) : (
            <div className="space-y-2">
              {activeAlerts.map((o) => {
                const tv = (o as any).timingView;
                const tl = (o as any).tradeLevels;
                const act = actionStyle[o.action] ?? actionStyle.WATCH;
                return (
                  <div key={o.symbol} className="rounded-md bg-muted/30 p-2 space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-mono font-semibold">{o.symbol}</span>
                        <Badge className={`text-[10px] ${act.bg} ${act.text}`}>{act.label}</Badge>
                        <span className="text-[10px] font-mono text-muted-foreground">${o.currentPrice.toFixed(2)}</span>
                      </div>
                      <Badge className={`text-[8px] ${
                        tv?.timing === 'now' ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'
                      }`}>
                        {tv?.timing === 'now' ? 'AHORA' : 'PRONTO'}
                      </Badge>
                    </div>
                    <p className="text-[10px] text-foreground">{o.simpleReasoning ?? o.reasoning}</p>
                    {/* Divergences (highlighted) */}
                    {((o as any).divergences as Array<{ type: string; indicator: string; timeframe: string; description: string }> | undefined)
                      ?.filter(d => d.timeframe === 'weekly')
                      .map((d, i) => (
                        <p key={`div-${i}`} className={`text-[9px] font-medium ${d.type === 'bullish' ? 'text-green-400' : 'text-red-400'}`}>
                          {d.type === 'bullish' ? '+ ' : '- '}{d.description}
                          <span className="text-blue-400 ml-1">[Semanal]</span>
                        </p>
                      ))}
                    {/* Timing triggers */}
                    {tv?.triggers?.slice(0, 2).map((t: any, i: number) => (
                      <p key={i} className="text-[9px] text-muted-foreground">
                        {t.impact === 'high' ? '! ' : '- '}{t.description}
                        {t.estimatedDays != null && <span className="text-blue-400 ml-1">(~{t.estimatedDays}d)</span>}
                      </p>
                    ))}
                    {tl && (
                      <div className="flex items-center gap-3 text-[9px] pt-0.5">
                        <span className="text-blue-400">Entrada: ${tl.entryPrice.toFixed(2)}</span>
                        <span className="text-red-400">Stop: ${tl.stopLoss.toFixed(2)}</span>
                        <span className="text-green-400">Target: ${tl.takeProfit.toFixed(2)}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Top señales del día */}
      <Card size="sm">
        <CardHeader>
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Top senales del dia</span>
        </CardHeader>
        <CardContent>
          {topSignals.length === 0 ? (
            <p className="text-xs text-muted-foreground">No hay senales BUY/SELL activas. Ejecuta un scan primero.</p>
          ) : (
            <div className="space-y-1">
              {topSignals.map((o) => {
                const act = actionStyle[o.action] ?? actionStyle.WATCH;
                const tl = (o as any).tradeLevels;
                return (
                  <div key={o.symbol} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/30">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-mono font-semibold">{o.symbol}</span>
                      <Badge className={`text-[9px] h-4 ${act.bg} ${act.text}`}>{act.label}</Badge>
                      <span className="text-[10px] text-muted-foreground">{o.confidence}% conf.</span>
                    </div>
                    <div className="flex items-center gap-2 text-[10px]">
                      {tl && (
                        <>
                          <span className="text-blue-400">${tl.entryPrice.toFixed(2)}</span>
                          <span className="text-muted-foreground">→</span>
                          <span className="text-green-400">${tl.takeProfit.toFixed(2)}</span>
                        </>
                      )}
                      <span className={`font-mono ${o.shortTerm.midPercent > 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {o.shortTerm.midPercent > 0 ? '+' : ''}{o.shortTerm.midPercent}%
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

const moodConfig = {
  'risk-on': { label: 'RISK-ON', bg: 'bg-green-500/20', text: 'text-green-400', desc: 'El mercado favorece activos de riesgo' },
  'risk-off': { label: 'RISK-OFF', bg: 'bg-red-500/20', text: 'text-red-400', desc: 'El mercado esta en modo defensivo' },
  'mixed': { label: 'MIXTO', bg: 'bg-yellow-500/20', text: 'text-yellow-400', desc: 'Senales cruzadas en el mercado' },
};

function MarketDigestPanel() {
  const { data: digest } = trpc.intelligence.marketDigest.useQuery(undefined, {
    staleTime: 5 * 60_000,
  });
  const { run, isRunning } = usePipeline();
  const { selectMode, modal } = useAiModeModal();

  if (!digest) return null;

  const mood = moodConfig[digest.marketMood] ?? moodConfig.mixed;

  return (
    <>
    <Card size="sm" className="border-l-4 border-l-blue-500">
      <CardHeader>
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Market Digest</span>
          <Badge className={`text-[9px] ${mood.bg} ${mood.text}`}>
            {mood.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Overnight summary */}
        {digest.overnightSummary && (
          <div>
            <span className="text-[9px] text-blue-400 uppercase tracking-wider font-medium">Que paso</span>
            <p className="text-xs text-foreground leading-relaxed mt-0.5">{digest.overnightSummary}</p>
          </div>
        )}

        {/* Portfolio impact */}
        {digest.portfolioImpact && (
          <div>
            <span className="text-[9px] text-blue-400 uppercase tracking-wider font-medium">Impacto en tu portfolio</span>
            <p className="text-xs text-foreground leading-relaxed mt-0.5">{digest.portfolioImpact}</p>
          </div>
        )}

        {/* Top opportunities */}
        {digest.topOpportunities.length > 0 && (
          <div className="space-y-2">
            <span className="text-[9px] text-blue-400 uppercase tracking-wider font-medium">Oportunidades destacadas</span>
            {digest.topOpportunities.map((opp, i) => {
              const act = actionStyle[(opp.action as SignalAction) ?? 'BUY'] ?? actionStyle.BUY;
              return (
                <div key={i} className="rounded-md bg-muted/30 p-2 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-mono font-semibold">{opp.symbol}</span>
                    <Badge className={`text-[9px] h-4 ${act.bg} ${act.text}`}>{act.label}</Badge>
                  </div>
                  <p className="text-[10px] text-foreground leading-relaxed">{opp.narrative}</p>
                </div>
              );
            })}
          </div>
        )}

        {/* Lo que SÍ haría */}
        {digest.wouldDo && digest.wouldDo.length > 0 ? (
          <div className="rounded-md bg-green-500/5 border border-green-500/20 p-2">
            <span className="text-[9px] text-green-400 uppercase tracking-wider font-medium">Lo que SI haria hoy</span>
            <div className="space-y-1 mt-1">
              {digest.wouldDo.map((item, i) => (
                <p key={i} className="text-[10px] text-foreground leading-relaxed">- {item}</p>
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-md bg-yellow-500/5 border border-yellow-500/20 p-2 flex items-center justify-between gap-2">
            <div>
              <span className="text-[9px] text-yellow-400 uppercase tracking-wider font-medium">Lo que SI haria hoy</span>
              <p className="text-[10px] text-muted-foreground mt-0.5">El modelo no generó recomendaciones en este run. Regenerá el análisis para obtenerlas.</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-[9px] px-2 shrink-0 border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10"
              onClick={async () => {
                const mode = await selectMode();
                run(false, undefined, mode);
              }}
              disabled={isRunning}
            >
              {isRunning ? 'Ejecutando...' : 'Regenerar'}
            </Button>
          </div>
        )}

        {/* Lo que NO haría */}
        {digest.wouldNotDo && digest.wouldNotDo.length > 0 && (
          <div className="rounded-md bg-red-500/5 border border-red-500/20 p-2">
            <span className="text-[9px] text-red-400 uppercase tracking-wider font-medium">Lo que NO haria</span>
            <div className="space-y-1 mt-1">
              {digest.wouldNotDo.map((item, i) => (
                <p key={i} className="text-[10px] text-foreground leading-relaxed">- {item}</p>
              ))}
            </div>
          </div>
        )}

        {/* Warnings */}
        {digest.warnings.length > 0 && (
          <div>
            <span className="text-[9px] text-amber-400 uppercase tracking-wider font-medium">Riesgos a vigilar</span>
            <div className="space-y-0.5 mt-0.5">
              {digest.warnings.map((w, i) => (
                <p key={i} className="text-[10px] text-amber-300/80">- {w}</p>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
    {modal}
    </>
  );
}



export function DailySummary() {
  const [symbolFilter, setSymbolFilter] = useState('');
  const today = new Date().toISOString().slice(0, 10);
  const [selectedDate, setSelectedDate] = useState(today);
  const isToday = selectedDate === today;

  usePrintSection('daily-summary-print');

  const { data: reportDates = [] } = trpc.intelligence.reportDates.useQuery(undefined, {
    staleTime: 5 * 60_000,
  });

  const dates = reportDates.includes(today) ? reportDates : [today, ...reportDates];

  return (
    <div id="daily-summary-print" className="p-4 max-w-4xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground">Resumen del dia</h2>
          {!isToday && (
            <span className="text-[9px] bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded px-1.5 py-0.5">
              Historico
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <select
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="h-7 rounded border border-border/50 bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {dates.map((d) => (
              <option key={d} value={d}>
                {d === today ? `${d} (hoy)` : d}
              </option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Filtrar simbolo..."
            value={symbolFilter}
            onChange={(e) => setSymbolFilter(e.target.value.toUpperCase())}
            className="h-7 w-32 rounded border border-border/50 bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => window.print()}
            className="h-7 text-[10px] px-2 gap-1"
            title="Imprimir / Guardar como PDF"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            PDF
          </Button>
        </div>
      </div>

      {isToday && <SectorImpactsSection />}
      <MarketReportSection date={selectedDate} />
      {isToday && <MarketDigestPanel />}
      <PortfolioAlerts symbolFilter={symbolFilter} />
      <ActiveAlerts symbolFilter={symbolFilter} />
      <AccuracyPanel />
      <TrackingHistory />
    </div>
  );
}
