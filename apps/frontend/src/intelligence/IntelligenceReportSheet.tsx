import { useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { trpc } from '@/shared/trpc';
import { WatchlistButton } from '@/shared/WatchlistButton';

// --- Types ---

interface SecondOrderEffect {
  triggerEvent: string;
  causalChain: string[];
  affectedTickers: string[];
  impactDirection: 'positive' | 'negative' | 'mixed';
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
}

interface AntiHypeResult {
  totalCandidates: number;
  passedAll: number;
  filtered: string[];
  rejected: Array<{ symbol: string; reasons: string[] }>;
  mode: 'strict' | 'relaxed';
}

interface TopRecommendation {
  symbol: string;
  sectorLabel: string;
  currentPrice: number;
  opportunityScore: number;
  action: string;
  confidence: number;
  reasoning: string;
  catalysts: string[];
  risks: string[];
  shortTerm: { midPercent: number };
  mediumTerm: { midPercent: number };
  confluenceDetail?: { direction: 'bullish' | 'bearish' | 'mixed'; confluencePercent: number };
}

interface SectorSummaryItem {
  sector: string;
  label: string;
  symbolCount: number;
  avgScore: number;
  topOpportunity: string | null;
  sectorOutlook: string;
}

// --- Config ---

const impactColors: Record<string, string> = {
  positive: 'bg-green-500/20 text-green-400 border-green-500/30',
  negative: 'bg-red-500/20 text-red-400 border-red-500/30',
  mixed: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
};

const confidenceBadge: Record<string, { label: string; cls: string }> = {
  high: { label: 'Alta', cls: 'bg-green-600 text-white' },
  medium: { label: 'Media', cls: 'bg-yellow-600 text-white' },
  low: { label: 'Baja', cls: 'bg-red-600 text-white' },
};

const actionColors: Record<string, string> = {
  BUY: 'bg-green-500/20 text-green-400',
  SELL: 'bg-red-500/20 text-red-400',
  HOLD: 'bg-yellow-500/20 text-yellow-400',
  WATCH: 'bg-blue-500/20 text-blue-400',
};

// --- Sub-components ---

function SourceStatsBar({ stats, total }: { stats: Record<string, number>; total: number }) {
  const entries = Object.entries(stats).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return null;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {entries.map(([source, count]) => (
        <div key={source} className="flex items-center gap-1">
          <div className="h-1.5 w-1.5 rounded-full bg-primary" />
          <span className="text-[10px] text-muted-foreground">{source}: <span className="font-mono font-medium text-foreground">{count}</span></span>
        </div>
      ))}
      <span className="text-[10px] font-mono text-muted-foreground ml-1">({total} total)</span>
    </div>
  );
}

function SecondOrderCard({ effect }: { effect: SecondOrderEffect }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="border-l-2 border-l-blue-500 bg-card rounded-md px-3 py-2 cursor-pointer hover:bg-muted/50 transition-colors"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Badge className={`text-[9px] shrink-0 ${impactColors[effect.impactDirection]}`}>
            {effect.impactDirection === 'positive' ? '📈' : effect.impactDirection === 'negative' ? '📉' : '↔️'}
          </Badge>
          <span className="text-xs font-medium truncate">{effect.triggerEvent}</span>
        </div>
        <Badge className={`text-[9px] shrink-0 ${confidenceBadge[effect.confidence].cls}`}>
          {confidenceBadge[effect.confidence].label}
        </Badge>
      </div>

      {expanded && (
        <div className="mt-2 space-y-2 pl-2">
          {effect.causalChain.map((step, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <span className="text-[9px] text-muted-foreground mt-0.5">{i + 1}.</span>
              <span className="text-[11px]">{step}</span>
            </div>
          ))}

          <div className="flex gap-1 flex-wrap">
            {effect.affectedTickers.map((t) => (
              <Badge key={t} variant="outline" className="text-[9px] font-mono h-4">{t}</Badge>
            ))}
          </div>

          <p className="text-[10px] text-muted-foreground italic">{effect.reasoning}</p>
        </div>
      )}
    </div>
  );
}

function RecommendationRow({ opp, rank }: { opp: TopRecommendation; rank: number }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="bg-card rounded-md px-3 py-2 cursor-pointer hover:bg-muted/50 transition-colors"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-bold text-muted-foreground w-5 text-right">{rank}</span>
        <span className="font-mono font-semibold text-sm">{opp.symbol}</span>
        <Badge className={`text-[9px] ${actionColors[opp.action] ?? ''}`}>{opp.action}</Badge>
        <span className="text-[10px] text-muted-foreground truncate flex-1">{opp.sectorLabel}</span>
        <span onClick={(e) => e.stopPropagation()}>
          <WatchlistButton symbol={opp.symbol} />
        </span>
        <span className="text-sm font-mono font-semibold">{opp.opportunityScore}</span>
      </div>

      {expanded && (
        <div className="mt-2 pt-2 border-t space-y-2 pl-7">
          <p className="text-[11px]">{opp.reasoning}</p>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="text-[9px] text-muted-foreground">Catalizadores</span>
              {opp.catalysts?.map((c, i) => (
                <p key={i} className="text-[10px] text-green-400">+ {c}</p>
              ))}
            </div>
            <div>
              <span className="text-[9px] text-muted-foreground">Riesgos</span>
              {opp.risks?.map((r, i) => (
                <p key={i} className="text-[10px] text-red-400">- {r}</p>
              ))}
            </div>
          </div>

          <div className="flex gap-3 text-[9px] text-muted-foreground">
            <span>CP: {opp.shortTerm.midPercent > 0 ? '+' : ''}{opp.shortTerm.midPercent}%</span>
            <span>MP: {opp.mediumTerm.midPercent > 0 ? '+' : ''}{opp.mediumTerm.midPercent}%</span>
            <span className={opp.confidence >= 70 ? 'text-green-400' : opp.confidence >= 50 ? 'text-yellow-400' : 'text-red-400'}>
              Conf: {opp.confidence}%{opp.confluenceDetail ? ` (${opp.confluenceDetail.direction === 'bullish' ? '↑' : opp.confluenceDetail.direction === 'bearish' ? '↓' : '↔'})` : ''}
            </span>
            <span>${opp.currentPrice?.toFixed(2)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Main Sheet ---

export function IntelligenceReportSheet() {
  const [open, setOpen] = useState(false);

  const { data: report, isLoading } = trpc.intelligence.dailyReport.useQuery(undefined, {
    enabled: open,
    staleTime: 0, // siempre refetch al abrir
  });

  const secondOrderEffects = (report?.secondOrderEffects ?? []) as SecondOrderEffect[];
  const antiHype = report?.antiHypeResults as AntiHypeResult | undefined;
  const topRecs = (report?.topRecommendations ?? []) as TopRecommendation[];
  const sectors = (report?.sectorSummary ?? []) as SectorSummaryItem[];
  const sourceStats = (report?.newsSourceStats ?? {}) as Record<string, number>;
  const triStats = (report?.triangulationStats ?? {}) as Record<string, number>;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <SheetTrigger asChild>
            <Button size="sm" variant="outline" className="text-[11px] h-7 px-2.5 gap-1">
              Reporte IA
            </Button>
          </SheetTrigger>
        </TooltipTrigger>
        <TooltipContent>Ver reporte de inteligencia: fuentes, triangulacion, efectos de segundo orden, filtros anti-hype y top recomendaciones.</TooltipContent>
      </Tooltip>

      <SheetContent side="right" className="w-[700px] sm:max-w-[700px] p-0">
        <SheetHeader className="px-4 py-3 border-b">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-base">Reporte de Inteligencia</SheetTitle>
            {report && (
              <Badge variant="outline" className="text-[9px]">
                {new Date(report.generatedAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
              </Badge>
            )}
          </div>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-60px)]">
          {isLoading ? (
            <div className="p-4 text-sm text-muted-foreground">
              Generando reporte de inteligencia...
            </div>
          ) : !report ? (
            <div className="p-4 space-y-2">
              <p className="text-sm text-muted-foreground">No hay reporte disponible.</p>
              <p className="text-xs text-muted-foreground">Presiona <span className="font-medium text-foreground">Actualizar</span> en Oportunidades para generar un reporte de inteligencia.</p>
            </div>
          ) : (
            <div className="p-4 space-y-4">

              {/* --- Fuentes de noticias --- */}
              <div>
                <h3 className="text-[11px] font-medium text-muted-foreground mb-1.5">Fuentes de Noticias</h3>
                <SourceStatsBar stats={sourceStats} total={report.totalNewsCount} />
                <div className="flex items-center gap-1.5 mt-1.5">
                  <span className="text-[10px] text-muted-foreground">Triangulacion:</span>
                  <Badge className="text-[9px] bg-green-600 text-white h-4">{triStats.high ?? 0} alta</Badge>
                  <Badge className="text-[9px] bg-yellow-600 text-white h-4">{triStats.medium ?? 0} media</Badge>
                  <Badge className="text-[9px] bg-red-600 text-white h-4">{triStats.low ?? 0} baja</Badge>
                </div>
              </div>

              <Separator />

              {/* --- Efectos de segundo orden --- */}
              {secondOrderEffects.length > 0 && (
                <div>
                  <h3 className="text-[11px] font-medium text-muted-foreground mb-1.5">
                    Efectos de Segundo Orden ({secondOrderEffects.length})
                  </h3>
                  <div className="space-y-1.5">
                    {secondOrderEffects.map((effect, i) => (
                      <SecondOrderCard key={i} effect={effect} />
                    ))}
                  </div>
                </div>
              )}

              {secondOrderEffects.length > 0 && <Separator />}

              {/* --- Filtros Anti-Hype --- */}
              {antiHype && (
                <div>
                  <h3 className="text-[11px] font-medium text-muted-foreground mb-1.5">Filtros Anti-Hype</h3>
                  <div className="flex items-center gap-2 mb-2">
                    <Badge className="text-[9px] bg-green-500/20 text-green-400 h-4">{antiHype.passedAll} pasaron</Badge>
                    <Badge className="text-[9px] bg-red-500/20 text-red-400 h-4">{antiHype.rejected.length} rechazados</Badge>
                    <span className="text-[9px] text-muted-foreground">
                      (2 de 3: SMA200, RSI 30-75{antiHype.mode === 'strict' ? ', Vol > 100%' : ''}) [{antiHype.mode === 'strict' ? 'estricto' : 'sin volumen'}]
                    </span>
                  </div>
                  <div className="flex gap-1 flex-wrap">
                    {antiHype.filtered.map((s) => (
                      <Badge key={s} variant="outline" className="text-[9px] font-mono h-4 bg-green-500/10">{s}</Badge>
                    ))}
                  </div>
                  {antiHype.rejected.length > 0 && (
                    <details className="mt-1.5">
                      <summary className="text-[10px] text-muted-foreground cursor-pointer hover:text-foreground">
                        Ver {antiHype.rejected.length} rechazados
                      </summary>
                      <div className="flex gap-1 flex-wrap mt-1">
                        {antiHype.rejected.map((r) => (
                          <Tooltip key={r.symbol}>
                            <TooltipTrigger asChild>
                              <Badge variant="outline" className="text-[9px] font-mono h-4 opacity-40 cursor-help">{r.symbol}</Badge>
                            </TooltipTrigger>
                            <TooltipContent>{r.reasons.join(', ')}</TooltipContent>
                          </Tooltip>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              )}

              <Separator />

              {/* --- Resumen sectorial --- */}
              <div>
                <h3 className="text-[11px] font-medium text-muted-foreground mb-1.5">Sectores ({sectors.length})</h3>
                <div className="grid grid-cols-2 gap-1.5">
                  {sectors.map((s) => {
                    const scoreColor = s.avgScore >= 55 ? 'text-green-500' : s.avgScore >= 40 ? 'text-yellow-500' : 'text-muted-foreground';
                    return (
                      <div key={s.sector} className="bg-card rounded px-2 py-1.5 border">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-medium truncate">{s.label}</span>
                          <span className={`text-[10px] font-mono font-semibold ${scoreColor}`}>{s.avgScore}</span>
                        </div>
                        <div className="flex items-center gap-1 mt-0.5">
                          <span className="text-[8px] text-muted-foreground">{s.symbolCount} activos</span>
                          {s.topOpportunity && (
                            <Badge variant="outline" className="text-[7px] h-3">{s.topOpportunity}</Badge>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <Separator />

              {/* --- Top recomendaciones --- */}
              <div>
                <h3 className="text-[11px] font-medium text-muted-foreground mb-1.5">
                  Top {topRecs.length} Recomendaciones
                </h3>
                <div className="space-y-1.5">
                  {topRecs.map((opp, i) => (
                    <RecommendationRow key={opp.symbol} opp={opp} rank={i + 1} />
                  ))}
                </div>
                {topRecs.length === 0 && (
                  <p className="text-[10px] text-muted-foreground">Ningun activo paso los filtros anti-hype.</p>
                )}
              </div>

              {/* Footer */}
              <div className="text-[9px] text-muted-foreground text-right pt-2">
                {report.analysisDetail} · {report.totalSymbolsScanned} activos · {report.reportDate}
              </div>
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
