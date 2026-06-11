import { useState } from 'react';
import { trpc } from '@/shared/trpc';
import { SectorImpactMapPanel } from './SectorImpactMapPanel';
import { printWithTitle } from '@/shared/printWithTitle';
import { TabInfo, InfoSection } from '@/shared/TabInfo';
import { WatchlistButton } from '@/shared/WatchlistButton';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  classifyInstrument,
  INSTRUMENT_LABELS,
  INSTRUMENT_SHORT_LABELS,
  INSTRUMENT_BADGE_CLASSES,
  type InstrumentFilter,
  type InstrumentKind,
} from '@/shared/instrumentType';
import { MarketReportView } from './MarketReportView';
import { AccuracyPanel } from './AccuracyPanel';
import { RadarSummaryWidget } from './widgets/RadarSummaryWidget';
import { SectorRotationWidget } from './widgets/SectorRotationWidget';
import { EarningsWidget } from './widgets/EarningsWidget';
import { TopNewsWidget } from './widgets/TopNewsWidget';
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

  if (!sectors || sectors.length === 0) return null;

  const impactColor = {
    positive: 'border-l-green-500',
    negative: 'border-l-red-500',
    mixed: 'border-l-yellow-500',
    neutral: 'border-l-muted',
  };

  const impactBadge = {
    positive: 'bg-green-500/20 text-green-400',
    negative: 'bg-red-500/20 text-red-400',
    mixed: 'bg-yellow-500/20 text-yellow-400',
    neutral: 'bg-muted text-muted-foreground',
  };

  const impactLabel = {
    positive: 'Positivo',
    negative: 'Negativo',
    mixed: 'Mixto',
    neutral: 'Sin movimiento',
  };

  const conviccionBadge = {
    alta: 'bg-blue-500/20 text-blue-400',
    media: 'bg-muted text-muted-foreground',
    baja: 'bg-gray-500/10 text-gray-500',
  };

  // Orden: activos (no neutral) primero, dentro de cada grupo por convicción alta→baja.
  const convOrder = { alta: 0, media: 1, baja: 2 } as const;
  const sorted = [...sectors].sort((a, b) => {
    const aActive = a.impact !== 'neutral' ? 0 : 1;
    const bActive = b.impact !== 'neutral' ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    return (convOrder[a.conviccion as keyof typeof convOrder] ?? 9) - (convOrder[b.conviccion as keyof typeof convOrder] ?? 9);
  });

  const activeCount = sorted.filter(s => s.impact !== 'neutral').length;

  return (
    <div className="space-y-2">
      <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
        Sectores impactados por noticias ({activeCount} activos / {sorted.length} total)
      </span>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {sorted.map((s, i) => (
          <Card key={i} size="sm" className={`border-l-4 ${impactColor[s.impact as keyof typeof impactColor] ?? 'border-l-muted'} ${s.impact === 'neutral' ? 'opacity-60' : ''}`}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold">{s.sector}</span>
                <div className="flex items-center gap-1.5">
                  {s.conviccion && (
                    <Badge className={`text-[8px] ${conviccionBadge[s.conviccion as keyof typeof conviccionBadge] ?? conviccionBadge.media}`}>
                      Conv. {s.conviccion}
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
              {s.tension && (
                <div className="rounded bg-amber-500/10 border border-amber-500/20 px-2 py-1">
                  <p className="text-[9px] text-amber-400">⚡ {s.tension}</p>
                </div>
              )}

              {/* Catalysts */}
              {s.catalysts?.length > 0 && (
                <div className="rounded bg-green-500/5 border border-green-500/20 px-2 py-1.5 space-y-0.5">
                  <span className="text-[8px] text-green-400 uppercase tracking-wider font-medium">Catalizadores</span>
                  {s.catalysts.map((c: string) => (
                    <p key={c} className="text-[9px] text-foreground/80">+ {c}</p>
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
                    <div key={j} className="flex items-center gap-1 rounded border border-border/50 px-1.5 py-0.5">
                      <span className="text-[9px] font-mono font-medium">{t}</span>
                      <WatchlistButton symbol={t} />
                    </div>
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

type DigestRec = {
  symbol: string;
  action: SignalAction;
  reason: string;
  currentPrice: number;
  score: number;
  tradeLevels?: { entryPrice: number; stopLoss: number; takeProfit: number };
};

// One digest recommendation row: action badge + ticker + motivo (verbatim del scan).
// Entry/stop/target only render for a real BUY — a hold/observar never shows a setup.
function RecommendationRow({ rec }: { rec: DigestRec }) {
  const cfg = actionStyle[rec.action] ?? actionStyle.WATCH;
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-baseline gap-1.5">
        <Badge className={`text-[8px] font-bold px-1 py-0 h-3.5 shrink-0 ${cfg.bg} ${cfg.text}`}>{cfg.label}</Badge>
        <span className="font-mono font-semibold text-[10px] text-foreground shrink-0">{rec.symbol}</span>
        {rec.reason && <span className="text-[10px] text-foreground leading-relaxed">— {rec.reason}</span>}
      </div>
      {rec.tradeLevels && (
        <p className="text-[9px] text-green-300/80 pl-1 font-mono">
          Entrada ${rec.tradeLevels.entryPrice.toFixed(2)} · Stop ${rec.tradeLevels.stopLoss.toFixed(2)} · Target ${rec.tradeLevels.takeProfit.toFixed(2)}
        </p>
      )}
    </div>
  );
}


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

function InstrumentBadge({ kind }: { kind: InstrumentKind | undefined }) {
  if (!kind) return null;
  return (
    <Badge variant="outline" className={`text-[8px] h-3.5 px-1 ${INSTRUMENT_BADGE_CLASSES[kind]}`}>
      {INSTRUMENT_SHORT_LABELS[kind]}
    </Badge>
  );
}

function useInstrumentTypeMap() {
  const { data: symbols } = trpc.portfolio.symbols.list.useQuery(undefined, { staleTime: 5 * 60_000 });
  const { data: etfs } = trpc.etf.getWatchlist.useQuery(undefined, { staleTime: 5 * 60_000 });
  const typeMap = new Map<string, InstrumentKind>();
  for (const s of symbols ?? []) typeMap.set((s as any).symbol, classifyInstrument(s as any));
  // ETF watchlist lives in a separate table; force-classify those symbols as 'etf'
  for (const e of etfs ?? []) typeMap.set((e as any).symbol, 'etf');
  return typeMap;
}

function PortfolioAlerts({ symbolFilter, typeFilter }: { symbolFilter: string; typeFilter: InstrumentFilter }) {
  const { data: portfolio } = trpc.portfolio.get.useQuery(undefined, { staleTime: 60_000 });
  const { data: scan } = trpc.opportunities.scan.useQuery(undefined, { staleTime: 5 * 60_000 });
  const typeMap = useInstrumentTypeMap();

  if (!portfolio || !scan) return null;

  const opportunities = scan.opportunities ?? [];
  const oppMap = new Map(opportunities.map(o => [o.symbol, o]));

  // Posiciones del portfolio con señal IA
  const positionsWithSignals = (portfolio.positions ?? [])
    .filter((p: any) => p.quantity > 0)
    .filter((p: any) => !symbolFilter || p.symbol.toUpperCase().includes(symbolFilter.toUpperCase()))
    .filter((p: any) => typeFilter === 'all' || typeMap.get(p.symbol) === typeFilter)
    .map((p: any) => {
      const opp = oppMap.get(p.symbol);
      return { ...p, opp, kind: typeMap.get(p.symbol) };
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
                    <InstrumentBadge kind={p.kind} />
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

function ActiveAlerts({ symbolFilter, typeFilter }: { symbolFilter: string; typeFilter: InstrumentFilter }) {
  const { data: scan, isLoading } = trpc.opportunities.scan.useQuery(undefined, {
    staleTime: 5 * 60_000,
  });
  const typeMap = useInstrumentTypeMap();

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
  const opportunities = allOpportunities
    .filter(o => !symbolFilter || o.symbol.toUpperCase().includes(symbolFilter.toUpperCase()))
    .filter(o => typeFilter === 'all' || typeMap.get(o.symbol) === typeFilter);

  // Filtrar oportunidades con timing activo O divergencias semanales
  // Incluye WATCH con timing activo — son las señales de anticipación más valiosas
  // Orden:
  //   1. action: BUY (comprable) → SELL (vender) → WATCH (observar)
  //   2. timing: AHORA (now) → PRONTO (soon) → resto
  //   3. opportunityScore desc
  const ACTION_PRIORITY: Record<string, number> = { BUY: 0, SELL: 1, WATCH: 2, HOLD: 3 };
  const TIMING_PRIORITY: Record<string, number> = { now: 0, soon: 1 };
  const activeAlerts = opportunities
    .filter(o => {
      const tv = (o as any).timingView;
      const divs = (o as any).divergences as Array<{ timeframe: string }> | undefined;
      const hasWeeklyDivergence = divs?.some(d => d.timeframe === 'weekly');
      const hasActiveTiming = tv && tv.triggers.length > 0 && (tv.timing === 'now' || tv.timing === 'soon');
      return (hasActiveTiming || hasWeeklyDivergence)
        && (o.action === 'BUY' || o.action === 'SELL' || o.action === 'WATCH');
    })
    .sort((a, b) => {
      const pa = ACTION_PRIORITY[a.action] ?? 99;
      const pb = ACTION_PRIORITY[b.action] ?? 99;
      if (pa !== pb) return pa - pb;
      const ta = TIMING_PRIORITY[(a as any).timingView?.timing] ?? 99;
      const tb = TIMING_PRIORITY[(b as any).timingView?.timing] ?? 99;
      if (ta !== tb) return ta - tb;
      return b.opportunityScore - a.opportunityScore;
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
                        <InstrumentBadge kind={typeMap.get(o.symbol)} />
                        <Badge className={`text-[10px] ${act.bg} ${act.text}`}>{act.label}</Badge>
                        <span className="text-[10px] font-mono text-muted-foreground">${o.currentPrice.toFixed(2)}</span>
                        <WatchlistButton symbol={o.symbol} />
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
                      <InstrumentBadge kind={typeMap.get(o.symbol)} />
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

  if (!digest) {
    return (
      <>
        <Card size="sm" className="border-l-4 border-l-yellow-500">
          <CardHeader>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Market Digest</span>
              <Badge className="text-[9px] bg-yellow-500/20 text-yellow-400">SIN DATOS</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Aún no se generó el digest del día. Ejecutá la síntesis para obtener overnight summary, top oportunidades, recomendaciones por símbolo (acción + motivo del scan), y warnings.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[10px] px-3 shrink-0 border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10"
                onClick={async () => {
                  const mode = await selectMode();
                  if (!mode) return;
                  run(false, undefined, mode);
                }}
                disabled={isRunning}
              >
                {isRunning ? 'Ejecutando...' : 'Generar reporte'}
              </Button>
            </div>
          </CardContent>
        </Card>
        {modal}
      </>
    );
  }

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

        {/* ============================== */}
        {/* SECCIÓN TU PORTFOLIO            */}
        {/* ============================== */}
        <div className="space-y-1 pt-1">
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-semibold text-amber-400 uppercase tracking-widest">Tu Portfolio</span>
            <div className="flex-1 h-px bg-amber-500/20" />
          </div>
        </div>

        {digest.portfolioImpact && (
          <div>
            <span className="text-[9px] text-blue-400 uppercase tracking-wider font-medium">Impacto en tu portfolio</span>
            <p className="text-xs text-foreground leading-relaxed mt-0.5">{digest.portfolioImpact}</p>
          </div>
        )}

        {digest.portfolioRecommendations && digest.portfolioRecommendations.length > 0 ? (
          <div className="rounded-md bg-muted/20 border border-border/40 p-2">
            <span className="text-[9px] text-amber-400 uppercase tracking-wider font-medium">Qué haría con cada posición</span>
            <div className="space-y-1.5 mt-1.5">
              {digest.portfolioRecommendations.map((rec, i) => (
                <RecommendationRow key={`${rec.symbol}-${i}`} rec={rec} />
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-md bg-yellow-500/5 border border-yellow-500/20 p-2 flex items-center justify-between gap-2">
            <div>
              <span className="text-[9px] text-yellow-400 uppercase tracking-wider font-medium">Recomendaciones de tu portfolio</span>
              <p className="text-[10px] text-muted-foreground mt-0.5">Sin recomendaciones para portfolio en este run. Regenerá el análisis.</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-[9px] px-2 shrink-0 border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10"
              onClick={async () => {
                const mode = await selectMode();
                if (!mode) return;
                run(false, undefined, mode);
              }}
              disabled={isRunning}
            >
              {isRunning ? 'Ejecutando...' : 'Regenerar'}
            </Button>
          </div>
        )}

        {/* ============================== */}
        {/* SECCIÓN MERCADO                 */}
        {/* ============================== */}
        <div className="space-y-1 pt-2">
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-semibold text-cyan-400 uppercase tracking-widest">Mercado</span>
            <span className="text-[8px] text-muted-foreground">(fuera de tu portfolio)</span>
            <div className="flex-1 h-px bg-cyan-500/20" />
          </div>
        </div>

        {digest.marketRecommendations && digest.marketRecommendations.length > 0 ? (
          <div className="rounded-md bg-muted/20 border border-border/40 p-2">
            <span className="text-[9px] text-cyan-400 uppercase tracking-wider font-medium">Oportunidades de mercado</span>
            <div className="space-y-1.5 mt-1.5">
              {digest.marketRecommendations.map((rec, i) => (
                <RecommendationRow key={`${rec.symbol}-${i}`} rec={rec} />
              ))}
            </div>
            {digest.watching && digest.watching.length > 0 && (
              <div className="mt-2 pt-2 border-t border-border/30">
                <span className="text-[9px] text-cyan-300/70 uppercase tracking-wider font-medium">En radar (triggers de entrada)</span>
                <div className="space-y-1 mt-0.5">
                  {digest.watching.map((w, i) => (
                    <p key={i} className="text-[10px] text-muted-foreground leading-relaxed">
                      <span className="font-mono font-semibold text-foreground">{w.symbol}</span> — {w.narrative}
                    </p>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-md bg-muted/30 p-2">
            <span className="text-[9px] text-muted-foreground uppercase tracking-wider font-medium">Oportunidades de mercado</span>
            <p className="text-[10px] text-muted-foreground mt-0.5">Sin oportunidades fuera de tu portfolio hoy.</p>
            {digest.watching && digest.watching.length > 0 && (
              <div className="mt-2 pt-2 border-t border-muted-foreground/10">
                <span className="text-[9px] text-muted-foreground uppercase tracking-wider font-medium">En radar (triggers de entrada)</span>
                <div className="space-y-1 mt-0.5">
                  {digest.watching.map((w, i) => (
                    <p key={i} className="text-[10px] text-muted-foreground leading-relaxed">
                      <span className="font-mono font-semibold text-foreground">{w.symbol}</span> — {w.narrative}
                    </p>
                  ))}
                </div>
              </div>
            )}
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
  const [typeFilter, setTypeFilter] = useState<InstrumentFilter>('all');
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
      <TabInfo>
        <InfoSection title="Qué muestra">
          Vista única que centraliza TODO el panorama del mercado: digest del día (recomendaciones por símbolo con acción + motivo del scan, en portfolio y mercado), top oportunidades, alertas de portfolio, sectores impactados por noticias, rotación sectorial vs SPY, radar de noticias con impactos positivos/negativos por ticker y sector, top noticias del día con triangulación, earnings próximos, eventos macro, y accuracy del sistema. Diseñado como landing principal — todo lo que necesitás para entender el mercado en una sola pantalla.
        </InfoSection>
        <InfoSection title="Orden de lectura sugerido">
          1) <strong>Market Digest</strong>: mood + qué pasó + recomendaciones por símbolo (acción + motivo del scan) en portfolio y mercado.<br />
          2) <strong>Alertas de portfolio</strong>: posiciones con señales urgentes.<br />
          3) <strong>Sectores impactados</strong>: convicción + tensiones + catalizadores.<br />
          4) <strong>Radar de noticias</strong>: top tickers/sectores positivos/negativos + exposición de tu portfolio a negativos.<br />
          5) <strong>Rotación sectorial</strong>: líderes vs rezagados vs SPY (1m y 3m).<br />
          6) <strong>Top noticias</strong>: las 6 más relevantes con confianza de triangulación.<br />
          7) <strong>Earnings</strong>: reportes próximos 7 días con consenso analistas.<br />
          8) <strong>Reporte completo</strong>: themes, scenarios, alternatives.<br />
          9) <strong>Accuracy</strong>: tracking de señales pasadas.
        </InfoSection>
        <InfoSection title="Datos en vivo vs históricos">
          Usá el selector de fecha para volver a días anteriores (modo histórico, sin widgets dinámicos). Por defecto muestra HOY con todos los widgets refrescándose cada 5 minutos.
        </InfoSection>
        <InfoSection title="Cuándo regenerar">
          El botón "Ejecutar pipeline" en el header dispara la regeneración completa (~3-5 min). Hacelo si la última corrida es de hace varias horas o si pasaron eventos macro relevantes.
        </InfoSection>
      </TabInfo>
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
          <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as InstrumentFilter)}>
            <SelectTrigger className="h-7 w-32 text-xs">
              <SelectValue placeholder="Tipo" />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(INSTRUMENT_LABELS) as InstrumentFilter[]).map((k) => (
                <SelectItem key={k} value={k} className="text-xs">{INSTRUMENT_LABELS[k]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="outline"
            onClick={() => printWithTitle('resumen', selectedDate)}
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

      {/* 1. Digest del día — mood + portfolio/mercado SÍ/NO (lo más importante primero) */}
      {isToday && <MarketDigestPanel />}

      {/* 2. Alertas de portfolio urgentes */}
      <PortfolioAlerts symbolFilter={symbolFilter} typeFilter={typeFilter} />
      <ActiveAlerts symbolFilter={symbolFilter} typeFilter={typeFilter} />

      {/* 3. Sectores impactados por noticias (convicción + catalizadores) */}
      {isToday && <SectorImpactsSection />}

      {/* 3b. Mapa macro → sectores (causal + scan + impacto en cartera) */}
      {isToday && <SectorImpactMapPanel />}

      {/* 4. Radar de noticias agregado (top sectores/tickers + portfolio exposure) */}
      {isToday && <RadarSummaryWidget />}

      {/* 5. Rotación sectorial (líderes vs rezagados vs SPY) */}
      {isToday && <SectorRotationWidget />}

      {/* 6. Top noticias del día con triangulación */}
      {isToday && <TopNewsWidget />}

      {/* 7. Earnings próximos 7 días */}
      {isToday && <EarningsWidget />}

      {/* 8. Reporte completo: themes, scenarios, alternatives */}
      <MarketReportSection date={selectedDate} />

      {/* 9. Accuracy + tracking histórico de señales */}
      <AccuracyPanel />
      <TrackingHistory />
    </div>
  );
}
