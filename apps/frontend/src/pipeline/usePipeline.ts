import { useEffect, useRef } from 'react';
import { trpc } from '@/shared/trpc';
import type { PipelineRun } from '@trading/shared';

const POLL_INTERVAL_MS = 2000;

function isActiveStatus(status: string | undefined): boolean {
  return status === 'running' || status === 'waiting_user';
}

export function usePipeline() {
  const utils = trpc.useUtils();

  // Polling derivado del estado del SERVER, no de estado local del hook:
  // cualquier instancia pollea mientras el run este vivo — sobrevive recargas,
  // funciona aunque el run lo haya disparado otro componente, y detecta el final.
  // (El bug previo: isPolling local solo se prendia en onSuccess del mutation, que
  // con el backend bloqueante no respondia hasta terminar el pipeline.)
  const statusQuery = trpc.intelligence.pipelineStatus.useQuery(undefined, {
    refetchInterval: (query) => (isActiveStatus(query.state.data?.status) ? POLL_INTERVAL_MS : false),
    staleTime: 5_000,
  });

  const historyQuery = trpc.intelligence.pipelineHistory.useQuery({ limit: 7 });

  // El backend ahora es fire-and-forget y devuelve el run YA creado/marcado como
  // running → setData lo refleja al instante (boton/toast cambian sin esperar al
  // proximo poll) y el refetchInterval de arriba toma la posta.
  const applyRun = (run: PipelineRun | null) => {
    if (run) utils.intelligence.pipelineStatus.setData(undefined, run);
    utils.intelligence.pipelineStatus.invalidate();
  };

  const runMutation = trpc.intelligence.generateMarketReport.useMutation({ onSuccess: applyRun });
  const rerunMutation = trpc.intelligence.rerunStage.useMutation({ onSuccess: applyRun });
  const resolveWebSearchMutation = trpc.intelligence.resolveWebSearch.useMutation({ onSuccess: applyRun });

  // Transicion activo → terminal: refrescar lo que el run acaba de regenerar.
  const prevStatus = useRef<string | undefined>(undefined);
  useEffect(() => {
    const status = statusQuery.data?.status;
    if (isActiveStatus(prevStatus.current) && status && !isActiveStatus(status)) {
      utils.intelligence.marketReport.invalidate();
      utils.intelligence.pipelineHistory.invalidate();
    }
    prevStatus.current = status;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusQuery.data?.status]);

  const todayRun = statusQuery.data ?? null;
  const isRunning = todayRun?.status === 'running';
  const isWaitingUser = todayRun?.status === 'waiting_user';

  return {
    run: (force = false, sectors?: string[], aiMode: 'cloud' | 'local' = 'cloud') =>
      runMutation.mutate({ force, sectors, aiMode }),
    rerunStage: (stage: 'webSearch' | 'news' | 'fundamentals' | 'analysis' | 'report', aiMode: 'cloud' | 'local' = 'cloud') =>
      rerunMutation.mutate({ stage, aiMode }),
    resolveWebSearch: (action: 'retry' | 'skip' | 'cancel') => resolveWebSearchMutation.mutate({ action }),
    status: todayRun,
    history: historyQuery.data ?? [],
    isRunning,
    isWaitingUser,
    todayRun,
    isLoading: statusQuery.isLoading,
  };
}
