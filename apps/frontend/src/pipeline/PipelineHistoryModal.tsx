import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { PipelineRun, StageStatus } from '@trading/shared';

const STAGE_LABELS = { news: 'Noticias', analysis: 'Análisis', report: 'Reporte' } as const;

function stageIcon(status: StageStatus): string {
  switch (status) {
    case 'ok': return '✅';
    case 'partial': return '⚠️';
    case 'failed': return '❌';
    case 'running': return '⏳';
    case 'skipped': return '⏭️';
    default: return '○';
  }
}

function overallBadge(status: PipelineRun['status']) {
  switch (status) {
    case 'ok': return <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-[9px]">Completo</Badge>;
    case 'partial': return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-[9px]">Parcial</Badge>;
    case 'failed': return <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-[9px]">Fallido</Badge>;
    case 'running': return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-[9px]">Ejecutando</Badge>;
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

interface Props {
  open: boolean;
  onClose: () => void;
  history: PipelineRun[];
  onRerunStage: (stage: 'news' | 'analysis' | 'report') => void;
  onRerunAll: () => void;
  isRunning: boolean;
}

export function PipelineHistoryModal({ open, onClose, history, onRerunStage, onRerunAll, isRunning }: Props) {
  const today = new Date().toISOString().split('T')[0];
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
                  {(['news', 'analysis', 'report'] as const).map((stage) => {
                    const s = run.stages[stage];
                    const canRerun = (s.status === 'failed' || s.status === 'partial') && !isRunning;
                    return (
                      <div key={stage} className="flex items-start gap-2 text-[10px]">
                        <span className="mt-0.5 flex-shrink-0">{stageIcon(s.status)}</span>
                        <div className="flex-1 min-w-0">
                          <span className="text-zinc-400 font-medium">{STAGE_LABELS[stage]}</span>
                          {s.startedAt && <span className="text-zinc-600 ml-1">{formatTime(s.startedAt)}</span>}
                          {s.detail && <span className="text-zinc-500 ml-1 truncate block">{s.detail}</span>}
                          {s.criticalError && <span className="text-red-400 block mt-0.5">{s.criticalError.slice(0, 80)}</span>}
                          {s.errors.length > 0 && (
                            <div className="text-yellow-500/70 mt-0.5">
                              {s.errors.slice(0, 2).map((e, i) => <div key={i}>{e.slice(0, 60)}</div>)}
                            </div>
                          )}
                        </div>
                        {canRerun && (
                          <Button size="sm" variant="ghost" className="h-5 text-[9px] px-1.5 flex-shrink-0 text-blue-400 hover:text-blue-300" onClick={() => onRerunStage(stage)}>
                            Re-correr ▶
                          </Button>
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
