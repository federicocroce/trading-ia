import { useMemo, useState } from 'react';
import type { TopImpactNewsItem } from '@trading/shared';
import { trpc } from '@/shared/trpc';
import { WatchlistButton } from '@/shared/WatchlistButton';
import { SymbolLink } from '@/shared/SymbolLink';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { usePipeline } from '../pipeline/usePipeline';
import { CausalMapView } from './CausalMapView';
import { useAiModeModal } from '@/shared/AiModeModal';

// --- Instrument type filter (consistent with watchlist sidebar) ---

type InstrumentFilter = 'all' | 'accion-us' | 'cedear' | 'etf' | 'crypto' | 'bono' | 'commodity';

const INSTRUMENT_LABELS: Record<InstrumentFilter, string> = {
  all: 'Todos',
  'accion-us': 'Acciones US',
  cedear: 'CEDEARs',
  etf: 'ETFs',
  crypto: 'Crypto',
  bono: 'Bonos',
  commodity: 'Commodities',
};

// instrumentType strings come from backend market-report.service.ts:
// 'Accion US' | 'CEDEAR' | 'ETF' | 'Crypto' | 'Bono' | 'Commodity'
function matchesInstrumentFilter(filter: InstrumentFilter, instrumentType: string | undefined): boolean {
  if (filter === 'all' || !instrumentType) return filter === 'all';
  switch (filter) {
    case 'accion-us': return instrumentType === 'Accion US';
    case 'cedear': return instrumentType === 'CEDEAR';
    case 'etf': return instrumentType === 'ETF';
    case 'crypto': return instrumentType === 'Crypto';
    case 'bono': return instrumentType === 'Bono';
    case 'commodity': return instrumentType === 'Commodity';
  }
}

// Same classification as Sidebar (when looking up via DB row)
function dbRowToInstrumentLabel(row: { type?: string | null; plaza?: string | null }): string {
  if (row.plaza === 'argentina-cedears' || row.type === 'adr') return 'CEDEAR';
  if (row.type === 'crypto') return 'Crypto';
  if (row.type === 'bond') return 'Bono';
  if (row.type === 'etf' || row.plaza === 'etfs-sectors') return 'ETF';
  if (row.type === 'commodity' || row.plaza === 'commodities') return 'Commodity';
  return 'Accion US';
}

const relevanceColor = {
  high: 'bg-red-500/20 text-red-400 border-red-500/30',
  medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  low: 'bg-muted text-muted-foreground',
};

const relevanceLabel = {
  high: 'Alta',
  medium: 'Media',
  low: 'Baja',
};

const confidenceColor = {
  high: 'bg-green-500/20 text-green-400',
  medium: 'bg-yellow-500/20 text-yellow-400',
  low: 'bg-muted text-muted-foreground',
};

const directionColor = {
  positive: 'text-green-400',
  negative: 'text-red-400',
  neutral: 'text-muted-foreground',
};

const directionIcon = {
  positive: '▲',
  negative: '▼',
  neutral: '—',
};

function TopImpactNewsList({ items }: { items: TopImpactNewsItem[] }) {
  return (
    <Card size="sm">
      <CardHeader>
        <span className="text-[10px] text-foreground uppercase tracking-wider font-medium">
          Top noticias por impacto
        </span>
        <p className="text-[9px] text-muted-foreground">Independiente del portfolio — ordenadas por relevancia de mercado</p>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.map((item, i) => (
          <div key={i} className="rounded-md border border-border/50 p-2.5 space-y-1.5">
            <div className="flex items-start justify-between gap-2">
              <p className="text-[11px] text-foreground leading-snug flex-1">{item.headline}</p>
              <Badge className={`text-[7px] h-4 shrink-0 ${confidenceColor[item.confidence]}`}>
                {item.confidence}
              </Badge>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {item.sectors.map((s, j) => (
                <span key={j} className={`text-[9px] ${directionColor[s.direction]}`}>
                  {directionIcon[s.direction]} {s.name}
                </span>
              ))}
            </div>
            {item.tickers.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {item.tickers.slice(0, 6).map((t, j) => (
                  <SymbolLink key={j} symbol={t}>
                    <Badge variant="outline" className="text-[7px] h-3 font-mono hover:text-blue-400 transition-colors">{t}</Badge>
                  </SymbolLink>
                ))}
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function MarketReportView({ date }: { date?: string }) {
  const [selectedTheme, setSelectedTheme] = useState<string | null>(null);
  const [instrumentFilter, setInstrumentFilter] = useState<InstrumentFilter>('all');

  const today = new Date().toISOString().slice(0, 10);
  const isHistorical = date !== undefined && date !== today;

  const { data: todayReport } = trpc.intelligence.marketReport.useQuery(undefined, {
    staleTime: 10 * 60_000,
    enabled: !isHistorical,
  });

  const { data: historicalData } = trpc.intelligence.reportsByDate.useQuery(
    { date: date ?? today },
    {
      staleTime: 30 * 60_000,
      enabled: isHistorical,
    }
  );

  // Symbols list for DB lookup (used by alternatives + topImpactNews tickers without instrumentType)
  const { data: symbols } = trpc.portfolio.symbols.list.useQuery(undefined, {
    staleTime: 30 * 60_000,
  });

  const report = isHistorical ? historicalData?.marketReport : todayReport;

  const { run, isRunning } = usePipeline();
  const { selectMode, modal } = useAiModeModal();

  // DB-backed lookup for symbols that don't carry instrumentType
  const symbolToType = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of symbols ?? []) map.set(s.symbol, dbRowToInstrumentLabel(s));
    return map;
  }, [symbols]);

  const symbolMatchesFilter = (symbol: string): boolean => {
    if (instrumentFilter === 'all') return true;
    const type = symbolToType.get(symbol);
    return matchesInstrumentFilter(instrumentFilter, type);
  };

  // Filtered slices (memoized)
  const filteredTopRecommendations = useMemo(() => {
    if (!report?.topRecommendations) return [];
    if (instrumentFilter === 'all') return report.topRecommendations;
    return report.topRecommendations.filter(r => matchesInstrumentFilter(instrumentFilter, r.instrumentType));
  }, [report, instrumentFilter]);

  const filteredAlternatives = useMemo(() => {
    if (!report?.alternatives) return [];
    if (instrumentFilter === 'all') return report.alternatives;
    return report.alternatives.filter(a => symbolMatchesFilter(a.symbol));
  }, [report, instrumentFilter, symbolToType]);

  const filteredThemes = useMemo(() => {
    if (!report?.themes) return [];
    if (instrumentFilter === 'all') return report.themes;
    return report.themes
      .map(t => ({
        ...t,
        recommendations: t.recommendations.filter(r => matchesInstrumentFilter(instrumentFilter, r.instrumentType)),
      }))
      .filter(t => t.recommendations.length > 0);
  }, [report, instrumentFilter]);

  const filteredTopImpactNews = useMemo(() => {
    if (!report?.topImpactNews) return [];
    if (instrumentFilter === 'all') return report.topImpactNews;
    return report.topImpactNews.filter(item => item.tickers.some(t => symbolMatchesFilter(t)));
  }, [report, instrumentFilter, symbolToType]);

  const activeTheme = filteredThemes.find(t => t.theme === selectedTheme);

  return (
    <>
    <div className="space-y-4">
      {/* Header + generate button */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Reporte de mercado</h3>
          <p className="text-[10px] text-muted-foreground">
            Analisis por tematica con recomendaciones, escenarios y activos nuevos via Groq IA
          </p>
        </div>
        {!isHistorical && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  const mode = await selectMode();
                  if (!mode) return;
                  run(false, undefined, mode);
                }}
                disabled={isRunning}
                className="h-8"
              >
                {isRunning ? 'Ejecutando pipeline...' : 'Generar reporte'}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Busca noticias en 10 tematicas, analiza cada una con datos reales y genera recomendaciones.</TooltipContent>
          </Tooltip>
        )}
      </div>

      {!report && !isRunning && (
        <Card size="sm">
          <CardContent className="py-6 text-center">
            <p className="text-xs text-muted-foreground">
              No hay reporte generado. Presiona "Generar reporte" para obtener un analisis completo por tematica.
            </p>
          </CardContent>
        </Card>
      )}

      {report && (
        <div className="space-y-4">
          {/* Engine + timestamp */}
          <div className="flex items-center gap-2 text-[9px] text-muted-foreground">
            <Badge variant="outline" className="text-[8px]">{report.engine}</Badge>
            <span>{new Date(report.generatedAt).toLocaleString('es-AR')}</span>
          </div>

          {/* ======================================================= */}
          {/* SECCIÓN 1: MERCADO (independiente del portfolio)         */}
          {/* ======================================================= */}
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-semibold text-blue-400 uppercase tracking-widest">Mercado</span>
              <div className="flex-1 h-px bg-blue-500/20" />
            </div>
            <p className="text-[9px] text-muted-foreground">Análisis independiente — sin sesgo del portfolio</p>
          </div>

          {/* Macro context */}
          <Card size="sm" className="border-l-4 border-l-blue-500">
            <CardHeader>
              <span className="text-[10px] text-blue-400 uppercase tracking-wider font-medium">Contexto macro</span>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-foreground leading-relaxed">{report.macroContext}</p>
            </CardContent>
          </Card>

          {/* Instrument filter chips (consistent with sidebar watchlist) */}
          <div className="flex gap-2 flex-wrap items-center">
            <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-medium">Filtrar por tipo:</span>
            {(Object.keys(INSTRUMENT_LABELS) as InstrumentFilter[]).map(f => (
              <Badge
                key={f}
                variant="outline"
                className={`cursor-pointer text-[10px] transition-colors ${instrumentFilter === f ? 'bg-blue-500/30 text-blue-300 border-blue-500/40' : 'hover:bg-blue-500/10'}`}
                onClick={() => setInstrumentFilter(f)}
              >
                {INSTRUMENT_LABELS[f]}
              </Badge>
            ))}
          </div>

          {/* Top impact news (NEW) */}
          {filteredTopImpactNews.length > 0 && (
            <TopImpactNewsList items={filteredTopImpactNews} />
          )}

          {/* Causal map */}
          <CausalMapView date={date} />

          {/* Theme navigation */}
          {filteredThemes.length > 0 && (
            <div className="space-y-3">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Tematicas analizadas</span>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
                {filteredThemes.map((t) => (
                  <button
                    key={t.theme}
                    onClick={() => setSelectedTheme(selectedTheme === t.theme ? null : t.theme)}
                    className={`text-left rounded-md border p-2 transition-all hover:bg-muted/50 ${
                      selectedTheme === t.theme
                        ? 'border-blue-500 bg-blue-500/10 ring-1 ring-blue-500'
                        : 'border-border'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-semibold text-foreground">{t.theme}</span>
                      <Badge className={`text-[7px] h-3.5 ${relevanceColor[t.relevance]}`}>
                        {relevanceLabel[t.relevance]}
                      </Badge>
                    </div>
                    <p className="text-[9px] text-muted-foreground leading-snug line-clamp-2">{t.summary}</p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {t.sectors.slice(0, 3).map((s, i) => (
                        <Badge key={i} variant="outline" className="text-[7px] h-3">{s}</Badge>
                      ))}
                      {t.recommendations.length > 0 && (
                        <Badge className="text-[7px] h-3 bg-green-500/20 text-green-400">
                          {t.recommendations.length} activos
                        </Badge>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Theme detail (when clicked) */}
          {activeTheme && (
            <Card size="sm" className="border-l-4 border-l-blue-500">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-foreground">{activeTheme.theme}</span>
                  <Button size="sm" variant="ghost" className="h-5 text-[9px]" onClick={() => setSelectedTheme(null)}>
                    Cerrar
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground">{activeTheme.summary}</p>
              </CardHeader>
              <CardContent className="space-y-3">
                {activeTheme.recommendations.map((rec, i) => (
                  <div key={i} className="rounded-md bg-muted/30 p-3 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <SymbolLink symbol={rec.symbol} className="text-sm font-mono font-bold" />
                        <Badge className="text-[8px] h-4 bg-blue-500/20 text-blue-400">{rec.instrumentType}</Badge>
                        <Badge className="text-[8px] h-4 bg-muted text-muted-foreground">{rec.sector}</Badge>
                        <span className="text-[9px] text-muted-foreground">{rec.name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className="text-[9px] h-5 bg-green-500/20 text-green-400">{rec.suggestedWeight}%</Badge>
                        <WatchlistButton symbol={rec.symbol} />
                      </div>
                    </div>
                    <p className="text-[11px] text-foreground leading-relaxed">{rec.thesis}</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-[8px] text-green-500 uppercase">Catalizadores</span>
                        {rec.catalysts.map((c, j) => (
                          <p key={j} className="text-[9px] text-muted-foreground">- {c}</p>
                        ))}
                      </div>
                      <div>
                        <span className="text-[8px] text-red-500 uppercase">Riesgos</span>
                        {rec.risks.map((r, j) => (
                          <p key={j} className="text-[9px] text-muted-foreground">- {r}</p>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Top recommendations (consolidated) */}
          {!selectedTheme && filteredTopRecommendations.length > 0 && (
            <Card size="sm" className="border-l-4 border-l-green-500">
              <CardHeader>
                <span className="text-[10px] text-green-400 uppercase tracking-wider font-medium">
                  Top recomendaciones {instrumentFilter !== 'all' ? `(${INSTRUMENT_LABELS[instrumentFilter]})` : '(todas las tematicas)'}
                </span>
              </CardHeader>
              <CardContent className="space-y-3">
                {filteredTopRecommendations.map((rec, i) => (
                  <div key={i} className="rounded-md bg-muted/30 p-3 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <SymbolLink symbol={rec.symbol} className="text-sm font-mono font-bold" />
                        <Badge className="text-[8px] h-4 bg-blue-500/20 text-blue-400">{rec.instrumentType}</Badge>
                        <Badge className="text-[8px] h-4 bg-muted text-muted-foreground">{rec.sector}</Badge>
                        <span className="text-[9px] text-muted-foreground">{rec.name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className="text-[9px] h-5 bg-green-500/20 text-green-400">{rec.suggestedWeight}%</Badge>
                        <WatchlistButton symbol={rec.symbol} />
                      </div>
                    </div>
                    <p className="text-[11px] text-foreground leading-relaxed">{rec.thesis}</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-[8px] text-green-500 uppercase">Catalizadores</span>
                        {rec.catalysts.map((c, j) => (
                          <p key={j} className="text-[9px] text-muted-foreground">- {c}</p>
                        ))}
                      </div>
                      <div>
                        <span className="text-[8px] text-red-500 uppercase">Riesgos</span>
                        {rec.risks.map((r, j) => (
                          <p key={j} className="text-[9px] text-muted-foreground">- {r}</p>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Alternatives */}
          {!selectedTheme && filteredAlternatives.length > 0 && (
            <Card size="sm">
              <CardHeader>
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Alternativas</span>
              </CardHeader>
              <CardContent className="space-y-2">
                {(['A', 'B'] as const).map(tier => {
                  const tierAlts = filteredAlternatives.filter(a => a.tier === tier);
                  if (tierAlts.length === 0) return null;
                  return (
                    <div key={tier}>
                      <span className="text-[9px] text-muted-foreground font-medium">Tier {tier} {tier === 'A' ? '(alta conviccion)' : '(mas riesgo)'}</span>
                      {tierAlts.map((alt, i) => (
                        <div key={i} className="flex items-start gap-2 py-1">
                          <div className="flex items-center gap-1.5 min-w-30">
                            <SymbolLink symbol={alt.symbol} className="text-[10px] font-mono font-semibold" />
                            <Badge className="text-[7px] h-3.5 bg-muted text-muted-foreground">{alt.sector}</Badge>
                          </div>
                          <p className="text-[9px] text-muted-foreground flex-1">{alt.thesis}</p>
                          <WatchlistButton symbol={alt.symbol} />
                        </div>
                      ))}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {/* Scenarios */}
          {!selectedTheme && report.scenarios.length > 0 && (
            <Card size="sm">
              <CardHeader>
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Escenarios</span>
              </CardHeader>
              <CardContent className="space-y-3">
                {report.scenarios.map((scenario, i) => (
                  <div key={i} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-semibold text-foreground">{scenario.name}</span>
                      <Badge className="text-[8px] h-4 bg-muted text-muted-foreground">
                        {scenario.probability}% prob.
                      </Badge>
                    </div>
                    <div className="space-y-0.5">
                      {scenario.distribution.length > 0 ? (
                        scenario.distribution.map((d, j) => (
                          <div key={j} className="flex items-start gap-1 text-[9px]">
                            <SymbolLink symbol={d.symbol} className="font-mono font-semibold shrink-0" />
                            <span className="text-green-400 shrink-0">{d.weight}%</span>
                            <span className="text-muted-foreground">— {d.reason}</span>
                          </div>
                        ))
                      ) : (
                        <p className="text-[9px] text-muted-foreground italic">
                          {scenario.distributionNote ?? 'Sin distribución de activos.'}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Avoid list */}
          {!selectedTheme && report.avoidList.length > 0 && (
            <Card size="sm" className="border-l-4 border-l-red-500">
              <CardHeader>
                <span className="text-[10px] text-red-400 uppercase tracking-wider font-medium">Lo que NO haria</span>
              </CardHeader>
              <CardContent className="space-y-1">
                {report.avoidList.map((item, i) => (
                  <p key={i} className="text-[10px] text-muted-foreground">- {item}</p>
                ))}
              </CardContent>
            </Card>
          )}

          {/* ======================================================= */}
          {/* SECCIÓN 2: TU PORTFOLIO                                  */}
          {/* ======================================================= */}
          {report.portfolioImpact && !selectedTheme && (
            <>
              <div className="space-y-1 pt-2">
                <div className="flex items-center gap-2">
                  <span className="text-[9px] font-semibold text-amber-400 uppercase tracking-widest">Tu Portfolio</span>
                  <div className="flex-1 h-px bg-amber-500/20" />
                </div>
              </div>

              <Card size="sm" className="border-l-4 border-l-amber-500">
                <CardHeader>
                  <span className="text-[10px] text-amber-400 uppercase tracking-wider font-medium">Impacto en tu portfolio</span>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-foreground leading-relaxed">{report.portfolioImpact}</p>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      )}
    </div>
    {modal}
    </>
  );
}
