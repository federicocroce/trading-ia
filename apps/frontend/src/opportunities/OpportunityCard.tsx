import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { WatchlistButton } from '@/shared/WatchlistButton';
import { SymbolLink } from '@/shared/SymbolLink';
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
  // R/R real contra la primera resistencia — distinto del R/R contra el target lejano.
  rrToFirstResistance?: number | null;
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
  entryScore?: number;
  radarInfluence?: {
    bonus: number;
    sources: string[];
    conflict?: string;
  };
  evidenceInfluence?: {
    score: number;        // -100..+100
    drivers: string[];    // razones humanas
    conviction: 'high' | 'medium' | 'low' | 'none';
    activeSignals: number;
    hasData: boolean;
  };
  verdict?: {
    finalAction: SignalAction;
    layers: {
      algoAction: SignalAction;
      algoScore: number;
      smartAction: SignalAction;
      smartReason?: string;
      llmAction?: SignalAction;
      llmReason?: string;
    };
    trace: string[];
    source: 'algo' | 'smart' | 'llm';
  };
  axisVeto?: {
    type: string;
    axis: 'sentiment' | 'fundamental' | 'technical' | 'evidence';
    value: number;
    threshold: number;
    forcedAction: SignalAction;
    reason: string;
  };
  macroAdjustment?: {
    delta: number;
    drivers: Array<{
      eventId: string;
      event: string;
      category: string;
      direction: 'positive' | 'negative';
      impact: 'direct' | 'indirect';
    }>;
  };
  crossConflicts?: Array<{
    type: string;
    severity: 'high' | 'medium' | 'low';
    axes: Array<'technical' | 'fundamental' | 'sentiment' | 'evidence'>;
    explanation: string;
    suggestion: string;
  }>;
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
    // "BAJISTA" (no "VENDER") — esto es la lectura del motor, no tu orden.
    // "VENDER" queda reservado a la pestaña Hoy, que decide por tu stop dinámico.
    label: 'BAJISTA',
    emoji: '↓',
    borderColor: 'border-l-red-500',
    bgClass: 'bg-red-500/20',
    textClass: 'text-red-400',
    description: 'El motor ve deterioro técnico. Es análisis, no una orden — tu decisión de vender está en "Hoy" (la toma tu stop dinámico).',
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

function scoreBarColor(value: number): string {
  if (value >= 75) return 'bg-green-500';
  if (value >= 60) return 'bg-yellow-400';
  if (value >= 40) return 'bg-orange-500';
  return 'bg-red-500';
}

function scoreTextColor(value: number): string {
  if (value >= 75) return 'text-green-400';
  if (value >= 60) return 'text-yellow-400';
  if (value >= 40) return 'text-orange-400';
  return 'text-red-400';
}

function OpportunityScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[9px] text-muted-foreground uppercase w-12 text-right shrink-0">{label}</span>
      <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${scoreBarColor(value)}`}
          style={{ width: `${value}%` }}
        />
      </div>
      <span className={`text-[11px] font-bold font-mono w-7 text-right ${scoreTextColor(value)}`}>
        {value}
      </span>
    </div>
  );
}

export function OpportunityCard({ opportunity, forceExpanded = false }: { opportunity: Opportunity; forceExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const isExpanded = expanded || forceExpanded;
  const cfg = actionConfig[opportunity.action] ?? actionConfig['WATCH'];
  const tl = opportunity.tradeLevels;

  // Paridad con Hoy (regla #4): si el motor dice BUY pero Hoy lo degradó (crónico / stop
  // perforado), esta card lo AVISA — misma verdad en las dos tabs, sin sorpresas cruzadas.
  // Query compartida con la vista Hoy (react-query dedupea; no agrega requests).
  const { data: todayView } = trpc.opportunities.today.useQuery(undefined, { staleTime: 60_000 });
  const hoyEntry = opportunity.action === 'BUY'
    ? todayView?.opportunities.find((o) => o.symbol === opportunity.symbol)
    : undefined;
  const degradadaEnHoy = hoyEntry != null && hoyEntry.verb !== 'OPERABLE';
  const razonDegradacion = hoyEntry?.cooldownCaveat ?? hoyEntry?.persistenceCaveat ?? null;

  return (
    <Card className={`border-l-4 ${cfg.borderColor} transition-all`}>
      <CardContent className="py-3 px-3 space-y-2">

        {/* ── HERO ROW — always visible ── */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Symbol + price */}
          <div className="flex items-center gap-1.5 shrink-0">
            {opportunity.inPortfolio && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-[9px] font-bold text-blue-400 bg-blue-500/10 rounded px-1 cursor-help">P</span>
                </TooltipTrigger>
                <TooltipContent>En tu portfolio ({opportunity.portfolioQuantity} unidades)</TooltipContent>
              </Tooltip>
            )}
            <SymbolLink symbol={opportunity.symbol} className="font-bold text-sm" />
            <span className="text-xs text-muted-foreground font-mono">
              ${opportunity.currentPrice.toFixed(2)}
            </span>
            <WatchlistButton
              symbol={opportunity.symbol}
              entry={{
                price: opportunity.currentPrice,
                action: opportunity.action,
                score: opportunity.opportunityScore,
                confidence: opportunity.confidence,
                targetPrice: opportunity.tradeLevels?.takeProfit ?? null,
                stopLoss: opportunity.tradeLevels?.stopLoss ?? null,
                thesis: opportunity.tradeLevels?.entryReason ?? opportunity.simpleReasoning ?? null,
              }}
            />
          </div>

          {/* Scores: Señal + Entrada */}
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex flex-col gap-1 cursor-help shrink-0">
                {/* El score compuesto queda DENTRO del drilldown expandido, junto a la cadena de
                    decisión que explica cómo el motor llegó a la acción. Ahí audita, no rankea:
                    ninguna superficie lo usa para ordenar ni lo muestra como titular (§4). */}
                <OpportunityScoreBar label="Señal (no ordena — ver cadena de decisión)" value={opportunity.opportunityScore} />
                {opportunity.entryScore != null && (
                  <OpportunityScoreBar label="Entrada" value={opportunity.entryScore} />
                )}
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p><strong>Señal:</strong> fuerza de las señales técnicas, fundamentales y de sentimiento.</p>
              <p><strong>Entrada:</strong> calidad del momento de entrada (RSI, R/R, conflictos, timing).</p>
            </TooltipContent>
          </Tooltip>

          {/* Action badge */}
          <Tooltip>
            <TooltipTrigger asChild>
              <span className={`text-xs font-bold px-2 py-0.5 rounded cursor-help shrink-0 ${cfg.bgClass} ${cfg.textClass}`}>
                {cfg.emoji} {cfg.label}
              </span>
            </TooltipTrigger>
            <TooltipContent>{cfg.description}</TooltipContent>
          </Tooltip>

          {/* Paridad con Hoy: BUY del motor degradado por reglas medidas → avisar acá también */}
          {degradadaEnHoy && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded cursor-help shrink-0 bg-amber-500/20 text-amber-400">
                  En Hoy: {hoyEntry!.verb} (degradada)
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {razonDegradacion ?? 'Degradada en Hoy por una regla de disciplina medida.'}
              </TooltipContent>
            </Tooltip>
          )}

          {/* Confidence */}
          <ConfidenceBar percent={opportunity.confidence} />

          {/* Conviction tier */}
          {opportunity.convictionTier && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className={`text-[9px] px-1.5 py-0.5 rounded border cursor-help shrink-0 ${
                  opportunity.convictionTier === 'strong' ? 'border-green-500/40 text-green-400' :
                  opportunity.convictionTier === 'speculative' ? 'border-yellow-500/40 text-yellow-400' :
                  'border-border text-muted-foreground'
                }`}>
                  {opportunity.convictionTier === 'strong' ? 'Alta convicción' :
                   opportunity.convictionTier === 'speculative' ? 'Especulativo' : 'Estándar'}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {opportunity.convictionTier === 'strong' ? 'Múltiples señales confluyen fuertemente.' :
                 opportunity.convictionTier === 'speculative' ? 'Señales débiles o contradictorias, mayor riesgo.' :
                 'Señales moderadas, riesgo estándar.'}
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* ── TRADE LEVELS — always visible if present ── */}
        {tl && (
          <div className="flex items-center gap-3 flex-wrap text-xs font-mono border-t border-border pt-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-help">
                  <span className="text-muted-foreground text-[9px] mr-1">Entry</span>
                  <span className="text-foreground font-semibold">${tl.entryPrice.toFixed(2)}</span>
                </span>
              </TooltipTrigger>
              <TooltipContent>{tl.entryReason}</TooltipContent>
            </Tooltip>
            <span className="text-border">·</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-help">
                  <span className="text-muted-foreground text-[9px] mr-1">Stop</span>
                  <span className="text-trading-red font-semibold">${tl.stopLoss.toFixed(2)}</span>
                </span>
              </TooltipTrigger>
              <TooltipContent>{tl.stopReason}</TooltipContent>
            </Tooltip>
            <span className="text-border">·</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-help">
                  <span className="text-muted-foreground text-[9px] mr-1">Target</span>
                  <span className="text-trading-green font-semibold">${tl.takeProfit.toFixed(2)}</span>
                </span>
              </TooltipTrigger>
              <TooltipContent>{tl.targetReason}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-help text-muted-foreground">
                  R/R <span className="text-foreground">{tl.riskRewardRatio.toFixed(1)}x</span>
                  {/* R/R honesto: si la 1ra resistencia da un R/R distinto al del target lejano,
                      mostrar ambos — el target puede no ser lo primero que "cobra" el precio. */}
                  {tl.rrToFirstResistance != null && Math.abs(tl.rrToFirstResistance - tl.riskRewardRatio) >= 0.1 && (
                    <span className="text-amber-400/80"> (a 1ª resistencia {tl.rrToFirstResistance.toFixed(1)}x)</span>
                  )}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                Risk/Reward ratio contra el target. Mayor a 2x es favorable.
                {tl.rrToFirstResistance != null && Math.abs(tl.rrToFirstResistance - tl.riskRewardRatio) >= 0.1 &&
                  ' El R/R a la 1ª resistencia es el que probablemente se cobra primero — el target lejano puede tardar más en validarse.'}
              </TooltipContent>
            </Tooltip>
            {tl.suggestedAmount && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="cursor-help text-muted-foreground">
                    Tamaño <span className="text-foreground">${tl.suggestedAmount.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
                  </span>
                </TooltipTrigger>
                <TooltipContent>{tl.sizingReason ?? 'Tamaño sugerido de posición'}</TooltipContent>
              </Tooltip>
            )}
          </div>
        )}

        {/* ── RETURN ESTIMATES ── */}
        {(opportunity.shortTerm || opportunity.mediumTerm) && (
          <div className="flex items-center gap-4">
            {opportunity.shortTerm && (
              <div className="flex-1">
                <ReturnEstimateBar estimate={opportunity.shortTerm} label="Corto plazo" />
              </div>
            )}
            {opportunity.mediumTerm && (
              <div className="flex-1">
                <ReturnEstimateBar estimate={opportunity.mediumTerm} label="Mediano plazo" />
              </div>
            )}
          </div>
        )}

        {/* ── REASONING ── */}
        {(opportunity.simpleReasoning ?? opportunity.reasoning) && (
          <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
            {opportunity.simpleReasoning ?? opportunity.reasoning}
          </p>
        )}

        {/* ── AXIS VETO BADGE ── */}
        {opportunity.axisVeto && (
          <div className="flex items-start gap-1.5 px-2 py-1 rounded border text-[10px] bg-red-500/10 text-red-400 border-red-500/30">
            <span className="font-mono shrink-0">🚫</span>
            <div className="flex-1 min-w-0">
              <span className="font-semibold">
                Veto {opportunity.axisVeto.axis} ({opportunity.axisVeto.value.toFixed(0)})
              </span>
              <div className="text-[9px] mt-0.5 opacity-90">{opportunity.axisVeto.reason}</div>
            </div>
          </div>
        )}

        {/* ── MACRO ADJUSTMENT BADGE ── */}
        {opportunity.macroAdjustment && opportunity.macroAdjustment.delta !== 0 && (() => {
          const ma = opportunity.macroAdjustment;
          const isPositive = ma.delta > 0;
          const colorCls = isPositive
            ? 'bg-blue-500/10 text-blue-400 border-blue-500/30'
            : 'bg-orange-500/10 text-orange-400 border-orange-500/30';
          return (
            <div className={`flex items-start gap-1.5 px-2 py-1 rounded border text-[10px] ${colorCls}`}>
              <span className="font-mono shrink-0">🌐</span>
              <div className="flex-1 min-w-0">
                <span className="font-semibold">
                  Macro {isPositive ? '+' : ''}{ma.delta} al score
                </span>
                <div className="text-[9px] mt-0.5 opacity-90">
                  {ma.drivers.slice(0, 2).map(d => `${d.direction === 'positive' ? '+' : '−'}${d.event} (${d.impact})`).join(' · ')}
                </div>
              </div>
            </div>
          );
        })()}

        {/* ── CROSS-CONFLICT BADGES ── */}
        {opportunity.crossConflicts && opportunity.crossConflicts.length > 0 && (
          <div className="space-y-1">
            {opportunity.crossConflicts.map((c, i) => {
              const sevColor = c.severity === 'high' ? 'bg-red-500/10 text-red-300 border-red-500/30' :
                              c.severity === 'medium' ? 'bg-orange-500/10 text-orange-300 border-orange-500/30' :
                              'bg-yellow-500/10 text-yellow-300 border-yellow-500/30';
              return (
                <div key={i} className={`flex items-start gap-1.5 px-2 py-1 rounded border text-[10px] ${sevColor}`}>
                  <span className="font-mono shrink-0">⚡</span>
                  <div className="flex-1 min-w-0">
                    <span className="font-semibold uppercase">{c.severity}</span>
                    <span className="ml-1 opacity-90">{c.explanation}</span>
                    <div className="text-[9px] mt-0.5 italic opacity-80">→ {c.suggestion}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── RADAR INFLUENCE BADGE ── */}
        {opportunity.radarInfluence && opportunity.radarInfluence.bonus !== 0 && (() => {
          const ri = opportunity.radarInfluence;
          const isPositive = ri.bonus > 0;
          const colorCls = ri.conflict
            ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30'
            : isPositive
              ? 'bg-trading-green/10 text-trading-green border-trading-green/30'
              : 'bg-trading-red/10 text-trading-red border-trading-red/30';
          return (
            <div className={`flex items-start gap-1.5 px-2 py-1 rounded border text-[10px] ${colorCls}`}>
              <span className="font-mono shrink-0">📡</span>
              <div className="flex-1 min-w-0">
                <span className="font-semibold">
                  Radar {isPositive ? '+' : ''}{ri.bonus.toFixed(1)}
                </span>
                <span className="ml-1.5 opacity-80">{ri.sources.join(' · ')}</span>
                {ri.conflict && (
                  <div className="text-[9px] mt-0.5 opacity-90">⚠ Conflicto: {ri.conflict}</div>
                )}
              </div>
            </div>
          );
        })()}

        {/* ── EXPAND TOGGLE ── */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-[10px] text-muted-foreground hover:text-foreground transition-colors border-t border-border pt-2 w-full text-left"
        >
          {expanded ? '▲ Menos detalle' : '▼ Más detalle — catalizadores, riesgos, breakdown TA/FA'}
        </button>

        {/* ── EXPANDED DETAIL ── */}
        {isExpanded && (
          <div className="space-y-3">
            {/* Breakdown 4 ejes: Técnico · Fundamental · Sentimiento · Evidencia */}
            {opportunity.breakdown && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                {[
                  { label: 'Técnico', data: opportunity.breakdown.technical, sig: taSignalLabel[opportunity.breakdown.technical.signal] },
                  { label: 'Fundamental', data: opportunity.breakdown.fundamental, sig: faSignalLabel[opportunity.breakdown.fundamental.signal] },
                  { label: 'Sentimiento', data: opportunity.breakdown.sentiment, sig: sentimentLabel[opportunity.breakdown.sentiment.signal] },
                ].map(({ label, data, sig }) => (
                  <div key={label} className="space-y-1">
                    <p className="text-[9px] text-muted-foreground uppercase tracking-wider">{label}</p>
                    <p className="text-[10px] font-medium">{sig}</p>
                    <ScoreBar score={data.score} tooltip={`${label}: ${data.keyFactors.join(', ')}`} />
                    <ul className="space-y-0.5">
                      {data.keyFactors.slice(0, 2).map((f, i) => (
                        <li key={i} className="text-[9px] text-muted-foreground truncate">{f}</li>
                      ))}
                    </ul>
                  </div>
                ))}

                {/* Cuarto eje: Evidencia (PEAD, insider, options flow, sector momentum) */}
                <div className="space-y-1">
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Evidencia</p>
                  {opportunity.evidenceInfluence?.hasData ? (
                    <>
                      <p className="text-[10px] font-medium">
                        {opportunity.evidenceInfluence.conviction === 'high' ? '🟢 Alta' :
                         opportunity.evidenceInfluence.conviction === 'medium' ? '🟡 Media' :
                         opportunity.evidenceInfluence.conviction === 'low' ? '🟠 Baja' : '⚪ Sin señal'}
                        {' '}({opportunity.evidenceInfluence.activeSignals}/3)
                      </p>
                      <ScoreBar
                        score={opportunity.evidenceInfluence.score}
                        tooltip={`Evidence: ${opportunity.evidenceInfluence.drivers.join(' · ')}`}
                      />
                      <ul className="space-y-0.5">
                        {opportunity.evidenceInfluence.drivers.slice(0, 3).map((d, i) => (
                          <li key={i} className="text-[9px] text-muted-foreground truncate" title={d}>{d}</li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <>
                      <p className="text-[10px] text-muted-foreground italic">Sin datos</p>
                      <p className="text-[9px] text-muted-foreground">
                        No hay PEAD, insider trades ni unusual options para este símbolo en la última corrida.
                      </p>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Cadena de decisión: algo → smart → llm */}
            {opportunity.verdict && (
              <div className="rounded-md bg-muted/30 border border-border/50 px-2 py-1.5 space-y-1">
                <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Cadena de decisión</p>
                <div className="flex items-center gap-1 flex-wrap">
                  {opportunity.verdict.trace.map((step, i) => (
                    <span key={i} className="text-[9px] font-mono">
                      {i > 0 && <span className="text-muted-foreground mx-1">→</span>}
                      <span className={
                        step.startsWith('algo:') ? 'text-blue-300' :
                        step.startsWith('veto:') ? 'text-red-300' :
                        step.startsWith('smart:') ? 'text-yellow-300' :
                        step.startsWith('llm:sugirió') ? 'text-amber-300' :
                        step.startsWith('llm:') ? 'text-green-300' : 'text-foreground'
                      }>{step}</span>
                    </span>
                  ))}
                </div>
                <p className="text-[9px] text-muted-foreground">
                  Veredicto final: <span className="text-foreground font-semibold">{opportunity.verdict.finalAction}</span>
                  {' · '}fuente: <span className="text-foreground">{opportunity.verdict.source}</span>
                </p>
              </div>
            )}

            {/* Catalysts & Risks */}
            {(opportunity.catalysts?.length || opportunity.risks?.length) ? (
              <div className="grid grid-cols-2 gap-2">
                {opportunity.catalysts?.length ? (
                  <div>
                    <p className="text-[9px] text-muted-foreground uppercase mb-1">Catalizadores</p>
                    <ul className="space-y-0.5">
                      {opportunity.catalysts.slice(0, 3).map((c, i) => (
                        <li key={i} className="text-[9px] text-green-400">↑ {c}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {opportunity.risks?.length ? (
                  <div>
                    <p className="text-[9px] text-muted-foreground uppercase mb-1">Riesgos</p>
                    <ul className="space-y-0.5">
                      {opportunity.risks.slice(0, 3).map((r, i) => (
                        <li key={i} className="text-[9px] text-red-400">↓ {r}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* Deep analysis */}
            {opportunity.deepAnalysis && (
              <div className="space-y-2 border-t border-border pt-2">
                <p className="text-[9px] text-muted-foreground uppercase font-semibold">Deep Analysis IA</p>
                {opportunity.deepAnalysis.positives?.length ? (
                  <div>
                    <p className="text-[9px] text-green-400 font-medium mb-0.5">Lo bueno</p>
                    <ul className="space-y-0.5">
                      {opportunity.deepAnalysis.positives.map((p, i) => (
                        <li key={i} className="text-[10px] text-muted-foreground">· {p}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {opportunity.deepAnalysis.concerns?.length ? (
                  <div>
                    <p className="text-[9px] text-red-400 font-medium mb-0.5">Lo preocupante</p>
                    <ul className="space-y-0.5">
                      {opportunity.deepAnalysis.concerns.map((c, i) => (
                        <li key={i} className="text-[10px] text-muted-foreground">· {c}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {opportunity.deepAnalysis.recommendation && (
                  <div>
                    <p className="text-[9px] text-blue-400 font-medium mb-0.5">Recomendación</p>
                    <p className="text-[10px] text-muted-foreground">{opportunity.deepAnalysis.recommendation}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
