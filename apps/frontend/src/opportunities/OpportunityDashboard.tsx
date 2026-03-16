import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { trpc } from '@/shared/trpc';
import { OpportunityCard } from './OpportunityCard';
import { SectorFilter } from './SectorFilter';

type OpportunitySector = 'argentina-energy' | 'argentina-finance' | 'us-energy' | 'us-tech' | 'crypto';

interface SectorSummary {
  sector: OpportunitySector;
  label: string;
  symbolCount: number;
  avgScore: number;
  topOpportunity: string | null;
  sectorOutlook: string;
}

function SectorSummaryCard({ summary }: { summary: SectorSummary }) {
  const scoreColor = summary.avgScore >= 55 ? 'text-green-500' : summary.avgScore >= 40 ? 'text-yellow-500' : 'text-muted-foreground';

  return (
    <Card size="sm">
      <CardContent className="py-2 px-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium">{summary.label}</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className={`text-[11px] font-mono font-semibold cursor-help ${scoreColor}`}>{summary.avgScore}</span>
            </TooltipTrigger>
            <TooltipContent>
              Score promedio del sector (0-100). Promedio de los scores de oportunidad de los {summary.symbolCount} activos analizados en {summary.label}.
            </TooltipContent>
          </Tooltip>
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
          {summary.topOpportunity && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="outline" className="text-[8px] h-3.5 cursor-help">Top: {summary.topOpportunity}</Badge>
              </TooltipTrigger>
              <TooltipContent>Activo con mayor score de oportunidad en {summary.label}.</TooltipContent>
            </Tooltip>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function OpportunityDashboard() {
  const [selectedSectors, setSelectedSectors] = useState<OpportunitySector[]>([]);
  const [actionFilter, setActionFilter] = useState<'BUY' | 'SELL' | 'WATCH' | null>(null);
  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.opportunities.scan.useQuery(undefined);

  const refresh = trpc.opportunities.refresh.useMutation({
    onSuccess: () => {
      utils.opportunities.scan.invalidate();
    },
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
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">Oportunidades</h2>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => refresh.mutate()}
                disabled={refresh.isPending}
              >
                {refresh.isPending ? 'Escaneando...' : 'Actualizar'}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Forzar re-escaneo con IA (ejecuta analisis nuevo, consume tokens).</TooltipContent>
          </Tooltip>
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
        </div>
        <div className="flex items-center gap-2">
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
              {sellCount} Vender
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
            <Badge variant="outline" className="text-[10px]">{inPortfolioCount} en portfolio</Badge>
          )}
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

      {/* Opportunity cards */}
      {(() => {
        let filtered = opportunities;

        // Sector filter (client-side)
        if (selectedSectors.length > 0) {
          filtered = filtered.filter((o) => selectedSectors.includes(o.sector as OpportunitySector));
        }

        // Action filter
        if (actionFilter) {
          filtered = filtered.filter((o) =>
            actionFilter === 'WATCH'
              ? o.action === 'WATCH' || o.action === 'HOLD'
              : o.action === actionFilter,
          );
        }

        return filtered.length === 0 ? (
          <div className="text-muted-foreground text-sm py-4">
            No se encontraron oportunidades con los filtros seleccionados.
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {filtered.map((o) => (
              <OpportunityCard key={o.symbol} opportunity={o} />
            ))}
          </div>
        );
      })()}

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
    </div>
  );
}
