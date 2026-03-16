import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
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

interface Opportunity {
  symbol: string;
  sector: string;
  sectorLabel: string;
  currentPrice: number;
  opportunityScore: number;
  action: SignalAction;
  confidence: number;
  shortTerm: ReturnEstimate;
  mediumTerm: ReturnEstimate;
  reasoning: string;
  catalysts: string[];
  risks: string[];
  breakdown: AnalysisBreakdown;
  inPortfolio: boolean;
  portfolioQuantity?: number;
  timestamp: number;
}

const taSignalLabel: Record<TASignal, string> = { bullish: 'Alcista', bearish: 'Bajista', neutral: 'Neutral' };
const faSignalLabel: Record<FASignal, string> = { undervalued: 'Subvaluado', overvalued: 'Sobrevaluado', fair: 'Justo' };
const sentimentLabel: Record<Sentiment, string> = { positive: 'Positivo', negative: 'Negativo', neutral: 'Neutral' };

const actionConfig: Record<SignalAction, { label: string; borderColor: string; badgeClass: string; tooltip: string }> = {
  BUY: {
    label: 'COMPRAR',
    borderColor: 'border-l-green-500',
    badgeClass: 'bg-green-500/20 text-green-400 border-green-500/30',
    tooltip: 'Score >= 60. Analisis sugiere buena oportunidad de compra.',
  },
  WATCH: {
    label: 'OBSERVAR',
    borderColor: 'border-l-yellow-500',
    badgeClass: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    tooltip: 'Score 40-59, no en portfolio. Potencial, pero esperar mejor punto de entrada.',
  },
  HOLD: {
    label: 'MANTENER',
    borderColor: 'border-l-blue-500',
    badgeClass: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    tooltip: 'Score 40-59, en portfolio. Mantener posicion actual, sin senal clara para comprar mas.',
  },
  SELL: {
    label: 'VENDER',
    borderColor: 'border-l-red-500',
    badgeClass: 'bg-red-500/20 text-red-400 border-red-500/30',
    tooltip: 'Score < 40, en portfolio. Considerar reducir o cerrar posicion.',
  },
};

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

export function OpportunityCard({ opportunity }: { opportunity: Opportunity }) {
  const [showBreakdown, setShowBreakdown] = useState(false);
  const o = opportunity;
  const bd = o.breakdown;
  const act = actionConfig[o.action] ?? actionConfig['WATCH'];

  return (
    <Card size="sm" className={`border-l-4 ${act.borderColor}`}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm font-mono">{o.symbol}</CardTitle>
            {/* Action badge */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge className={`text-[10px] font-semibold cursor-help ${act.badgeClass}`}>
                  {act.label}
                </Badge>
              </TooltipTrigger>
              <TooltipContent>{act.tooltip}</TooltipContent>
            </Tooltip>
            {o.inPortfolio ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="default" className="text-[9px] h-4 cursor-help">En portfolio</Badge>
                </TooltipTrigger>
                <TooltipContent>Ya tenes {o.portfolioQuantity ?? '?'} unidades de {o.symbol} en tu portfolio.</TooltipContent>
              </Tooltip>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className="text-[9px] h-4 cursor-help">No tengo</Badge>
                </TooltipTrigger>
                <TooltipContent>No tenes {o.symbol} en tu portfolio actualmente.</TooltipContent>
              </Tooltip>
            )}
          </div>
          <div className="text-right">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-[11px] font-mono text-foreground cursor-help">${o.currentPrice.toFixed(2)}</span>
              </TooltipTrigger>
              <TooltipContent>Precio actual de mercado de {o.symbol}.</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="text-[9px] text-muted-foreground cursor-help">Score: {o.opportunityScore}/100</div>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                Score de oportunidad (0-100). Combina analisis tecnico, fundamental y sentimiento. {'>'}=60: COMPRAR, 40-59: OBSERVAR/MANTENER, {'<'}40: VENDER (si en portfolio) u OBSERVAR.
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="text-[9px] text-muted-foreground cursor-help">{o.sectorLabel}</span>
          </TooltipTrigger>
          <TooltipContent>Sector: {o.sectorLabel} ({o.sector})</TooltipContent>
        </Tooltip>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Reasoning */}
        <p className="text-xs text-foreground leading-relaxed">{o.reasoning}</p>

        {/* Return Estimates */}
        <div className="grid grid-cols-2 gap-3">
          <ReturnEstimateBar estimate={o.shortTerm} label="Rendimiento 1-4 sem" />
          <ReturnEstimateBar estimate={o.mediumTerm} label="Rendimiento 1-6 mes" />
        </div>

        {/* Catalysts & Risks */}
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-[9px] text-green-500 uppercase tracking-wider font-medium cursor-help">Por que comprar</span>
              </TooltipTrigger>
              <TooltipContent>Factores positivos que podrian impulsar el precio al alza.</TooltipContent>
            </Tooltip>
            {o.catalysts.map((c, i) => (
              <p key={i} className="text-[10px] text-muted-foreground">{c}</p>
            ))}
          </div>
          <div className="space-y-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-[9px] text-red-500 uppercase tracking-wider font-medium cursor-help">Riesgos</span>
              </TooltipTrigger>
              <TooltipContent>Factores negativos que podrian afectar el precio.</TooltipContent>
            </Tooltip>
            {o.risks.map((r, i) => (
              <p key={i} className="text-[10px] text-muted-foreground">{r}</p>
            ))}
          </div>
        </div>

        {/* Toggle breakdown */}
        <button
          className="text-[10px] text-muted-foreground hover:text-foreground transition-colors underline"
          onClick={() => setShowBreakdown(!showBreakdown)}
        >
          {showBreakdown ? 'Ocultar detalle tecnico' : 'Ver detalle tecnico'}
        </button>

        {showBreakdown && (
          <div className="space-y-2 border-t pt-2">
            {/* Technical */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-[9px] text-muted-foreground uppercase tracking-wider cursor-help">Tecnico</span>
                  </TooltipTrigger>
                  <TooltipContent>Analisis de indicadores tecnicos: RSI, MACD, medias moviles, volumen.</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="outline" className="text-[8px] h-3.5 cursor-help">{taSignalLabel[bd.technical.signal]}</Badge>
                  </TooltipTrigger>
                  <TooltipContent>
                    Senal tecnica: {bd.technical.signal === 'bullish' ? 'Alcista — momentum positivo' : bd.technical.signal === 'bearish' ? 'Bajista — momentum negativo' : 'Sin tendencia clara'}
                  </TooltipContent>
                </Tooltip>
              </div>
              <ScoreBar score={bd.technical.score} tooltip={`Score tecnico: ${bd.technical.score > 0 ? '+' : ''}${bd.technical.score}/100. ${bd.technical.score > 20 ? 'Momentum positivo fuerte' : bd.technical.score > 0 ? 'Leve momentum positivo' : bd.technical.score < -20 ? 'Momentum negativo fuerte' : bd.technical.score < 0 ? 'Leve momentum negativo' : 'Neutral'}.`} />
              <div className="flex flex-wrap gap-1">
                {bd.technical.keyFactors.map((f, i) => (
                  <span key={i} className="text-[9px] text-muted-foreground">{f}{i < bd.technical.keyFactors.length - 1 ? ' · ' : ''}</span>
                ))}
              </div>
            </div>

            {/* Fundamental */}
            {!(bd.fundamental.keyFactors.length === 1 && bd.fundamental.keyFactors[0].includes('crypto')) && (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="text-[9px] text-muted-foreground uppercase tracking-wider cursor-help">Fundamental</span>
                    </TooltipTrigger>
                    <TooltipContent>Analisis de valuacion: P/E, EPS, dividendos, capitalizacion.</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge variant="outline" className="text-[8px] h-3.5 cursor-help">{faSignalLabel[bd.fundamental.signal]}</Badge>
                    </TooltipTrigger>
                    <TooltipContent>
                      {bd.fundamental.signal === 'undervalued' ? 'Subvaluado — precio por debajo de su valor estimado' : bd.fundamental.signal === 'overvalued' ? 'Sobrevaluado — precio por encima de su valor estimado' : 'Precio justo respecto a fundamentales'}
                    </TooltipContent>
                  </Tooltip>
                </div>
                <ScoreBar score={bd.fundamental.score} tooltip={`Score fundamental: ${bd.fundamental.score > 0 ? '+' : ''}${bd.fundamental.score}/100. ${bd.fundamental.score > 15 ? 'Valuacion atractiva' : bd.fundamental.score > 0 ? 'Valuacion razonable' : bd.fundamental.score < -15 ? 'Valuacion elevada' : bd.fundamental.score < 0 ? 'Ligeramente caro' : 'Precio justo'}.`} />
                <div className="flex flex-wrap gap-1">
                  {bd.fundamental.keyFactors.map((f, i) => (
                    <span key={i} className="text-[9px] text-muted-foreground">{f}{i < bd.fundamental.keyFactors.length - 1 ? ' · ' : ''}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Sentiment */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-[9px] text-muted-foreground uppercase tracking-wider cursor-help">Sentimiento</span>
                  </TooltipTrigger>
                  <TooltipContent>Analisis de noticias y sentimiento del mercado sobre este activo.</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="outline" className="text-[8px] h-3.5 cursor-help">{sentimentLabel[bd.sentiment.signal]}</Badge>
                  </TooltipTrigger>
                  <TooltipContent>
                    {bd.sentiment.signal === 'positive' ? 'Noticias y sentimiento favorables' : bd.sentiment.signal === 'negative' ? 'Noticias y sentimiento desfavorables' : 'Sin sesgo claro en noticias'}
                  </TooltipContent>
                </Tooltip>
              </div>
              <ScoreBar score={bd.sentiment.score} tooltip={`Score sentimiento: ${bd.sentiment.score > 0 ? '+' : ''}${bd.sentiment.score}/100. Basado en noticias recientes y tendencia del mercado.`} />
              <div className="space-y-0.5">
                {bd.sentiment.keyFactors.slice(0, 2).map((f, i) => (
                  <p key={i} className="text-[9px] text-muted-foreground truncate">{f}</p>
                ))}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
