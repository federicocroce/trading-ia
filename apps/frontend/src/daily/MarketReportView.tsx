import { useState } from 'react';
import { trpc } from '@/shared/trpc';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

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

export function MarketReportView() {
  const [selectedTheme, setSelectedTheme] = useState<string | null>(null);

  const { data: report } = trpc.intelligence.marketReport.useQuery(undefined, {
    staleTime: 10 * 60_000,
  });

  const utils = trpc.useUtils();
  const generate = trpc.intelligence.generateMarketReport.useMutation({
    onSuccess: () => {
      utils.intelligence.marketReport.invalidate();
      utils.opportunities.scan.invalidate();
      setSelectedTheme(null);
    },
  });

  const addToWatchlist = trpc.opportunities.addToWatchlist.useMutation({
    onSuccess: () => utils.opportunities.scan.invalidate(),
  });

  // Find active theme data
  const activeTheme = report?.themes?.find(t => t.theme === selectedTheme);

  return (
    <div className="space-y-4">
      {/* Header + generate button */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Reporte de mercado</h3>
          <p className="text-[10px] text-muted-foreground">
            Analisis por tematica con recomendaciones, escenarios y activos nuevos via Groq IA
          </p>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => generate.mutate()}
              disabled={generate.isPending}
              className="h-8"
            >
              {generate.isPending ? 'Generando (~3 min)...' : 'Generar reporte'}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Busca noticias en 10 tematicas, analiza cada una con datos reales y genera recomendaciones.</TooltipContent>
        </Tooltip>
      </div>

      {generate.isError && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-400">
          Error generando reporte: {generate.error.message.slice(0, 200)}
        </div>
      )}

      {!report && !generate.isPending && (
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

          {/* Macro context */}
          <Card size="sm" className="border-l-4 border-l-blue-500">
            <CardHeader>
              <span className="text-[10px] text-blue-400 uppercase tracking-wider font-medium">Contexto macro</span>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-foreground leading-relaxed">{report.macroContext}</p>
            </CardContent>
          </Card>

          {/* Portfolio impact */}
          {report.portfolioImpact && (
            <Card size="sm">
              <CardHeader>
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Impacto en tu portfolio</span>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-foreground leading-relaxed">{report.portfolioImpact}</p>
              </CardContent>
            </Card>
          )}

          {/* ============ THEME NAVIGATION ============ */}
          {report.themes && report.themes.length > 0 && (
            <div className="space-y-3">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Tematicas analizadas</span>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
                {report.themes.map((t) => (
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

          {/* ============ THEME DETAIL (when clicked) ============ */}
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
                        <span className="text-sm font-mono font-bold">{rec.symbol}</span>
                        <Badge className="text-[8px] h-4 bg-blue-500/20 text-blue-400">{rec.instrumentType}</Badge>
                        <Badge className="text-[8px] h-4 bg-muted text-muted-foreground">{rec.sector}</Badge>
                        <span className="text-[9px] text-muted-foreground">{rec.name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className="text-[9px] h-5 bg-green-500/20 text-green-400">{rec.suggestedWeight}%</Badge>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-5 text-[8px] px-1.5"
                          onClick={() => addToWatchlist.mutate({ symbol: rec.symbol })}
                          disabled={addToWatchlist.isPending}
                        >
                          + Watchlist
                        </Button>
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

          {/* ============ TOP RECS (consolidated, all themes) ============ */}
          {!selectedTheme && report.topRecommendations.length > 0 && (
            <Card size="sm" className="border-l-4 border-l-green-500">
              <CardHeader>
                <span className="text-[10px] text-green-400 uppercase tracking-wider font-medium">Top recomendaciones (todas las tematicas)</span>
              </CardHeader>
              <CardContent className="space-y-3">
                {report.topRecommendations.map((rec, i) => (
                  <div key={i} className="rounded-md bg-muted/30 p-3 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-mono font-bold">{rec.symbol}</span>
                        <Badge className="text-[8px] h-4 bg-blue-500/20 text-blue-400">{rec.instrumentType}</Badge>
                        <Badge className="text-[8px] h-4 bg-muted text-muted-foreground">{rec.sector}</Badge>
                        <span className="text-[9px] text-muted-foreground">{rec.name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className="text-[9px] h-5 bg-green-500/20 text-green-400">{rec.suggestedWeight}%</Badge>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-5 text-[8px] px-1.5"
                          onClick={() => addToWatchlist.mutate({ symbol: rec.symbol })}
                          disabled={addToWatchlist.isPending}
                        >
                          + Watchlist
                        </Button>
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
          {!selectedTheme && report.alternatives.length > 0 && (
            <Card size="sm">
              <CardHeader>
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Alternativas</span>
              </CardHeader>
              <CardContent className="space-y-2">
                {(['A', 'B'] as const).map(tier => {
                  const tierAlts = report.alternatives.filter(a => a.tier === tier);
                  if (tierAlts.length === 0) return null;
                  return (
                    <div key={tier}>
                      <span className="text-[9px] text-muted-foreground font-medium">Tier {tier} {tier === 'A' ? '(alta conviccion)' : '(mas riesgo)'}</span>
                      {tierAlts.map((alt, i) => (
                        <div key={i} className="flex items-start gap-2 py-1">
                          <div className="flex items-center gap-1.5 min-w-[120px]">
                            <span className="text-[10px] font-mono font-semibold">{alt.symbol}</span>
                            <Badge className="text-[7px] h-3.5 bg-muted text-muted-foreground">{alt.sector}</Badge>
                          </div>
                          <p className="text-[9px] text-muted-foreground flex-1">{alt.thesis}</p>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-4 text-[7px] px-1"
                            onClick={() => addToWatchlist.mutate({ symbol: alt.symbol })}
                          >
                            +
                          </Button>
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
                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-1">
                      {scenario.distribution.map((d, j) => (
                        <div key={j} className="flex items-center gap-1 text-[9px]">
                          <span className="font-mono font-semibold">{d.symbol}</span>
                          <span className="text-green-400">{d.weight}%</span>
                          <span className="text-muted-foreground truncate">— {d.reason}</span>
                        </div>
                      ))}
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
        </div>
      )}
    </div>
  );
}
