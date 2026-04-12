import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { usePipeline } from './usePipeline';
import { PipelineHistoryModal } from './PipelineHistoryModal';
import { PipelineStatusToast } from './PipelineStatusToast';

function statusDot(status: string | undefined): string {
  switch (status) {
    case 'ok': return '🟢';
    case 'partial': return '🟡';
    case 'failed': return '🔴';
    case 'running': return '🔵';
    default: return '⚪';
  }
}

function statusClass(status: string | undefined): string {
  switch (status) {
    case 'ok': return 'text-green-400';
    case 'partial': return 'text-yellow-400';
    case 'failed': return 'text-red-400';
    case 'running': return 'text-blue-400 animate-pulse';
    default: return 'text-zinc-500';
  }
}

export function PipelineStatusButton() {
  const [modalOpen, setModalOpen] = useState(false);
  const { status, history, isRunning, run, rerunStage } = usePipeline();

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={`h-7 gap-1.5 text-[11px] px-2 ${statusClass(status?.status)}`}
            onClick={() => setModalOpen(true)}
          >
            <span>{statusDot(status?.status)}</span>
            <span>Pipeline</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-[10px]">
          {status ? `Último run: ${status.date}` : 'Sin ejecuciones hoy'}
        </TooltipContent>
      </Tooltip>

      <PipelineHistoryModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        history={history}
        onRerunStage={rerunStage}
        onRerunAll={() => run(false)}
        isRunning={isRunning}
      />

      {status && isRunning && <PipelineStatusToast run={status} />}
    </>
  );
}
