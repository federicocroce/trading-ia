import { useState } from 'react';
import { usePrintSection } from '@/shared/usePrintSection';
import { printWithTitle } from '@/shared/printWithTitle';
import { TabInfo, InfoSection } from '@/shared/TabInfo';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { trpc } from '@/shared/trpc';
import { OpportunityCard } from './OpportunityCard';
import { AntiHypeRejectionsPanel } from './AntiHypeRejectionsPanel';
import { SectorFilter } from './SectorFilter';
import { IntelligenceReportSheet } from '@/intelligence/IntelligenceReportSheet';
import { usePipeline } from '@/pipeline/usePipeline';
import { useAiModeModal } from '@/shared/AiModeModal';

type OpportunitySector = 'argentina-energy' | 'argentina-finance' | 'us-energy' | 'us-tech' | 'crypto';

interface SectorSummary {
  sector: OpportunitySector;
  label: string;
  symbolCount: number;
  avgScore: number;
  topOpportunity: string | null;
  sectorOutlook: string;
}

// Coherencia con Hoy (2026-07-27): el score dejó de rankear porque, medido contra sortear
// del mismo universo, no informa (A−D −0.79%, t=−1.50). Acá se sacan las DOS superficies
// que lo usaban como ranking —el promedio por sector y el "Top:" del sector— y queda solo
// el conteo, que es un hecho. El score sigue visible DENTRO del drilldown de cada card,
// donde explica cómo el motor llegó a la acción; eso no es rankear, es auditar.
function SectorSummaryCard({ summary }: { summary: SectorSummary }) {
  return (
    <Card size="sm">
      <CardContent className="py-2 px-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium">{summary.label}</span>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <p className="text-[9px] text-muted-foreground truncate mt-0.5 cursor-help">{summary.sectorOutlook}</p>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">{summary.sectorOutlook}</TooltipContent>
        </Tooltip>
        <div className="flex items-center gap-2 mt-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-[9px] text-muted-foreground cursor-help">{summary.symbolCount} activos</span>
            </TooltipTrigger>
            <TooltipContent>Cantidad de activos analizados en este sector.</TooltipContent>
          </Tooltip>
        </div>
      </CardContent>
    </Card>
  );
}

export function OpportunityDashboard() {
  const today = new Date().toISOString().slice(0, 10);
  const [selectedDate, setSelectedDate] = useState(today);
  const [selectedSectors, setSelectedSectors] = useState<OpportunitySector[]>([]);
  const [actionFilter, setActionFilter] = useState<'BUY' | 'SELL' | 'WATCH' | null>(null);
  const [portfolioFilter, setPortfolioFilter] = useState(false);
  const [allExpanded, setAllExpanded] = useState(false);
  const [symbolFilter, setSymbolFilter] = useState('');
  const [instrumentFilter, setInstrumentFilter] = useState<string | null>(null);
  usePrintSection('opportunity-dashboard-print');
  const utils = trpc.useUtils();

  const isToday = selectedDate === today;

  const { data: scanDates = [] } = trpc.opportunities.scanDates.useQuery(undefined, { staleTime: 5 * 60_000 });
  const dates = scanDates.includes(today) ? scanDates : [today, ...scanDates];

  const { data: liveData, isLoading: liveLoading } = trpc.opportunities.scan.useQuery(undefined, { enabled: isToday });
  const { data: historicalData, isLoading: histLoading } = trpc.opportunities.scanByDate.useQuery(
    { date: selectedDate },
    { enabled: !isToday, staleTime: 30 * 60_000 }
  );

  const data = isToday ? liveData : historicalData;
  const isLoading = isToday ? liveLoading : histLoading;
  const { isRunning } = usePipeline();
  const { selectMode, modal } = useAiModeModal();
  const refresh = trpc.opportunities.refresh.useMutation({
    onSuccess: () => utils.opportunities.scan.invalidate(),
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-2">
        <div className="text-muted-foreground">
          Escaneando oportunidades en 5 sectores...
        </div>
        <p className="text-[11px] text-muted-foreground">
          Primera vez puede tardar ~20 segundos (obteniendo datos de ~28 activos)
        </p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-6 text-muted-foreground">
        No se pudieron obtener oportunidades.
      </div>
    );
  }

  const opportunities = data.opportunities as Array<{
    symbol: string;
    sector: string;
    sectorLabel: string;
    currentPrice: number;
    opportunityScore: number;
    action: 'BUY' | 'SELL' | 'HOLD' | 'WATCH';
    technicalAction?: 'BUY' | 'SELL' | 'HOLD' | 'WATCH';
    fundamentalAction?: 'BUY' | 'SELL' | 'HOLD' | 'WATCH';
    sentimentAction?: 'BUY' | 'SELL' | 'HOLD' | 'WATCH';
    confidence: number;
    shortTerm: { lowPercent: number; midPercent: number; highPercent: number; confidence: number; keyDrivers: string[] };
    mediumTerm: { lowPercent: number; midPercent: number; highPercent: number; confidence: number; keyDrivers: string[] };
    reasoning: string;
    catalysts: string[];
    risks: string[];
    breakdown: {
      technical: { signal: 'bullish' | 'bearish' | 'neutral'; score: number; keyFactors: string[] };
      fundamental: { signal: 'undervalued' | 'overvalued' | 'fair'; score: number; keyFactors: string[] };
      sentiment: { signal: 'positive' | 'negative' | 'neutral'; score: number; keyFactors: string[] };
    };
    inPortfolio: boolean;
    portfolioQuantity?: number;
    timestamp: number;
    classification?: {
      instrumentType: string;
      sector: string;
      industry: string;
      market: string;
      name: string;
    };
  }>;

  const sectorSummaries = (data.sectorSummary ?? []) as SectorSummary[];
  const buyCount = opportunities.filter((o) => o.action === 'BUY').length;
  const sellCount = opportunities.filter((o) => o.action === 'SELL').length;
  const watchCount = opportunities.filter((o) => o.action === 'WATCH' || o.action === 'HOLD').length;
  const inPortfolioCount = opportunities.filter((o) => o.inPortfolio).length;

  const engine = (data as Record<string, unknown>).analysisEngine as string | undefined;
  const engineDetail = (data as Record<string, unknown>).analysisDetail as string | undefined;
  const source = (data as Record<string, unknown>).source as 'live' | 'db' | undefined;
  const isAI = engine === 'lmstudio' || engine === 'groq' || engine === 'claude' || engine === 'openrouter' || engine === 'hybrid';
  const isFromDB = source === 'db';

  const engineBadgeMap: Record<string, { label: string; class: string }> = {
    hybrid: { label: 'Hibrido', class: 'bg-teal-500/20 text-teal-400 border-teal-500/30' },
    lmstudio: { label: 'LM Studio (Local)', class: 'bg-green-500/20 text-green-400 border-green-500/30' },
    groq: { label: 'Groq IA', class: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
    openrouter: { label: 'OpenRouter IA', class: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30' },
    claude: { label: 'Claude IA', class: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  };
  const engineBadge = engineBadgeMap[engine ?? ''] ?? { label: 'Algoritmico', class: 'bg-orange-500/20 text-orange-400 border-orange-500/30' };

  return (
    <div id="opportunity-dashboard-print" className="p-6 space-y-4">
      <TabInfo>
        <InfoSection title="Qué muestra">
          Scanner de oportunidades con drilldown completo por activo. Cada card muestra la acción final (BUY/SELL/HOLD/WATCH), el score compuesto, la cadena de decisión que llevó a esa acción, los 4 ejes de análisis con drivers concretos, conflictos detectados, ajuste macro y niveles de trade.
        </InfoSection>
        <InfoSection title="Score compuesto — 4 ejes">
          <strong>Técnico</strong> (RSI, MACD, SMA, divergencias) · <strong>Fundamental</strong> (P/E, growth, ROE, deuda) · <strong>Sentimiento</strong> (noticias triangulación + radar) · <strong>Evidencia</strong> (PEAD, insider buying, unusual options, sector momentum). Pesos por horizonte: short-term prioriza técnico+sentimiento+evidencia, medium-term prioriza fundamental+técnico+evidencia.
        </InfoSection>
        <InfoSection title="Cadena de decisión trazable">
          Cada card muestra <strong>cómo</strong> se llegó a la acción final: por ejemplo <code>algo:BUY(72) → smart:WATCH (div bajista) → llm:BUY</code>. Capas: <strong>algo</strong> (score puro + scoreToAction) → <strong>veto por eje</strong> (sent crítico, fund muy débil) → <strong>smart override</strong> (divergencias técnicas anticipan reversión) → <strong>LLM</strong> (Stage 5b con thesis). La capa que mandó al final se indica como "fuente".
        </InfoSection>
        <InfoSection title="Badges visuales">
          🚫 <strong>Veto</strong>: un eje extremo cambió la acción (sent &lt; -60, fund &lt; -40 + tech débil, etc).<br />
          🌐 <strong>Macro</strong>: ajuste -15..+15 al score por causalChains del día.<br />
          ⚡ <strong>Cross-conflict</strong>: disonancia entre ejes (tech bullish vs fund débil = value trap, smart money antes del tape, hype sin confirmación, etc).<br />
          📡 <strong>Radar</strong>: bonus/penalty de sentimiento por noticias del radar.
        </InfoSection>
        <InfoSection title="Filtros">
          Por acción (BUY/SELL/WATCH), por sector, por tipo de instrumento (Acciones/ETFs/Crypto/Bonos), solo portfolio. El badge verde en la tab = cantidad de BUYs activos. Score sectorial = promedio del sector.
        </InfoSection>
      </TabInfo>
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">Oportunidades</h2>
          {/* Engine indicator */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge className={`text-[10px] cursor-help ${engineBadge.class}`}>
                {engineBadge.label}
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <div className="space-y-1">
                <p className="font-semibold">Motor de analisis: {engineDetail ?? engine}</p>
                {engine === 'hybrid' ? (
                  <p>Scoring algoritmico ponderado por horizonte (corto y mediano plazo) + enriquecimiento de reasoning via LM Studio local.</p>
                ) : isAI ? (
                  <p>Los scores, rendimientos y recomendaciones fueron generados por inteligencia artificial analizando datos tecnicos, fundamentales y sentimiento de cada activo.</p>
                ) : (
                  <p>Analisis basado en reglas algoritmicas (RSI, SMA, P/E). LM Studio no estaba disponible al momento del escaneo.</p>
                )}
              </div>
            </TooltipContent>
          </Tooltip>
          {/* Source indicator */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge className={`text-[10px] cursor-help ${isFromDB ? 'bg-slate-500/20 text-slate-400 border-slate-500/30' : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'}`}>
                {isFromDB ? 'BD' : 'Live'}
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              {isFromDB
                ? 'Datos recuperados de la base de datos (ultimo escaneo de hoy). Presiona Actualizar para ejecutar un nuevo analisis con IA.'
                : 'Datos obtenidos en tiempo real en este escaneo.'}
            </TooltipContent>
          </Tooltip>
          {/* Last update time inline */}
          <span className="text-[10px] text-muted-foreground">
            {new Date(data.scannedAt).toLocaleString('es-AR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
          </span>
          {/* Recalcular button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={async () => {
                  const mode = await selectMode();
                  if (!mode) return;
                  refresh.mutate({ aiMode: mode });
                }}
                disabled={refresh.isPending || isRunning}
                className="text-[10px] px-2 py-0.5 rounded border border-border/50 text-muted-foreground hover:text-foreground hover:border-border transition-colors disabled:opacity-40"
              >
                {isRunning ? 'Pipeline corriendo...' : refresh.isPending ? 'Recalculando...' : 'Recalcular'}
              </button>
            </TooltipTrigger>
            <TooltipContent>Fuerza un nuevo escaneo completo con los datos actuales. Tarda ~30 segundos.</TooltipContent>
          </Tooltip>
          {/* Intelligence Report Sheet */}
          <IntelligenceReportSheet />
        </div>
        <div className="flex items-center gap-2">
          <select
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="h-7 rounded border border-border/50 bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
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
          <input
            type="text"
            placeholder="Filtrar simbolo..."
            value={symbolFilter}
            onChange={(e) => setSymbolFilter(e.target.value.toUpperCase())}
            className="h-7 w-32 rounded border border-border/50 bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <button
            onClick={() => setAllExpanded((v) => !v)}
            title={allExpanded ? 'Colapsar todas' : 'Expandir todas'}
            className="h-7 px-2 rounded border border-border/50 text-[10px] text-muted-foreground hover:text-foreground hover:border-border transition-colors"
          >
            {allExpanded ? '▲ Colapsar' : '▼ Expandir'}
          </button>
          <button
            onClick={() => printWithTitle('oportunidades', selectedDate)}
            title="Imprimir / Guardar como PDF"
            className="h-7 px-2 rounded border border-border/50 text-[10px] text-muted-foreground hover:text-foreground hover:border-border transition-colors flex items-center gap-1"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            PDF
          </button>
          {buyCount > 0 && (
            <Badge
              className={`text-[10px] cursor-pointer transition-all ${actionFilter === 'BUY' ? 'bg-green-500/40 text-green-300 ring-1 ring-green-500' : 'bg-green-500/20 text-green-400 hover:bg-green-500/30'}`}
              onClick={() => setActionFilter(actionFilter === 'BUY' ? null : 'BUY')}
            >
              {buyCount} Comprar
            </Badge>
          )}
          {sellCount > 0 && (
            <Badge
              className={`text-[10px] cursor-pointer transition-all ${actionFilter === 'SELL' ? 'bg-red-500/40 text-red-300 ring-1 ring-red-500' : 'bg-red-500/20 text-red-400 hover:bg-red-500/30'}`}
              onClick={() => setActionFilter(actionFilter === 'SELL' ? null : 'SELL')}
            >
              {sellCount} bajistas
            </Badge>
          )}
          {watchCount > 0 && (
            <Badge
              className={`text-[10px] cursor-pointer transition-all ${actionFilter === 'WATCH' ? 'bg-yellow-500/40 text-yellow-300 ring-1 ring-yellow-500' : 'bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30'}`}
              onClick={() => setActionFilter(actionFilter === 'WATCH' ? null : 'WATCH')}
            >
              {watchCount} Observar
            </Badge>
          )}
          <Badge variant="outline" className={`text-[10px] cursor-pointer ${actionFilter === null ? '' : 'opacity-60 hover:opacity-100'}`} onClick={() => setActionFilter(null)}>
            {opportunities.length} total
          </Badge>
          {inPortfolioCount > 0 && (
            <Badge
              variant="outline"
              className={`text-[10px] cursor-pointer transition-all ${
                portfolioFilter
                  ? 'bg-blue-500/40 text-blue-300 ring-1 ring-blue-500'
                  : 'hover:bg-blue-500/20 text-muted-foreground'
              }`}
              onClick={() => setPortfolioFilter(!portfolioFilter)}
            >
              {inPortfolioCount} en portfolio
            </Badge>
          )}
          <div className="flex gap-1 flex-wrap mt-1">
            {[
              { label: 'Acciones', value: 'accion' },
              { label: 'ETFs', value: 'etf' },
              { label: 'Crypto', value: 'crypto' },
              { label: 'Bonos', value: 'bono' },
              { label: 'Commodities', value: 'commodity' },
            ].map(({ label, value }) => (
              <Badge
                key={value}
                variant="outline"
                className={`text-[10px] cursor-pointer transition-all ${instrumentFilter === value ? 'bg-blue-500/40 text-blue-300 ring-1 ring-blue-500' : 'bg-blue-500/10 text-blue-400 hover:bg-blue-500/20'}`}
                onClick={() => setInstrumentFilter(instrumentFilter === value ? null : value)}
              >
                {label}
              </Badge>
            ))}
          </div>
        </div>
      </div>

      {/* Algorithmic fallback warning */}
      {!isAI && (
        <div className="rounded-md border border-orange-500/30 bg-orange-500/10 px-3 py-2 text-[11px] text-orange-400 space-y-1">
          <div className="font-medium">Analisis algoritmico (sin IA)</div>
          <div>
            {engineDetail && engineDetail.includes('error')
              ? engineDetail
              : 'LM Studio no respondió. Verifica que esté corriendo con el servidor iniciado (Developer → Start Server) y presiona Actualizar.'}
          </div>
        </div>
      )}

      {/* Sector filter */}
      <SectorFilter selected={selectedSectors} onChange={setSelectedSectors} />

      {/* Sector summaries */}
      {sectorSummaries.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
          {sectorSummaries.map((s) => (
            <SectorSummaryCard key={s.sector} summary={s} />
          ))}
        </div>
      )}

      <div className="rounded-md bg-muted/20 border border-border/40 p-2 text-[10px] text-muted-foreground mb-2">
        Esto es el <span className="text-foreground font-medium">análisis del motor</span> (lectura técnica + fundamental + noticias). No es tu decisión —
        esa, con tu costo y el stop dinámico, está en la pestaña <span className="text-foreground font-medium">Hoy</span>. Pueden diferir: el análisis es la opinión, "Hoy" es la disciplina.
      </div>

      {/* Opportunity cards */}
      {(() => {
        let filtered = opportunities;

        // Symbol filter
        if (symbolFilter) {
          filtered = filtered.filter((o) => o.symbol.toUpperCase().includes(symbolFilter));
        }

        // Sector filter (client-side)
        if (selectedSectors.length > 0) {
          filtered = filtered.filter((o) => selectedSectors.includes(o.sector as OpportunitySector));
        }

        // Action filter
        if (actionFilter) {
          filtered = filtered.filter((o) => {
            return actionFilter === 'WATCH'
              ? o.action === 'WATCH' || o.action === 'HOLD'
              : o.action === actionFilter;
          });
        }

        // Portfolio filter
        if (portfolioFilter) {
          filtered = filtered.filter((o) => o.inPortfolio);
        }

        // Instrument type filter
        if (instrumentFilter !== null) {
          filtered = filtered.filter((o) => o.classification?.instrumentType === instrumentFilter);
        }

        // Orden ALFABÉTICO, no por score. El backend devuelve el scan ordenado por score y no
        // se toca (hay consumidores aguas abajo que podrían depender de ese orden); acá se
        // reordena solo para MOSTRAR. Coherencia con Hoy: rankear por score no le gana a
        // sortear del mismo universo (A−D −0.79%, t=−1.50), así que ninguna superficie puede
        // presentar un orden como si fuera una preferencia.
        const ordenadas = [...filtered].sort((a, b) => a.symbol.localeCompare(b.symbol));

        return ordenadas.length === 0 ? (
          <div className="text-muted-foreground text-sm py-4">
            No se encontraron oportunidades con los filtros seleccionados.
          </div>
        ) : (
          <>
            <p className="text-[10px] text-muted-foreground/80 mb-2">
              Orden alfabético — el orden NO indica preferencia. Esta vista es el <strong>drilldown</strong>:
              muestra cómo el motor llegó a cada acción (cadena de decisión, ejes, conflictos, niveles).
              El score aparece dentro de cada card porque explica esa cadena, no porque ordene:
              medido contra el índice no separa ganadores (r=0.064, no significativo).
            </p>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {ordenadas.map((o) => (
                <OpportunityCard key={o.symbol} opportunity={o} forceExpanded={allExpanded} />
              ))}
            </div>
          </>
        );
      })()}

      {/* Anti-hype rejections debug panel */}
      <AntiHypeRejectionsPanel />

      {/* Footer */}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-help">{data.totalSymbolsScanned} activos escaneados</span>
          </TooltipTrigger>
          <TooltipContent>Cantidad total de activos analizados (incluyendo los que no pasaron el filtro minimo de score 30).</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-help">
              {engineDetail ?? 'Motor desconocido'} · {new Date(data.scannedAt).toLocaleString('es-AR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            {isAI
              ? `Analizado con ${engineDetail}. Los rendimientos estimados y recomendaciones son generados por IA.`
              : `Analisis algoritmico: scores basados en reglas (RSI, SMA, P/E). ${engineDetail ?? 'LM Studio no disponible.'}`}
          </TooltipContent>
        </Tooltip>
      </div>
      {modal}
    </div>
  );
}
