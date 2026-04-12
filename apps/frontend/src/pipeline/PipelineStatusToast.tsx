import type { PipelineRun, StageStatus } from '@trading/shared';

const STAGE_LABELS = { news: 'Noticias', fundamentals: 'Fundamentales', analysis: 'Análisis', report: 'Reporte' } as const;

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

interface Props { run: PipelineRun; }

export function PipelineStatusToast({ run }: Props) {
  if (run.status !== 'running') return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 min-w-[260px] rounded-lg border border-white/10 bg-zinc-900 p-3 shadow-xl">
      <div className="mb-2 text-[11px] font-medium text-zinc-300">🔄 Ejecutando pipeline...</div>
      {(['news', 'fundamentals', 'analysis', 'report'] as const).map((stage) => {
        const s = run.stages[stage];
        return (
          <div key={stage} className="flex items-center gap-2 py-0.5 text-[11px]">
            <span>{stageIcon(s.status)}</span>
            <span className="text-zinc-400">{STAGE_LABELS[stage]}</span>
            {s.status === 'running' && <span className="text-zinc-500">en curso...</span>}
            {(s.status === 'ok' || s.status === 'partial') && s.detail && (
              <span className="text-zinc-500 truncate max-w-[150px]">{s.detail.split('.')[0]}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
