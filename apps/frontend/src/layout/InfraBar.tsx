import { useState } from 'react';
import { trpc } from '@/shared/trpc';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { History, Play } from 'lucide-react';
import { getStaleness } from '@/hooks/useDataStaleness';
import { PipelineHistoryModal } from '@/pipeline/PipelineHistoryModal';
import { PipelineStatusToast } from '@/pipeline/PipelineStatusToast';
import { usePipeline } from '@/pipeline/usePipeline';
import { useAiModeModal } from '@/shared/AiModeModal';

type ServiceStatus = 'ok' | 'degraded' | 'error';

interface ServiceState {
  name: string;
  status: ServiceStatus;
  lastOk: number | null;
  lastError: number | null;
  errorMessage: string | null;
  errorCount: number;
  successCount: number;
}

const DOT_COLOR: Record<ServiceStatus, string> = {
  ok: 'bg-green-500',
  degraded: 'bg-yellow-500',
  error: 'bg-red-500',
};

const TEXT_COLOR: Record<ServiceStatus, string> = {
  ok: 'text-muted-foreground',
  degraded: 'text-yellow-400',
  error: 'text-red-400',
};

function ServicePill({ service }: { service: ServiceState }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-1 cursor-help">
          <div className={`w-1.5 h-1.5 rounded-full ${DOT_COLOR[service.status]}`} />
          <span className={`text-[10px] font-mono ${TEXT_COLOR[service.status]}`}>
            {service.name}
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs space-y-1">
        <p className="font-semibold text-xs">
          {service.name}: {service.status === 'ok' ? 'OK' : service.status === 'degraded' ? 'Degradado' : 'Error'}
        </p>
        {service.errorMessage && (
          <p className="text-xs text-red-400">{service.errorMessage}</p>
        )}
        {service.lastOk && (
          <p className="text-[10px] text-muted-foreground">
            Último éxito: {getStaleness(service.lastOk).label}
          </p>
        )}
        {service.errorCount > 0 && (
          <p className="text-[10px] text-muted-foreground">
            Errores consecutivos: {service.errorCount}
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

// Semáforo: verde=ok/skipped hoy, rojo=failed, amarillo=no corrió hoy
type StageLight = 'ok' | 'failed' | 'pending';

const STAGE_DOT: Record<StageLight, string> = {
  ok: 'bg-green-500',
  failed: 'bg-red-500',
  pending: 'bg-yellow-500',
};

const STAGE_TEXT: Record<StageLight, string> = {
  ok: 'text-muted-foreground',
  failed: 'text-red-400',
  pending: 'text-yellow-400',
};

interface StagePillProps {
  label: string;
  light: StageLight;
  timestamp: number | null;
  detail?: string;
}

function StagePill({ label, light, timestamp, detail }: StagePillProps) {
  const s = getStaleness(timestamp);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-1 cursor-help">
          <div className={`w-1.5 h-1.5 rounded-full ${STAGE_DOT[light]}`} />
          <span className={`text-[10px] font-mono ${STAGE_TEXT[light]}`}>
            {label}
          </span>
          {timestamp && (
            <span className={`text-[10px] font-mono ${
              s.level === 'fresh' ? 'text-muted-foreground' :
              s.level === 'warning' ? 'text-yellow-400' : 'text-red-400'
            }`}>
              {s.label}
            </span>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs space-y-1">
        <p className="font-semibold text-xs">{label}</p>
        {detail && <p className="text-[10px] text-muted-foreground">{detail}</p>}
        <p className="text-[10px] text-muted-foreground">Para re-ejecutar este paso usá el botón "Re-ejecutar paso" →</p>
        {light === 'failed' && <p className="text-[10px] text-red-400">Último intento falló</p>}
        {light === 'pending' && <p className="text-[10px] text-yellow-400">No corrió hoy</p>}
        {light === 'ok' && timestamp && <p className="text-[10px] text-green-400">OK — {getStaleness(timestamp).label}</p>}
      </TooltipContent>
    </Tooltip>
  );
}

function ScanProgress() {
  const { data: status } = trpc.opportunities.scanStatus.useQuery(undefined, {
    refetchInterval: 2000,
  });

  if (!status?.isScanning) return null;

  const elapsed = status.elapsedSeconds ?? 0;
  const min = Math.floor(elapsed / 60);
  const sec = elapsed % 60;

  return (
    <div className="flex items-center gap-2 border-l border-border pl-2">
      <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
      <span className="text-[10px] text-blue-400 font-medium">
        {status.currentStep} ({status.stepNumber}/{status.totalSteps})
      </span>
      <div className="h-1 w-14 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-blue-500 transition-all duration-1000"
          style={{ width: `${status.percentComplete}%` }}
        />
      </div>
      <span className="text-[9px] text-muted-foreground">
        {min}:{sec.toString().padStart(2, '0')}
      </span>
    </div>
  );
}

function isToday(timestamp: number | null): boolean {
  if (!timestamp) return false;
  const d = new Date(timestamp);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
}

export function InfraBar() {
  const [modalOpen, setModalOpen] = useState(false);

  const { data: health, refetch } = trpc.health.useQuery(undefined, {
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
  const utils = trpc.useUtils();

  const { data: timestamps } = trpc.opportunities.processTimestamps.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  const { todayRun, history, isRunning, run, rerunStage } = usePipeline();
  const { selectMode, modal } = useAiModeModal();
  const [stageToRerun, setStageToRerun] = useState<'news' | 'fundamentals' | 'analysis' | 'report' | ''>('');

  const services: ServiceState[] = (health?.services as ServiceState[]) ?? [];
  const hasServiceProblems = services.some((s) => s.status !== 'ok');

  // Determinar estado de cada stage del pipeline
  const today = new Date().toISOString().split('T')[0];

  function stageLight(stageKey: 'news' | 'fundamentals' | 'analysis' | 'report', tsMs: number | null): StageLight {
    if (todayRun) {
      const s = todayRun.stages[stageKey].status;
      if (s === 'ok' || s === 'skipped') return 'ok';
      if (s === 'failed') return 'failed';
      if (s === 'partial') return 'ok'; // parcial = corrió con advertencias
    }
    // Sin run de hoy — usar timestamps
    if (isToday(tsMs)) return 'ok';
    return 'pending';
  }

  const newsDetail = todayRun?.stages.news.detail;
  const fundamentalsDetail = todayRun?.stages.fundamentals?.detail;
  const analysisDetail = todayRun?.stages.analysis.detail;
  const reportDetail = todayRun?.stages.report.detail;

  // Para reporte: usamos el market report timestamp si existe
  const { data: marketReport } = trpc.intelligence.marketReport.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const reportTs = marketReport ? Date.now() : null; // si hay reporte de hoy, está fresco

  const openModal = () => setModalOpen(true);

  return (
    <>
      <div
        className={`h-8 flex items-center px-3 gap-3 border-b text-[10px] shrink-0 transition-colors ${
          hasServiceProblems ? 'bg-red-500/5 border-red-500/20' : 'bg-background border-border'
        }`}
        role="status"
        aria-label="Estado del sistema"
      >
        {/* Servicios externos */}
        <div className="flex items-center gap-2">
          {hasServiceProblems ? (
            <span className="text-red-400 font-semibold shrink-0">
              {services.filter(s => s.status !== 'ok').length} caído{services.filter(s => s.status !== 'ok').length > 1 ? 's' : ''}
            </span>
          ) : (
            <div className="flex items-center gap-1 shrink-0">
              <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
              <span className="text-muted-foreground">Servicios OK</span>
            </div>
          )}
          {services.map((s) => (
            <ServicePill key={s.name} service={s} />
          ))}
        </div>

        {/* Separador */}
        <span className="text-border shrink-0">|</span>

        {/* Pipeline stages — solo informativos. Re-ejecución vía botón explicito → */}
        <div className="flex items-center gap-3">
          <StagePill
            label="Noticias"
            light={stageLight('news', timestamps?.news ?? null)}
            timestamp={timestamps?.news ?? null}
            detail={newsDetail}
          />
          <StagePill
            label="Fundamentales"
            light={stageLight('fundamentals', timestamps?.fundamentals ?? null)}
            timestamp={timestamps?.fundamentals ?? null}
            detail={fundamentalsDetail ?? 'Datos fundamentales de Yahoo Finance'}
          />
          <StagePill
            label="Análisis"
            light={stageLight('analysis', timestamps?.analysis ?? null)}
            timestamp={timestamps?.analysis ?? null}
            detail={analysisDetail}
          />
          <StagePill
            label="Reporte"
            light={stageLight('report', reportTs)}
            timestamp={reportTs}
            detail={reportDetail}
          />
        </div>

        {/* Scan en progreso */}
        <ScanProgress />

        {/* Pipeline corriendo — indicador animado */}
        {isRunning && (
          <div className="flex items-center gap-1.5 border-l border-border pl-2">
            <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
            <span className="text-[10px] text-blue-400">Pipeline ejecutando...</span>
          </div>
        )}

        {/* Spacer empuja botones a la derecha */}
        <div className="ml-auto flex items-center gap-2">
          {/* Re-ejecutar paso puntual con dropdown */}
          <Select
            value={stageToRerun}
            onValueChange={async (v) => {
              if (!v) return;
              setStageToRerun(v as typeof stageToRerun);
              const stage = v as 'news' | 'fundamentals' | 'analysis' | 'report';
              const mode = await selectMode();
              setStageToRerun('');
              if (!mode) return;
              rerunStage(stage, mode);
            }}
            disabled={isRunning}
          >
            <SelectTrigger className="h-5 text-[10px] px-2 gap-1 bg-card border-border/60 w-auto min-w-32">
              <Play className="h-2.5 w-2.5 text-blue-400" />
              <SelectValue placeholder="Re-ejecutar paso" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="news" className="text-xs">Noticias</SelectItem>
              <SelectItem value="fundamentals" className="text-xs">Fundamentales</SelectItem>
              <SelectItem value="analysis" className="text-xs">Análisis</SelectItem>
              <SelectItem value="report" className="text-xs">Reporte</SelectItem>
            </SelectContent>
          </Select>

          {/* Historial */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                onClick={openModal}
                variant="outline"
                size="sm"
                className="h-5 px-2 text-[10px] gap-1 border-border/60"
              >
                <History className="h-2.5 w-2.5" />
                Historial
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs">Ver historial de runs del pipeline</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      <PipelineHistoryModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        history={history}
        onRerunStage={async (stage) => { const mode = await selectMode(); if (!mode) return; rerunStage(stage, mode); }}
        onRerunAll={async () => { const mode = await selectMode(); if (!mode) return; run(false, undefined, mode); }}
        isRunning={isRunning}
      />
      {modal}

      {todayRun && isRunning && <PipelineStatusToast run={todayRun} />}
    </>
  );
}
