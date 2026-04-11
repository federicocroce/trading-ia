import { trpc } from '@/shared/trpc';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

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

const statusConfig: Record<ServiceStatus, { dot: string; label: string }> = {
  ok: { dot: 'bg-green-500', label: 'OK' },
  degraded: { dot: 'bg-yellow-500', label: 'Degradado' },
  error: { dot: 'bg-red-500', label: 'Error' },
};

function timeAgo(ts: number | null): string {
  if (!ts) return 'nunca';
  const diff = Math.round((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.round(diff / 60)}min`;
  return `${Math.round(diff / 3600)}h`;
}

function ServiceDot({ service }: { service: ServiceState }) {
  const cfg = statusConfig[service.status];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-1 cursor-help">
          <div className={`w-2 h-2 rounded-full ${cfg.dot}`} />
          <span className={`text-[9px] font-mono ${service.status === 'ok' ? 'text-muted-foreground' : service.status === 'degraded' ? 'text-yellow-400' : 'text-red-400'}`}>
            {service.name}
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <p className="font-semibold">{service.name}: {cfg.label}</p>
        {service.errorMessage && (
          <p className="text-xs text-red-400 mt-1">{service.errorMessage}</p>
        )}
        <div className="text-[10px] text-muted-foreground mt-1 space-y-0.5">
          {service.lastOk && <p>Ultimo exito: hace {timeAgo(service.lastOk)}</p>}
          {service.lastError && <p>Ultimo error: hace {timeAgo(service.lastError)}</p>}
          {service.errorCount > 0 && <p>Errores consecutivos: {service.errorCount}</p>}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

export function ServiceHealthBar() {
  const { data } = trpc.health.useQuery(undefined, {
    refetchInterval: 30_000, // poll every 30s
    staleTime: 15_000,
  });

  if (!data || data.services.length === 0) return null;

  const hasProblems = data.services.some((s) => s.status !== 'ok');

  // If everything is OK, show a minimal indicator
  if (!hasProblems) {
    return (
      <div className="flex items-center gap-1.5">
        <div className="w-2 h-2 rounded-full bg-green-500" />
        <span className="text-[9px] text-muted-foreground">Servicios OK</span>
      </div>
    );
  }

  // Show problems prominently
  const problems = data.services.filter((s) => s.status !== 'ok');
  const okServices = data.services.filter((s) => s.status === 'ok');

  return (
    <div className="space-y-1">
      {/* Problem banner */}
      <div className="flex items-center gap-2 px-2 py-1 rounded bg-red-500/10 border border-red-500/20">
        <Badge className="text-[9px] bg-red-500/20 text-red-400 h-4 shrink-0">
          {problems.length} {problems.length === 1 ? 'servicio con problemas' : 'servicios con problemas'}
        </Badge>
        <div className="flex items-center gap-3 flex-wrap">
          {problems.map((s) => (
            <ServiceDot key={s.name} service={s} />
          ))}
        </div>
      </div>
      {/* OK services inline */}
      {okServices.length > 0 && (
        <div className="flex items-center gap-3 px-2">
          {okServices.map((s) => (
            <ServiceDot key={s.name} service={s} />
          ))}
        </div>
      )}
    </div>
  );
}
