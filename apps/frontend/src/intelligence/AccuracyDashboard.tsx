import { useState } from 'react';
import { trpc } from '@/shared/trpc';
import { TabInfo, InfoSection } from '@/shared/TabInfo';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { SymbolLink } from '@/shared/SymbolLink';

const PERIOD_OPTIONS = [
  { value: 30 as const, label: '30d' },
  { value: 60 as const, label: '60d' },
  { value: 90 as const, label: '90d' },
  { value: 180 as const, label: '180d' },
];

function WinRateBadge({ rate }: { rate: number }) {
  const variant = rate >= 60 ? 'default' : rate >= 45 ? 'secondary' : 'destructive';
  return <Badge variant={variant}>{rate}%</Badge>;
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="text-2xl font-bold">{value}</div>
        <div className="text-sm text-muted-foreground">{label}</div>
        {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function WeightBar({ label, current, proposed }: { label: string; current: number; proposed?: number }) {
  const displayPct = Math.round((proposed ?? current) * 100);
  const curPct = Math.round(current * 100);
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span>{label}</span>
        <span className="text-muted-foreground">
          {proposed !== undefined && proposed !== current ? (
            <><span className="line-through">{curPct}%</span> → <span className="text-primary">{displayPct}%</span></>
          ) : `${curPct}%`}
        </span>
      </div>
      <div className="h-2 bg-muted rounded overflow-hidden">
        <div className="h-full bg-primary rounded" style={{ width: `${displayPct}%` }} />
      </div>
    </div>
  );
}

export function AccuracyDashboard() {
  const [days, setDays] = useState<30 | 60 | 90 | 180>(90);
  const { data, isLoading } = trpc.intelligence.accuracyReport.useQuery({ days });

  const utils = trpc.useUtils();
  const { data: pendingProposal, refetch: refetchProposal } = trpc.intelligence.weightPendingProposal.useQuery();
  const { data: currentWeights } = trpc.intelligence.weightCurrentWeights.useQuery();
  const { data: weightHistory } = trpc.intelligence.weightHistory.useQuery();

  const approveProposal = trpc.intelligence.weightApproveProposal.useMutation({
    onSuccess: () => {
      void refetchProposal();
      void utils.intelligence.weightHistory.invalidate();
      void utils.intelligence.weightCurrentWeights.invalidate();
    },
  });
  const rejectProposal = trpc.intelligence.weightRejectProposal.useMutation({
    onSuccess: () => { void refetchProposal(); },
  });

  if (isLoading) return <div className="p-4 text-muted-foreground">Cargando accuracy...</div>;
  if (!data) return <div className="p-4 text-muted-foreground">Sin datos de accuracy aún. Necesitás al menos algunas señales resueltas.</div>;

  const { summary, byAction, bySector, byConfidenceTier, entryAccuracy, targetAccuracy, stopAccuracy, trend, missedOpps } = data;

  return (
    <>
    <TabInfo>
      <InfoSection title="Qué hace">Trackea la precisión histórica de las señales generadas por el pipeline de IA comparando predicciones vs movimiento real del precio.</InfoSection>
      <InfoSection title="Flujo">Por cada señal emitida, el sistema espera N días → consulta el precio real → marca como ganada (acertó dirección) o perdida → calcula win rate acumulado por tipo de señal.</InfoSection>
      <InfoSection title="Métricas">Win Rate global (%) · Señales resueltas · Señales pendientes de resolución · Win rate por tipo (técnico / fundamental / sentimiento).</InfoSection>
      <InfoSection title="Gestión de pesos">Permite ajustar cuánto pesa cada tipo de señal en el score compuesto de Oportunidades. Los pesos se recalibran en base al historial de accuracy. Proposals pendientes = sugerencias del sistema para mejorar los pesos.</InfoSection>
    </TabInfo>
    <div className="space-y-6 p-4">
      <div className="flex gap-2">
        {PERIOD_OPTIONS.map(opt => (
          <button
            key={opt.value}
            onClick={() => setDays(opt.value)}
            className={`px-3 py-1 rounded text-sm ${days === opt.value ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Win Rate Global"
          value={`${summary.winRate}%`}
          sub={`${summary.resolvedSignals} señales resueltas`}
        />
        <StatCard
          label="Sesgo de Predicción"
          value={`${summary.predictionBias > 0 ? '+' : ''}${summary.predictionBias.toFixed(1)}%`}
          sub={summary.predictionBias > 0 ? 'Optimista' : summary.predictionBias < 0 ? 'Pesimista' : 'Neutral'}
        />
        <StatCard
          label="MAE Predicción"
          value={`${summary.mae.toFixed(1)}%`}
          sub="Error absoluto medio"
        />
        <StatCard
          label="Pendientes"
          value={String(summary.pendingSignals)}
          sub="señales sin resolver"
        />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm">Tendencia Win Rate</CardTitle></CardHeader>
        <CardContent>
          <div className="flex gap-6">
            {trend.rolling30d != null && (
              <div className="text-center">
                <div className="text-lg font-bold">{trend.rolling30d}%</div>
                <div className="text-xs text-muted-foreground">últimos 30d</div>
              </div>
            )}
            {trend.rolling60d != null && (
              <div className="text-center">
                <div className="text-lg font-bold">{trend.rolling60d}%</div>
                <div className="text-xs text-muted-foreground">últimos 60d</div>
              </div>
            )}
            {trend.rolling90d != null && (
              <div className="text-center">
                <div className="text-lg font-bold">{trend.rolling90d}%</div>
                <div className="text-xs text-muted-foreground">últimos 90d</div>
              </div>
            )}
            {trend.rolling30d == null && trend.rolling60d == null && trend.rolling90d == null && (
              <div className="text-sm text-muted-foreground">Mínimo 3 señales resueltas por período para mostrar tendencia.</div>
            )}
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="action">
        <TabsList>
          <TabsTrigger value="action">Por Acción</TabsTrigger>
          <TabsTrigger value="levels">Entrada/Target/Stop</TabsTrigger>
          <TabsTrigger value="sector">Por Sector</TabsTrigger>
          <TabsTrigger value="confidence">Por Confianza</TabsTrigger>
          <TabsTrigger value="missed">Perdidas</TabsTrigger>
        </TabsList>

        <TabsContent value="action">
          <Card>
            <CardContent className="pt-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b">
                    <th className="text-left py-2">Acción</th>
                    <th className="text-right py-2">Total</th>
                    <th className="text-right py-2">Resueltas</th>
                    <th className="text-right py-2">Win Rate</th>
                    <th className="text-right py-2">Ret. Prom.</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(byAction).map(([action, stats]) => (
                    <tr key={action} className="border-b border-border/40">
                      <td className="py-2 font-medium">{action}</td>
                      <td className="text-right">{stats.total}</td>
                      <td className="text-right">{stats.resolved}</td>
                      <td className="text-right"><WinRateBadge rate={stats.winRate} /></td>
                      <td className={`text-right ${stats.avgReturn >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                        {stats.avgReturn > 0 ? '+' : ''}{stats.avgReturn.toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="levels">
          <div className="grid grid-cols-3 gap-3">
            <Card>
              <CardHeader><CardTitle className="text-sm">Entrada</CardTitle></CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{entryAccuracy.hitRate}%</div>
                <div className="text-xs text-muted-foreground">hit rate</div>
                <div className="mt-2 text-sm">{entryAccuracy.avgDeviation.toFixed(2)}% desviación promedio</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm">Target</CardTitle></CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{targetAccuracy.hitRate}%</div>
                <div className="text-xs text-muted-foreground">hit rate</div>
                <div className="mt-2 text-sm">{targetAccuracy.avgDeviation.toFixed(2)}% desviación promedio</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm">Stop Loss</CardTitle></CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stopAccuracy.triggerRate}%</div>
                <div className="text-xs text-muted-foreground">tasa de activación</div>
                <div className="mt-2 text-sm">{stopAccuracy.avgDeviation.toFixed(2)}% desviación promedio</div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="sector">
          <Card>
            <CardContent className="pt-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b">
                    <th className="text-left py-2">Sector</th>
                    <th className="text-right py-2">Total</th>
                    <th className="text-right py-2">Win Rate</th>
                    <th className="text-right py-2">Ret. Prom.</th>
                  </tr>
                </thead>
                <tbody>
                  {bySector.slice(0, 15).map(s => (
                    <tr key={s.sector} className="border-b border-border/40">
                      <td className="py-2">{s.sector}</td>
                      <td className="text-right">{s.total}</td>
                      <td className="text-right"><WinRateBadge rate={s.winRate} /></td>
                      <td className={`text-right ${s.avgReturn >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                        {s.avgReturn > 0 ? '+' : ''}{s.avgReturn.toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="confidence">
          <Card>
            <CardContent className="pt-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b">
                    <th className="text-left py-2">Tier</th>
                    <th className="text-right py-2">Total</th>
                    <th className="text-right py-2">Win Rate</th>
                    <th className="text-right py-2">Ret. Prom.</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(byConfidenceTier).reverse().map(([key, tier]) => (
                    <tr key={key} className="border-b border-border/40">
                      <td className="py-2">{tier.label}</td>
                      <td className="text-right">{tier.total}</td>
                      <td className="text-right"><WinRateBadge rate={tier.winRate} /></td>
                      <td className={`text-right ${tier.avgReturn >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                        {tier.avgReturn > 0 ? '+' : ''}{tier.avgReturn.toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="missed">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Oportunidades Perdidas</CardTitle>
                <div className="text-sm text-muted-foreground">
                  Retorno prom: <span className="text-green-500">+{missedOpps.avgMissedReturn.toFixed(1)}%</span>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b">
                    <th className="text-left py-2">Símbolo</th>
                    <th className="text-right py-2">Fecha</th>
                    <th className="text-right py-2">Ret 7d</th>
                    <th className="text-right py-2">Ret 30d</th>
                    <th className="text-right py-2">Debió ser</th>
                  </tr>
                </thead>
                <tbody>
                  {missedOpps.topMissed.map((m, i) => (
                    <tr key={i} className="border-b border-border/40">
                      <td className="py-2 font-medium">
                        <SymbolLink symbol={m.symbol} />
                      </td>
                      <td className="text-right text-muted-foreground">{m.date}</td>
                      <td className={`text-right ${(m.return7d ?? 0) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                        {m.return7d != null ? `${m.return7d >= 0 ? '+' : ''}${m.return7d.toFixed(1)}%` : '—'}
                      </td>
                      <td className={`text-right ${(m.return30d ?? 0) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                        {m.return30d != null ? `${m.return30d >= 0 ? '+' : ''}${m.return30d.toFixed(1)}%` : '—'}
                      </td>
                      <td className="text-right">
                        <Badge variant="outline" className="text-xs">{m.wouldHaveBeen ?? '—'}</Badge>
                      </td>
                    </tr>
                  ))}
                  {missedOpps.topMissed.length === 0 && (
                    <tr><td colSpan={5} className="py-4 text-center text-muted-foreground">Sin oportunidades perdidas registradas.</td></tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Weight Adjustment */}
      {pendingProposal && (
        <Card className="border-primary/50">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Nueva Sugerencia de Pesos</CardTitle>
              <Badge>Pendiente</Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Calculado sobre {pendingProposal.signalCount} señales resueltas.
              Short-term: {pendingProposal.shortTermBasis} | Medium-term: {pendingProposal.mediumTermBasis}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-6">
              <div>
                <div className="text-xs font-medium mb-2 text-muted-foreground">SHORT TERM</div>
                <div className="space-y-2">
                  <WeightBar label="Technical" current={pendingProposal.currentWeights.shortTerm.technical} proposed={pendingProposal.proposedWeights.shortTerm.technical} />
                  <WeightBar label="Fundamental" current={pendingProposal.currentWeights.shortTerm.fundamental} proposed={pendingProposal.proposedWeights.shortTerm.fundamental} />
                  <WeightBar label="Sentiment" current={pendingProposal.currentWeights.shortTerm.sentiment} proposed={pendingProposal.proposedWeights.shortTerm.sentiment} />
                </div>
              </div>
              <div>
                <div className="text-xs font-medium mb-2 text-muted-foreground">MEDIUM TERM</div>
                <div className="space-y-2">
                  <WeightBar label="Technical" current={pendingProposal.currentWeights.mediumTerm.technical} proposed={pendingProposal.proposedWeights.mediumTerm.technical} />
                  <WeightBar label="Fundamental" current={pendingProposal.currentWeights.mediumTerm.fundamental} proposed={pendingProposal.proposedWeights.mediumTerm.fundamental} />
                  <WeightBar label="Sentiment" current={pendingProposal.currentWeights.mediumTerm.sentiment} proposed={pendingProposal.proposedWeights.mediumTerm.sentiment} />
                </div>
              </div>
            </div>
            <div className="text-xs text-muted-foreground space-y-1">
              <div>Corr. Short: Tech {(pendingProposal.correlations.shortTerm.technical * 100).toFixed(0)}% | Fund {(pendingProposal.correlations.shortTerm.fundamental * 100).toFixed(0)}% | Sent {(pendingProposal.correlations.shortTerm.sentiment * 100).toFixed(0)}%</div>
              <div>Corr. Mid: Tech {(pendingProposal.correlations.mediumTerm.technical * 100).toFixed(0)}% | Fund {(pendingProposal.correlations.mediumTerm.fundamental * 100).toFixed(0)}% | Sent {(pendingProposal.correlations.mediumTerm.sentiment * 100).toFixed(0)}%</div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => approveProposal.mutate({ id: pendingProposal.id })} disabled={approveProposal.isPending}>
                Aplicar pesos sugeridos
              </Button>
              <Button variant="outline" size="sm" onClick={() => rejectProposal.mutate({ id: pendingProposal.id, reason: 'Manual rejection' })} disabled={rejectProposal.isPending}>
                Rechazar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {!pendingProposal && currentWeights && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Pesos Activos</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-6">
              <div>
                <div className="text-xs font-medium mb-2 text-muted-foreground">SHORT TERM</div>
                <div className="space-y-2">
                  <WeightBar label="Technical" current={currentWeights.shortTerm.technical} />
                  <WeightBar label="Fundamental" current={currentWeights.shortTerm.fundamental} />
                  <WeightBar label="Sentiment" current={currentWeights.shortTerm.sentiment} />
                </div>
              </div>
              <div>
                <div className="text-xs font-medium mb-2 text-muted-foreground">MEDIUM TERM</div>
                <div className="space-y-2">
                  <WeightBar label="Technical" current={currentWeights.mediumTerm.technical} />
                  <WeightBar label="Fundamental" current={currentWeights.mediumTerm.fundamental} />
                  <WeightBar label="Sentiment" current={currentWeights.mediumTerm.sentiment} />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {weightHistory && weightHistory.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Historial de Pesos</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground border-b">
                  <th className="text-left py-2">Fecha</th>
                  <th className="text-left py-2">Origen</th>
                  <th className="text-right py-2">ST T/F/S</th>
                  <th className="text-right py-2">MT T/F/S</th>
                </tr>
              </thead>
              <tbody>
                {weightHistory.map(h => (
                  <tr key={h.id} className="border-b border-border/40">
                    <td className="py-1">{h.appliedAt.split('T')[0]}</td>
                    <td>{h.source}</td>
                    <td className="text-right font-mono">
                      {Math.round(h.weights.shortTerm.technical * 100)}/{Math.round(h.weights.shortTerm.fundamental * 100)}/{Math.round(h.weights.shortTerm.sentiment * 100)}
                    </td>
                    <td className="text-right font-mono">
                      {Math.round(h.weights.mediumTerm.technical * 100)}/{Math.round(h.weights.mediumTerm.fundamental * 100)}/{Math.round(h.weights.mediumTerm.sentiment * 100)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
    </>
  );
}
