import { trpc } from '@/shared/trpc';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { getStaleness } from '@/hooks/useDataStaleness';

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

const DOT: Record<ServiceStatus, string> = {
  ok: 'bg-green-500',
  degraded: 'bg-yellow-500',
  error: 'bg-red-500',
};

const TEXT_COLOR: Record<ServiceStatus, string> = {
  ok: 'text-muted-foreground',
  degraded: 'text-yellow-400',
  error: 'text-red-400',
};

function ServicePill({ service, onRetry }: { service: ServiceState; onRetry?: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-1 cursor-help">
          <div className={`w-1.5 h-1.5 rounded-full ${DOT[service.status]}`} />
          <span className={`text-[10px] font-mono ${TEXT_COLOR[service.status]}`}>
            {service.name}
          </span>
          {service.status !== 'ok' && service.lastError && (
            <span className="text-[9px] text-muted-foreground">
              ({getStaleness(service.lastError).label})
            </span>
          )}
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
        {onRetry && service.status !== 'ok' && (
          <button
            onClick={onRetry}
            className="text-[10px] text-blue-400 hover:text-blue-300 underline mt-1 block"
          >
            Reintentar
          </button>
        )}
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

function DataTimestamps() {
  const { data: timestamps } = trpc.opportunities.processTimestamps.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  if (!timestamps) return null;

  const items = [
    { key: 'N', ts: timestamps.news, label: 'Noticias' },
    { key: 'F', ts: timestamps.fundamentals, label: 'Fundamentales' },
    { key: 'A', ts: timestamps.analysis, label: 'Análisis' },
  ];

  return (
    <div className="flex items-center gap-2 border-l border-border pl-2">
      {items.map(({ key, ts, label }) => {
        const s = getStaleness(ts ?? null);
        const color =
          s.level === 'fresh' ? 'text-muted-foreground' :
          s.level === 'warning' ? 'text-yellow-400' :
          'text-red-400';
        return (
          <Tooltip key={key}>
            <TooltipTrigger asChild>
              <span className={`text-[10px] font-mono cursor-help ${color}`}>
                {key}:{s.label}
              </span>
            </TooltipTrigger>
            <TooltipContent>{label}: última actualización {s.label}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

export function InfraBar() {
  const { data, refetch } = trpc.health.useQuery(undefined, {
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
  const utils = trpc.useUtils();

  const handleRetry = () => {
    refetch();
    utils.invalidate();
  };

  const services: ServiceState[] = (data?.services as ServiceState[]) ?? [];
  const hasProblems = services.some((s) => s.status !== 'ok');
  const problems = services.filter((s) => s.status !== 'ok');
  const okServices = services.filter((s) => s.status === 'ok');

  return (
    <div
      className={`h-7 flex items-center px-3 gap-3 border-b text-[10px] shrink-0 transition-colors ${
        hasProblems ? 'bg-red-500/5 border-red-500/20' : 'bg-background border-border'
      }`}
      role="status"
      aria-label="Estado de servicios"
    >
      {hasProblems ? (
        <>
          <span className="text-red-400 font-semibold shrink-0">
            {problems.length} {problems.length === 1 ? 'servicio caído' : 'servicios caídos'}
          </span>
          {problems.map((s) => (
            <ServicePill key={s.name} service={s} onRetry={handleRetry} />
          ))}
          {okServices.length > 0 && (
            <>
              <span className="text-border">|</span>
              {okServices.map((s) => <ServicePill key={s.name} service={s} />)}
            </>
          )}
        </>
      ) : (
        <>
          <div className="flex items-center gap-1 shrink-0">
            <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
            <span className="text-muted-foreground">Servicios OK</span>
          </div>
          {services.map((s) => <ServicePill key={s.name} service={s} />)}
        </>
      )}

      <ScanProgress />
      <DataTimestamps />
    </div>
  );
}
