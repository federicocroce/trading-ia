import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { PipelineRun, StageStatus } from '@trading/shared';

const STAGE_LABELS = { webSearch: 'Web Search', news: 'Noticias', fundamentals: 'Fundamentales', analysis: 'Análisis', report: 'Reporte' } as const;

interface NewsDetailPayload {
  text: string;
  totalRaw: number;
  duplicatesRemoved: number;
  deduplicationRate: string;
  sourceStats: Record<string, number>;
  clusterStats: { total: number; clusters: number; high: number; medium: number; low: number };
}

function parseNewsDetail(detail: string): NewsDetailPayload | null {
  try {
    const parsed = JSON.parse(detail);
    if (parsed && typeof parsed.text === 'string' && parsed.sourceStats) return parsed as NewsDetailPayload;
  } catch { /* plain text */ }
  return null;
}

function formatDuration(startedAt: string | null, finishedAt: string | null): string {
  if (!startedAt || !finishedAt) return '';
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 0) return '';
  const secs = Math.floor(ms / 1000);
  const mins = Math.floor(secs / 60);
  return mins > 0 ? `${mins}m ${secs % 60}s` : `${secs}s`;
}

function stageIcon(status: StageStatus): string {
  switch (status) {
    case 'ok': return '✅';
    case 'partial': return '⚠️';
    case 'failed': return '❌';
    case 'running': return '⏳';
    case 'skipped': return '⏭️';
    case 'waiting_user': return '🟠';
    default: return '○';
  }
}

function overallBadge(status: PipelineRun['status']) {
  switch (status) {
    case 'ok': return <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-[9px]">Completo</Badge>;
    case 'partial': return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-[9px]">Parcial</Badge>;
    case 'failed': return <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-[9px]">Fallido</Badge>;
    case 'running': return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-[9px]">Ejecutando</Badge>;
    case 'waiting_user': return <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30 text-[9px]">Esperando</Badge>;
    case 'cancelled': return <Badge className="bg-zinc-500/20 text-zinc-400 border-zinc-500/30 text-[9px]">Cancelado</Badge>;
  }
}

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(dateStr: string): string {
  const [, month, day] = dateStr.split('-');
  return `${day}/${month}`;
}

function NewsMetrics({ payload }: { payload: NewsDetailPayload }) {
  const sources = Object.entries(payload.sourceStats).sort((a, b) => b[1] - a[1]);
  const maxCount = sources.length > 0 ? sources[0][1] : 1;
  const { clusterStats } = payload;
  const totalClusters = clusterStats.clusters || 1;

  return (
    <div className="mt-2 ml-5 rounded border border-white/5 bg-zinc-950 p-2 space-y-2">
      {/* Deduplication */}
      <div className="text-[10px] text-zinc-400">
        <span className="text-zinc-300 font-medium">{payload.totalRaw}</span> raw →{' '}
        <span className="text-zinc-300 font-medium">{payload.totalRaw - payload.duplicatesRemoved}</span> únicas
        <span className="text-zinc-600 ml-1">(-{payload.duplicatesRemoved} duplicados, {payload.deduplicationRate})</span>
      </div>

      {/* Source breakdown */}
      <div className="space-y-1">
        {sources.map(([source, count]) => (
          <div key={source} className="flex items-center gap-2 text-[10px]">
            <span className="text-zinc-500 w-28 truncate shrink-0">{source}</span>
            <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500/60 rounded-full"
                style={{ width: `${(count / maxCount) * 100}%` }}
              />
            </div>
            <span className="text-zinc-400 w-8 text-right shrink-0">{count}</span>
          </div>
        ))}
      </div>

      {/* Cluster stats */}
      {clusterStats.total > 0 && (
        <div className="text-[10px] text-zinc-500">
          <span className="text-zinc-400 font-medium">{clusterStats.clusters}</span> clusters —{' '}
          <span className="text-green-400">{clusterStats.high} alta</span>{' '}
          <span className="text-yellow-400">{clusterStats.medium} media</span>{' '}
          <span className="text-zinc-600">{clusterStats.low} baja</span>
          <div className="mt-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden flex">
            <div className="h-full bg-green-500/60" style={{ width: `${(clusterStats.high / totalClusters) * 100}%` }} />
            <div className="h-full bg-yellow-500/50" style={{ width: `${(clusterStats.medium / totalClusters) * 100}%` }} />
            <div className="h-full bg-zinc-600/40" style={{ width: `${(clusterStats.low / totalClusters) * 100}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
  history: PipelineRun[];
  onRerunStage: (stage: 'webSearch' | 'news' | 'fundamentals' | 'analysis' | 'report') => void | Promise<void>;
  onRerunAll: () => void | Promise<void>;
  isRunning: boolean;
}

export function PipelineHistoryModal({ open, onClose, history, onRerunStage, onRerunAll, isRunning }: Props) {
  const today = new Date().toISOString().split('T')[0];
  const [expandedNews, setExpandedNews] = useState<Set<number>>(new Set());

  const toggleNewsExpand = (runId: number) => {
    setExpandedNews(prev => {
      const next = new Set(prev);
      next.has(runId) ? next.delete(runId) : next.add(runId);
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto bg-zinc-950 border-white/10">
        <DialogHeader>
          <DialogTitle className="text-sm font-medium text-zinc-200">Historial del Pipeline</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 mt-2">
          {history.length === 0 && (
            <p className="text-[11px] text-zinc-500 text-center py-4">Sin ejecuciones registradas.</p>
          )}
          {history.map((run) => {
            const isToday = run.date === today;
            const hasAnyFailed = Object.values(run.stages).some(s => s.status === 'failed');
            const hasAnyPartial = Object.values(run.stages).some(s => s.status === 'partial');
            return (
              <div key={run.id} className="rounded-md border border-white/5 bg-zinc-900/50 p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-medium text-zinc-300">
                      {isToday ? 'Hoy ' : ''}{formatDate(run.date)}
                    </span>
                    {overallBadge(run.status)}
                  </div>
                  {(hasAnyFailed || hasAnyPartial) && !isRunning && (
                    <Button size="sm" variant="outline" className="h-6 text-[10px] border-white/10" onClick={onRerunAll}>
                      Re-correr todo
                    </Button>
                  )}
                </div>
                <div className="space-y-1">
                  {(['webSearch', 'news', 'fundamentals', 'analysis', 'report'] as const).map((stage) => {
                    const s = run.stages[stage];
                    const canRerun = (s.status === 'failed' || s.status === 'partial') && !isRunning;
                    const duration = formatDuration(s.startedAt, s.finishedAt);

                    const newsPayload = stage === 'news' && s.detail ? parseNewsDetail(s.detail) : null;
                    const displayDetail = newsPayload ? newsPayload.text : s.detail;
                    const isNewsExpanded = expandedNews.has(run.id);

                    return (
                      <div key={stage}>
                        <div className="flex items-start gap-2 text-[10px]">
                          <span className="mt-0.5 shrink-0">{stageIcon(s.status)}</span>
                          <div className="flex-1 min-w-0">
                            <span className="text-zinc-400 font-medium">{STAGE_LABELS[stage]}</span>
                            {s.startedAt && <span className="text-zinc-600 ml-1">{formatTime(s.startedAt)}</span>}
                            {duration && <span className="text-zinc-700 ml-1">({duration})</span>}
                            {displayDetail && <span className="text-zinc-500 ml-1 truncate block">{displayDetail}</span>}
                            {s.criticalError && <span className="text-red-400 block mt-0.5">{s.criticalError.slice(0, 80)}</span>}
                            {s.errors.length > 0 && (
                              <div className="text-yellow-500/70 mt-0.5">
                                {s.errors.slice(0, 2).map((e, i) => <div key={i}>{e.slice(0, 60)}</div>)}
                              </div>
                            )}
                          </div>
                          <div className="flex gap-1 shrink-0">
                            {newsPayload && (
                              <button
                                className="h-5 text-[9px] px-1.5 text-zinc-600 hover:text-zinc-400"
                                onClick={() => toggleNewsExpand(run.id)}
                              >
                                {isNewsExpanded ? '▲' : '▼'}
                              </button>
                            )}
                            {canRerun && (
                              <Button size="sm" variant="ghost" className="h-5 text-[9px] px-1.5 text-blue-400 hover:text-blue-300" onClick={() => onRerunStage(stage)}>
                                Re-correr ▶
                              </Button>
                            )}
                          </div>
                        </div>
                        {stage === 'news' && newsPayload && isNewsExpanded && (
                          <NewsMetrics payload={newsPayload} />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
