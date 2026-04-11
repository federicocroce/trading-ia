import { useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { trpc } from '@/shared/trpc';
import { ReturnEstimateBar } from './ReturnEstimateBar';

type TASignal = 'bullish' | 'bearish' | 'neutral';
type FASignal = 'undervalued' | 'overvalued' | 'fair';
type Sentiment = 'positive' | 'negative' | 'neutral';
type SignalAction = 'BUY' | 'SELL' | 'HOLD' | 'WATCH';

interface AnalysisBreakdown {
  technical: { signal: TASignal; score: number; keyFactors: string[] };
  fundamental: { signal: FASignal; score: number; keyFactors: string[] };
  sentiment: { signal: Sentiment; score: number; keyFactors: string[] };
}

interface ReturnEstimate {
  lowPercent: number;
  midPercent: number;
  highPercent: number;
  confidence: number;
  keyDrivers: string[];
}

interface ConfluenceDetail {
  bullishSignals: string[];
  bearishSignals: string[];
  neutralSignals: string[];
  confluencePercent: number;
  direction: 'bullish' | 'bearish' | 'mixed';
}

interface TradeLevels {
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  riskRewardRatio: number;
  entryReason: string;
  stopReason: string;
  targetReason: string;
  suggestedQuantity?: number;
  suggestedAmount?: number;
  sizingReason?: string;
}

interface SignalConflict {
  signalA: string;
  signalB: string;
  directionA: 'bullish' | 'bearish';
  directionB: 'bullish' | 'bearish';
  explanation: string;
  implication: 'wait' | 'caution' | 'confirm';
}

interface TimingTrigger {
  type: string;
  description: string;
  estimatedDays: number | null;
  impact: 'high' | 'medium';
}

interface TimingView {
  action: 'BUY' | 'SELL' | 'WAIT';
  timing: 'now' | 'soon' | 'approaching';
  confidence: number;
  triggers: TimingTrigger[];
}

interface DivergenceSignal {
  type: 'bullish' | 'bearish';
  indicator: 'rsi' | 'macd' | 'obv';
  timeframe: 'daily' | 'weekly';
  description: string;
}

interface WeeklyAnalysis {
  rsi14: number | null;
  macd: { macdLine: number; signalLine: number; histogram: number } | null;
  sma20: number | null;
  sma50: number | null;
  trend: 'up' | 'down' | 'sideways';
  divergences: DivergenceSignal[];
}

interface Opportunity {
  symbol: string;
  sector: string;
  sectorLabel: string;
  currentPrice: number;
  opportunityScore: number;
  action: SignalAction;
  technicalAction?: SignalAction;
  fundamentalAction?: SignalAction;
  sentimentAction?: SignalAction;
  confidence: number;
  shortTerm: ReturnEstimate;
  mediumTerm: ReturnEstimate;
  reasoning: string;
  simpleReasoning?: string;
  catalysts: string[];
  risks: string[];
  breakdown: AnalysisBreakdown;
  inPortfolio: boolean;
  portfolioQuantity?: number;
  timestamp: number;
  confluenceDetail?: ConfluenceDetail;
  tradeLevels?: TradeLevels;
  timingView?: TimingView;
  signalConflicts?: SignalConflict[];
  actionCondition?: {
    holdUntil: string;
    reEvaluateAt?: number;
    reEvaluateReason?: string;
    exitAt: number;
    exitReason: string;
    estimatedDays?: number;
  };
  narrativeDigest?: string;
  divergences?: DivergenceSignal[];
  weekly?: WeeklyAnalysis;
  deepAnalysis?: {
    positives: string[];
    concerns: string[];
    recommendation: string;
    wouldDo: string[];
    wouldNotDo: string[];
    generatedBy: string;
  };
  classification?: {
    instrumentType: string;
    sector: string;
    industry: string;
    market: string;
    name: string;
  };
  convictionTier?: 'strong' | 'standard' | 'speculative';
  scoringMethod?: string;
  horizonScores?: { shortTerm: number; mediumTerm: number };
  passedAntiHype?: boolean;
}

const actionConfig: Record<SignalAction, { label: string; emoji: string; borderColor: string; bgClass: string; textClass: string; description: string }> = {
  BUY: {
    label: 'COMPRAR',
    emoji: '↑',
    borderColor: 'border-l-green-500',
    bgClass: 'bg-green-500/20',
    textClass: 'text-green-400',
    description: 'El analisis sugiere que es buen momento para comprar.',
  },
  WATCH: {
    label: 'OBSERVAR',
    emoji: '→',
    borderColor: 'border-l-yellow-500',
    bgClass: 'bg-yellow-500/20',
    textClass: 'text-yellow-400',
    description: 'Tiene potencial pero todavia no es momento de entrar.',
  },
  HOLD: {
    label: 'MANTENER',
    emoji: '=',
    borderColor: 'border-l-blue-500',
    bgClass: 'bg-blue-500/20',
    textClass: 'text-blue-400',
    description: 'Ya lo tenes. No hay senal para comprar mas ni para vender.',
  },
  SELL: {
    label: 'VENDER',
    emoji: '↓',
    borderColor: 'border-l-red-500',
    bgClass: 'bg-red-500/20',
    textClass: 'text-red-400',
    description: 'El analisis sugiere reducir o cerrar esta posicion.',
  },
};

const taSignalLabel: Record<TASignal, string> = { bullish: 'Alcista', bearish: 'Bajista', neutral: 'Neutral' };
const faSignalLabel: Record<FASignal, string> = { undervalued: 'Subvaluado', overvalued: 'Sobrevaluado', fair: 'Justo' };
const sentimentLabel: Record<Sentiment, string> = { positive: 'Positivo', negative: 'Negativo', neutral: 'Neutral' };

function ConfidenceBar({ percent }: { percent: number }) {
  const label = percent >= 70 ? 'Alta' : percent >= 50 ? 'Media' : 'Baja';
  const color = percent >= 70 ? 'bg-green-500' : percent >= 50 ? 'bg-yellow-500' : 'bg-red-500';
  const textColor = percent >= 70 ? 'text-green-400' : percent >= 50 ? 'text-yellow-400' : 'text-red-400';

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-2 cursor-help">
          <span className="text-[10px] text-muted-foreground">Confianza:</span>
          <div className="h-1.5 w-20 rounded-full bg-muted overflow-hidden">
            <div className={`h-full rounded-full ${color}`} style={{ width: `${percent}%` }} />
          </div>
          <span className={`text-[10px] font-semibold ${textColor}`}>{label}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        Confianza {percent}%: {percent >= 70
          ? 'La mayoria de los indicadores apuntan en la misma direccion.'
          : percent >= 50
          ? 'Los indicadores apuntan parcialmente en la misma direccion.'
          : 'Los indicadores se contradicen entre si. Mayor riesgo.'}
      </TooltipContent>
    </Tooltip>
  );
}

function ScoreBar({ score, tooltip }: { score: number; tooltip: string }) {
  const pct = (Math.abs(score) / 100) * 50;
  const isPositive = score > 0;
  const color = isPositive ? 'bg-green-500' : score < 0 ? 'bg-red-500' : 'bg-gray-400';

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-2 cursor-help">
          <div className="h-1.5 w-16 rounded-full bg-muted relative overflow-hidden">
            <div
              className={`absolute top-0 h-full rounded-full ${color}`}
              style={{
                left: isPositive ? '50%' : `${50 - pct}%`,
                width: `${pct}%`,
              }}
            />
            <div className="absolute top-0 left-1/2 h-full w-px bg-border" />
          </div>
          <span className={`text-[9px] font-mono ${isPositive ? 'text-green-500' : score < 0 ? 'text-red-500' : 'text-muted-foreground'}`}>
            {score > 0 ? '+' : ''}{score}
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

function SignalBadge({ action, label, tooltip }: { action: SignalAction; label: string; tooltip: string }) {
  const cfg = actionConfig[action] ?? actionConfig['WATCH'];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex flex-col items-center gap-0.5 cursor-help">
          <span className="text-[8px] text-muted-foreground uppercase tracking-wider">{label}</span>
          <Badge className={`text-[10px] font-bold px-1.5 py-0 h-5 ${cfg.bgClass} ${cfg.textClass}`}>
            {cfg.emoji} {cfg.label}
          </Badge>
        </div>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{tooltip}</TooltipContent>
    </Tooltip>
  );
}

export function OpportunityCard({ opportunity }: { opportunity: Opportunity }) {
  const [showDetail, setShowDetail] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const o = opportunity;
  const bd = o.breakdown;
  const mainAction = o.action;
  const mainAct = actionConfig[mainAction] ?? actionConfig['WATCH'];

  const utils = trpc.useUtils();
  const addToWatchlist = trpc.opportunities.addToWatchlist.useMutation({
    onSuccess: () => {
      utils.opportunities.scan.invalidate();
    },
  });

  return (
    <Card size="sm" className={`border-l-4 ${mainAct.borderColor}`}>
      <CardHeader>
        {/* === HEADER: Símbolo + Señal general + Precio === */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-mono font-semibold">{o.symbol}</span>
            <Badge className={`text-[11px] font-bold px-2 py-0.5 ${mainAct.bgClass} ${mainAct.textClass}`}>
              {mainAct.emoji} {mainAct.label}
            </Badge>
            {o.inPortfolio && (
              <Badge variant="default" className="text-[9px] h-4">
                En portfolio{o.portfolioQuantity ? ` (${o.portfolioQuantity})` : ''}
              </Badge>
            )}
            {o.action === 'BUY' && o.convictionTier === 'strong' && (
              <Badge variant="outline" className="border-trading-green text-trading-green text-xs">
                STRONG
              </Badge>
            )}
            {o.action === 'BUY' && o.convictionTier === 'speculative' && (
              <Badge variant="outline" className="border-yellow-500 text-yellow-500 text-xs">
                SPECULATIVE
              </Badge>
            )}
            {o.passedAntiHype && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className="border-blue-500 text-blue-500 text-xs cursor-help">
                    Verificado
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs text-xs">
                  Pasó los filtros anti-hype (al menos 2 de 3): precio sobre SMA200, RSI sin sobrecompra extrema, y volumen sobre el promedio de 20 días.
                </TooltipContent>
              </Tooltip>
            )}
            {!o.inPortfolio && o.classification && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-5 text-[8px] px-1.5"
                    onClick={() => addToWatchlist.mutate({ symbol: o.symbol })}
                    disabled={addToWatchlist.isPending}
                  >
                    {addToWatchlist.isPending ? '...' : '+ Watchlist'}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Agregar {o.symbol} a tu watchlist permanente</TooltipContent>
              </Tooltip>
            )}
          </div>
          <span className="text-[11px] font-mono text-foreground">${o.currentPrice.toFixed(2)}</span>
        </div>
        <span className="text-[9px] text-muted-foreground">
          {o.classification
            ? `${o.classification.instrumentType === 'cedear' ? 'CEDEAR' : o.classification.instrumentType === 'etf' ? 'ETF' : o.classification.instrumentType === 'crypto' ? 'Crypto' : o.classification.instrumentType === 'bono' ? 'Bono' : o.classification.instrumentType === 'commodity' ? 'Commodity' : 'Acción'} · ${o.classification.sector}`
            : o.sectorLabel}
          {o.classification?.name && o.classification.name !== o.symbol && (
            <span className="text-muted-foreground/50"> — {o.classification.name}</span>
          )}
        </span>
        <div className="flex items-center gap-2">
          {o.timestamp && (
            <span className="text-xs text-muted-foreground">
              {(() => {
                const hours = Math.floor((Date.now() - o.timestamp) / (1000 * 60 * 60));
                return hours < 1 ? 'Analizado hace menos de 1h'
                  : hours < 24 ? `Analizado hace ${hours}h`
                  : `Analizado hace ${Math.floor(hours / 24)}d`;
              })()}
            </span>
          )}
          {o.scoringMethod && (
            <span className="text-xs text-muted-foreground">
              {o.scoringMethod === 'hybrid' ? 'IA + Algo' : o.scoringMethod === 'algorithmic' ? 'Algoritmico' : o.scoringMethod}
            </span>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* === 3 SEÑALES SEPARADAS === */}
        <div className="flex items-center justify-around py-1 rounded-md bg-muted/30">
          <SignalBadge
            action={o.technicalAction ?? o.action}
            label="Tecnico"
            tooltip="Basado en graficos: RSI, MACD, medias moviles, volumen, soportes y resistencias."
          />
          <div className="w-px h-8 bg-border/50" />
          <SignalBadge
            action={o.fundamentalAction ?? 'WATCH'}
            label="Fundamental"
            tooltip="Basado en la empresa: valuacion (P/E), ganancias, dividendos, posicion vs maximo/minimo del ano."
          />
          <div className="w-px h-8 bg-border/50" />
          <SignalBadge
            action={o.sentimentAction ?? 'WATCH'}
            label="Noticias"
            tooltip="Basado en noticias recientes: cantidad, tono positivo/negativo, y consenso entre fuentes."
          />
        </div>

        {/* === NARRATIVA / RAZON === */}
        <p className={`text-xs leading-relaxed ${o.narrativeDigest ? 'text-foreground' : 'text-foreground'}`}>
          {o.narrativeDigest ?? o.simpleReasoning ?? o.reasoning}
        </p>

        {/* === CONFLICTOS DE SENALES === */}
        {o.signalConflicts && o.signalConflicts.length > 0 && (
          <div className="rounded-md bg-amber-500/10 border border-amber-500/20 p-2 space-y-1.5">
            <span className="text-[9px] text-amber-400 uppercase tracking-wider font-medium">Senales en conflicto</span>
            {o.signalConflicts.map((c, i) => (
              <div key={i} className="space-y-0.5">
                <div className="flex items-center gap-1.5">
                  <Badge className="text-[8px] h-4 bg-green-500/20 text-green-400">{c.signalA}</Badge>
                  <span className="text-[9px] text-amber-400">vs</span>
                  <Badge className="text-[8px] h-4 bg-red-500/20 text-red-400">{c.signalB}</Badge>
                  <Badge className={`text-[7px] h-3.5 ${
                    c.implication === 'wait' ? 'bg-amber-500/20 text-amber-400'
                      : c.implication === 'caution' ? 'bg-yellow-500/20 text-yellow-400'
                      : 'bg-blue-500/20 text-blue-400'
                  }`}>
                    {c.implication === 'wait' ? 'ESPERAR' : c.implication === 'caution' ? 'PRECAUCION' : 'CONFIRMAR'}
                  </Badge>
                </div>
                <p className="text-[9px] text-amber-300/80 leading-snug">{c.explanation}</p>
              </div>
            ))}
          </div>
        )}

        {/* === CONFIANZA === */}
        <ConfidenceBar percent={o.confidence} />

        {/* === RENDIMIENTOS SIMPLIFICADOS === */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <span className="text-[9px] text-muted-foreground uppercase tracking-wider">Corto plazo</span>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className={`text-sm font-mono font-bold ${o.shortTerm.midPercent > 0 ? 'text-green-400' : o.shortTerm.midPercent < 0 ? 'text-red-400' : 'text-muted-foreground'}`}>
                {o.shortTerm.midPercent > 0 ? '+' : ''}{o.shortTerm.midPercent}%
              </span>
              <span className="text-[9px] text-muted-foreground">estimado</span>
            </div>
            <span className="text-[9px] text-muted-foreground/60">
              (entre {o.shortTerm.lowPercent > 0 ? '+' : ''}{o.shortTerm.lowPercent}% y {o.shortTerm.highPercent > 0 ? '+' : ''}{o.shortTerm.highPercent}%)
            </span>
          </div>
          <div>
            <span className="text-[9px] text-muted-foreground uppercase tracking-wider">Mediano plazo</span>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className={`text-sm font-mono font-bold ${o.mediumTerm.midPercent > 0 ? 'text-green-400' : o.mediumTerm.midPercent < 0 ? 'text-red-400' : 'text-muted-foreground'}`}>
                {o.mediumTerm.midPercent > 0 ? '+' : ''}{o.mediumTerm.midPercent}%
              </span>
              <span className="text-[9px] text-muted-foreground">estimado</span>
            </div>
            <span className="text-[9px] text-muted-foreground/60">
              (entre {o.mediumTerm.lowPercent > 0 ? '+' : ''}{o.mediumTerm.lowPercent}% y {o.mediumTerm.highPercent > 0 ? '+' : ''}{o.mediumTerm.highPercent}%)
            </span>
          </div>
        </div>

        {/* === EXPANDABLE DETAILS === */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setExpanded(!expanded)}
          className="w-full text-xs text-muted-foreground h-7"
        >
          {expanded ? 'Ver menos' : 'Ver mas detalles'}
        </Button>

        {expanded && <>
        {/* === TRADE LEVELS (entry / stop / target) === */}
        {o.tradeLevels && (
          <div className="rounded-md bg-muted/30 p-2 space-y-1.5">
            <span className="text-[9px] text-muted-foreground uppercase tracking-wider font-medium">Niveles de operacion</span>
            <div className="grid grid-cols-3 gap-2 text-center">
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="cursor-help">
                    <span className="text-[8px] text-muted-foreground block">Entrada</span>
                    <span className="text-[11px] font-mono font-semibold text-blue-400">${o.tradeLevels.entryPrice.toFixed(2)}</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">{o.tradeLevels.entryReason}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="cursor-help">
                    <span className="text-[8px] text-muted-foreground block">Stop Loss</span>
                    <span className="text-[11px] font-mono font-semibold text-red-400">${o.tradeLevels.stopLoss.toFixed(2)}</span>
                    <span className="text-[8px] text-red-400/60 block">
                      ({(((o.tradeLevels.stopLoss - o.tradeLevels.entryPrice) / o.tradeLevels.entryPrice) * 100).toFixed(1)}%)
                    </span>
                  </div>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">{o.tradeLevels.stopReason}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="cursor-help">
                    <span className="text-[8px] text-muted-foreground block">Take Profit</span>
                    <span className="text-[11px] font-mono font-semibold text-green-400">${o.tradeLevels.takeProfit.toFixed(2)}</span>
                    <span className="text-[8px] text-green-400/60 block">
                      ({(((o.tradeLevels.takeProfit - o.tradeLevels.entryPrice) / o.tradeLevels.entryPrice) * 100).toFixed(1)}%)
                    </span>
                  </div>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">{o.tradeLevels.targetReason}</TooltipContent>
              </Tooltip>
            </div>
            <div className="flex items-center justify-center gap-2">
              <span className="text-[8px] text-muted-foreground">R/B:</span>
              <span className={`text-[9px] font-mono font-semibold ${o.tradeLevels.riskRewardRatio >= 2 ? 'text-green-400' : o.tradeLevels.riskRewardRatio >= 1 ? 'text-yellow-400' : 'text-red-400'}`}>
                1:{o.tradeLevels.riskRewardRatio.toFixed(1)}
              </span>
              {o.tradeLevels.suggestedQuantity && o.tradeLevels.suggestedQuantity > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-[9px] font-mono text-blue-400 cursor-help">
                      {o.tradeLevels.suggestedQuantity} acc. (~${o.tradeLevels.suggestedAmount?.toLocaleString()})
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">{o.tradeLevels.sizingReason}</TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>
        )}

        {/* === DIVERGENCES (highlighted separately from timing) === */}
        {o.divergences && o.divergences.length > 0 && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 space-y-1">
            <span className="text-[9px] text-amber-400 uppercase tracking-wider font-medium">
              Divergencias detectadas
            </span>
            {o.divergences.map((d, i) => (
              <div key={i} className="flex items-start gap-1.5">
                <span className={`text-[9px] font-mono font-bold mt-0.5 ${d.type === 'bullish' ? 'text-green-400' : 'text-red-400'}`}>
                  {d.type === 'bullish' ? '+' : '-'}
                </span>
                <div className="flex-1">
                  <span className="text-[10px] text-foreground leading-tight">{d.description}</span>
                  <div className="flex gap-1 mt-0.5">
                    <Badge className={`text-[7px] h-3 ${d.timeframe === 'weekly' ? 'bg-blue-500/20 text-blue-400' : 'bg-muted text-muted-foreground'}`}>
                      {d.timeframe === 'weekly' ? 'Semanal' : 'Diario'}
                    </Badge>
                    <Badge className={`text-[7px] h-3 ${d.indicator === 'rsi' ? 'bg-purple-500/20 text-purple-400' : d.indicator === 'macd' ? 'bg-cyan-500/20 text-cyan-400' : 'bg-muted text-muted-foreground'}`}>
                      {d.indicator.toUpperCase()}
                    </Badge>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* === WEEKLY ANALYSIS (compact) === */}
        {o.weekly && (
          <div className="rounded-md bg-muted/30 p-2 space-y-1">
            <span className="text-[9px] text-muted-foreground uppercase tracking-wider font-medium">Analisis semanal</span>
            <div className="flex items-center gap-3 text-[10px]">
              <span className={`font-medium ${o.weekly.trend === 'up' ? 'text-green-400' : o.weekly.trend === 'down' ? 'text-red-400' : 'text-muted-foreground'}`}>
                Tendencia: {o.weekly.trend === 'up' ? 'Alcista' : o.weekly.trend === 'down' ? 'Bajista' : 'Lateral'}
              </span>
              {o.weekly.rsi14 != null && (
                <span className={`font-mono ${o.weekly.rsi14 < 30 ? 'text-green-400' : o.weekly.rsi14 > 70 ? 'text-red-400' : 'text-muted-foreground'}`}>
                  RSI: {o.weekly.rsi14.toFixed(0)}
                </span>
              )}
              {o.weekly.macd && (
                <span className={`font-mono ${o.weekly.macd.histogram > 0 ? 'text-green-400' : 'text-red-400'}`}>
                  MACD: {o.weekly.macd.histogram > 0 ? '+' : ''}{o.weekly.macd.histogram.toFixed(2)}
                </span>
              )}
            </div>
          </div>
        )}

        {/* === TIMING TRIGGERS === */}
        {o.timingView && o.timingView.triggers.length > 0 && (
          <div className="rounded-md bg-muted/30 p-2 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[9px] text-muted-foreground uppercase tracking-wider font-medium">Timing</span>
              <Badge className={`text-[8px] h-4 ${
                o.timingView.timing === 'now' ? 'bg-green-500/20 text-green-400'
                  : o.timingView.timing === 'soon' ? 'bg-yellow-500/20 text-yellow-400'
                  : 'bg-blue-500/20 text-blue-400'
              }`}>
                {o.timingView.timing === 'now' ? 'Ahora' : o.timingView.timing === 'soon' ? 'Pronto' : 'Acercandose'}
              </Badge>
            </div>
            <div className="space-y-1">
              {o.timingView.triggers.slice(0, 3).map((t, i) => (
                <div key={i} className="flex items-start gap-1.5">
                  <span className={`text-[8px] mt-0.5 ${t.impact === 'high' ? 'text-yellow-400' : 'text-muted-foreground/60'}`}>
                    {t.impact === 'high' ? '!' : '-'}
                  </span>
                  <span className="text-[10px] text-muted-foreground leading-tight">
                    {t.description}
                    {t.estimatedDays != null && (
                      <span className="text-[9px] text-blue-400 ml-1">(~{t.estimatedDays}d)</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* === ACTION CONDITION (hasta cuándo, qué esperar) === */}
        {o.actionCondition && (
          <div className="rounded-md bg-muted/30 p-2 space-y-1">
            <span className="text-[9px] text-muted-foreground uppercase tracking-wider font-medium">Condiciones</span>
            <p className="text-[10px] text-foreground">{o.actionCondition.holdUntil}</p>
            {o.actionCondition.reEvaluateReason && (
              <p className="text-[10px] text-blue-400">{o.actionCondition.reEvaluateReason}</p>
            )}
            <p className="text-[10px] text-red-400">{o.actionCondition.exitReason}</p>
            {o.actionCondition.estimatedDays != null && (
              <span className="text-[9px] text-muted-foreground">Estimado: ~{o.actionCondition.estimatedDays} dias</span>
            )}
          </div>
        )}

        {/* === A FAVOR / EN CONTRA (simple) === */}
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-0.5">
            <span className="text-[9px] text-green-500 uppercase tracking-wider font-medium">A favor</span>
            {o.catalysts.map((c, i) => (
              <p key={i} className="text-[10px] text-muted-foreground">{c}</p>
            ))}
          </div>
          <div className="space-y-0.5">
            <span className="text-[9px] text-red-500 uppercase tracking-wider font-medium">En contra</span>
            {o.risks.map((r, i) => (
              <p key={i} className="text-[10px] text-muted-foreground">{r}</p>
            ))}
          </div>
        </div>

        {/* === DETALLE TECNICO (colapsado) === */}
        {/* === DEEP ANALYSIS (expandible) === */}
        {o.deepAnalysis && (
          <div className="space-y-2 border-t border-border/50 pt-2">
            <div className="grid grid-cols-2 gap-2">
              {/* Lo bueno */}
              <div className="rounded-md bg-green-500/5 border border-green-500/20 p-2">
                <span className="text-[8px] text-green-400 uppercase tracking-wider font-medium">Lo bueno</span>
                <div className="space-y-0.5 mt-1">
                  {o.deepAnalysis.positives.map((p, i) => (
                    <p key={i} className="text-[9px] text-foreground leading-snug">- {p}</p>
                  ))}
                </div>
              </div>
              {/* Lo preocupante */}
              <div className="rounded-md bg-red-500/5 border border-red-500/20 p-2">
                <span className="text-[8px] text-red-400 uppercase tracking-wider font-medium">Lo preocupante</span>
                <div className="space-y-0.5 mt-1">
                  {o.deepAnalysis.concerns.map((c, i) => (
                    <p key={i} className="text-[9px] text-foreground leading-snug">- {c}</p>
                  ))}
                </div>
              </div>
            </div>
            {/* Recomendación */}
            <div className="rounded-md bg-blue-500/5 border border-blue-500/20 p-2">
              <span className="text-[8px] text-blue-400 uppercase tracking-wider font-medium">Recomendacion</span>
              <p className="text-[10px] text-foreground leading-relaxed mt-0.5">{o.deepAnalysis.recommendation}</p>
            </div>
            {/* Lo que haría / no haría */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-[8px] text-green-400 uppercase tracking-wider font-medium">Lo que haria</span>
                {o.deepAnalysis.wouldDo.map((w, i) => (
                  <p key={i} className="text-[9px] text-muted-foreground mt-0.5">- {w}</p>
                ))}
              </div>
              <div>
                <span className="text-[8px] text-red-400 uppercase tracking-wider font-medium">Lo que NO haria</span>
                {o.deepAnalysis.wouldNotDo.map((w, i) => (
                  <p key={i} className="text-[9px] text-muted-foreground mt-0.5">- {w}</p>
                ))}
              </div>
            </div>
            <span className="text-[7px] text-muted-foreground/40">Generado por {o.deepAnalysis.generatedBy}</span>
          </div>
        )}

        {/* === DETALLE TECNICO (colapsado) === */}
        <button
          className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
          onClick={() => setShowDetail(!showDetail)}
        >
          {showDetail ? '- Ocultar detalle tecnico' : '+ Ver detalle tecnico'}
        </button>

        {showDetail && (
          <div className="space-y-2 border-t border-border/50 pt-2 text-[9px]">
            {/* Score general */}
            <div className="flex items-center justify-between text-muted-foreground">
              <span>Score general: {o.opportunityScore}/100</span>
              {o.confluenceDetail && (
                <span>Confluencia: {o.confluenceDetail.confluencePercent}% ({o.confluenceDetail.direction === 'bullish' ? 'alcista' : o.confluenceDetail.direction === 'bearish' ? 'bajista' : 'mixta'})</span>
              )}
            </div>

            {/* Technical */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground uppercase tracking-wider">Tecnico</span>
                <Badge variant="outline" className="text-[8px] h-3.5">{taSignalLabel[bd.technical.signal]}</Badge>
              </div>
              <ScoreBar score={bd.technical.score} tooltip={`Score tecnico: ${bd.technical.score > 0 ? '+' : ''}${bd.technical.score}/100`} />
              <div className="flex flex-wrap gap-1">
                {bd.technical.keyFactors.map((f, i) => (
                  <span key={i} className="text-muted-foreground">{f}{i < bd.technical.keyFactors.length - 1 ? ' · ' : ''}</span>
                ))}
              </div>
            </div>

            {/* Fundamental */}
            {!(bd.fundamental.keyFactors.length === 1 && bd.fundamental.keyFactors[0].includes('crypto')) && (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground uppercase tracking-wider">Fundamental</span>
                  <Badge variant="outline" className="text-[8px] h-3.5">{faSignalLabel[bd.fundamental.signal]}</Badge>
                </div>
                <ScoreBar score={bd.fundamental.score} tooltip={`Score fundamental: ${bd.fundamental.score > 0 ? '+' : ''}${bd.fundamental.score}/100`} />
                <div className="flex flex-wrap gap-1">
                  {bd.fundamental.keyFactors.map((f, i) => (
                    <span key={i} className="text-muted-foreground">{f}{i < bd.fundamental.keyFactors.length - 1 ? ' · ' : ''}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Sentiment */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground uppercase tracking-wider">Sentimiento</span>
                <Badge variant="outline" className="text-[8px] h-3.5">{sentimentLabel[bd.sentiment.signal]}</Badge>
              </div>
              <ScoreBar score={bd.sentiment.score} tooltip={`Score sentimiento: ${bd.sentiment.score > 0 ? '+' : ''}${bd.sentiment.score}/100`} />
              <div className="space-y-0.5">
                {bd.sentiment.keyFactors.slice(0, 2).map((f, i) => (
                  <p key={i} className="text-muted-foreground truncate">{f}</p>
                ))}
              </div>
            </div>

            {/* Confluence detail */}
            {o.confluenceDetail && (
              <div className="space-y-1 border-t border-border/30 pt-1.5">
                <span className="text-muted-foreground uppercase tracking-wider">Senales de confluencia</span>
                <div className="grid grid-cols-2 gap-2">
                  {o.confluenceDetail.bullishSignals.length > 0 && (
                    <div className="space-y-0.5">
                      <span className="text-[8px] text-green-500 font-medium">A favor ({o.confluenceDetail.bullishSignals.length})</span>
                      {o.confluenceDetail.bullishSignals.map((s, i) => (
                        <p key={i} className="text-muted-foreground">{s}</p>
                      ))}
                    </div>
                  )}
                  {o.confluenceDetail.bearishSignals.length > 0 && (
                    <div className="space-y-0.5">
                      <span className="text-[8px] text-red-500 font-medium">En contra ({o.confluenceDetail.bearishSignals.length})</span>
                      {o.confluenceDetail.bearishSignals.map((s, i) => (
                        <p key={i} className="text-muted-foreground">{s}</p>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Reasoning técnico original */}
            <p className="text-muted-foreground/60 italic pt-1">{o.reasoning}</p>
          </div>
        )}
        </>}
      </CardContent>
    </Card>
  );
}
