import { useState, useEffect } from 'react';
import { trpc } from '@/shared/trpc';
import type { PipelineRun } from '@trading/shared';

const POLL_INTERVAL_MS = 2000;

export function usePipeline() {
  const utils = trpc.useUtils();
  const [isPolling, setIsPolling] = useState(false);

  const statusQuery = trpc.intelligence.pipelineStatus.useQuery(undefined, {
    refetchInterval: isPolling ? POLL_INTERVAL_MS : false,
    staleTime: isPolling ? 0 : 30_000,
  });

  const historyQuery = trpc.intelligence.pipelineHistory.useQuery({ limit: 7 });

  const runMutation = trpc.intelligence.generateMarketReport.useMutation({
    onSuccess: () => {
      setIsPolling(true);
      utils.intelligence.pipelineStatus.invalidate();
    },
  });

  const rerunMutation = trpc.intelligence.rerunStage.useMutation({
    onSuccess: () => {
      setIsPolling(true);
      utils.intelligence.pipelineStatus.invalidate();
    },
  });

  useEffect(() => {
    const status = statusQuery.data?.status;
    if (status && status !== 'running') {
      setIsPolling(false);
      utils.intelligence.marketReport.invalidate();
      utils.intelligence.pipelineHistory.invalidate();
    }
  }, [statusQuery.data?.status]);

  const todayRun = statusQuery.data ?? null;
  const isRunning = todayRun?.status === 'running';

  return {
    run: (force = false) => runMutation.mutate({ force }),
    rerunStage: (stage: 'news' | 'fundamentals' | 'analysis' | 'report') => rerunMutation.mutate({ stage }),
    status: todayRun,
    history: historyQuery.data ?? [],
    isRunning,
    todayRun,
    isLoading: statusQuery.isLoading,
  };
}
