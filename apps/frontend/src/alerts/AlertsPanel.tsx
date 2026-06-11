import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { trpc } from '@/shared/trpc';
import { useNavigation } from '@/shared/navigation';
import { enableNotifications, disableNotifications, notificationsEnabled } from './useAlertNotifications';

const STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  active: { label: 'VIGENTE', cls: 'bg-purple-500/20 text-purple-400' },
  triggered: { label: 'DISPARADA', cls: 'bg-green-500/20 text-green-400' },
  expired: { label: 'VENCIDA', cls: 'bg-muted text-muted-foreground' },
};

export function AlertsPanel() {
  const utils = trpc.useUtils();
  const { data } = trpc.alerts.list.useQuery({ limit: 100 }, { staleTime: 60_000 });
  const markSeen = trpc.alerts.markSeen.useMutation({
    onSuccess: () => utils.alerts.unseenCount.invalidate(),
  });
  const { goToSymbol } = useNavigation();
  const [notifOn, setNotifOn] = useState(notificationsEnabled());

  // Abrir el panel = marcar todo visto (limpia el badge)
  useEffect(() => {
    markSeen.mutate(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const recent = data?.recent ?? [];

  return (
    <div className="p-4 space-y-3 max-w-3xl mx-auto">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-purple-400">⚡ Alertas Anticipatorias</h2>
      <p className="text-[11px] text-muted-foreground">
        Setups con confluencia de ≥2 señales anticipatorias. Probabilidades, no garantías: usá siempre el stop sugerido.
      </p>
      <Button
        size="sm" variant="outline" className="h-7 text-[10px]"
        onClick={async () => {
          if (notifOn) { disableNotifications(); setNotifOn(false); }
          else setNotifOn(await enableNotifications());
        }}
      >
        {notifOn ? '🔔 Notificaciones activadas — desactivar' : '🔕 Activar notificaciones de escritorio'}
      </Button>
      {recent.length === 0 && (
        <Card size="sm"><CardContent><p className="text-xs text-muted-foreground py-4">Sin alertas todavía. Se generan en cada scan diario cuando ≥2 señales anticipatorias coinciden en un activo.</p></CardContent></Card>
      )}
      {recent.map((a) => {
        const st = STATUS_STYLE[a.status] ?? STATUS_STYLE.active;
        return (
          <Card key={a.id} size="sm" className={[
            a.kind === 'stop_breach' ? 'border-l-4 border-l-red-500'
              : a.status === 'active' ? 'border-l-4 border-l-purple-500' : '',
            a.status !== 'active' ? 'opacity-70' : '',
          ].filter(Boolean).join(' ')}>
            <CardHeader>
              <div className="flex items-center gap-2">
                <button className="text-sm font-bold hover:text-purple-400" onClick={() => goToSymbol(a.symbol)}>{a.symbol}</button>
                {a.kind === 'stop_breach' && <Badge className="text-[9px] bg-red-500/20 text-red-400">STOP PERFORADO</Badge>}
                <Badge className={`text-[9px] ${st.cls}`}>{st.label}</Badge>
                <span className="text-[10px] text-muted-foreground ml-auto">{a.firstSeenDate} → {a.lastSeenDate}</span>
              </div>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {a.signals.map((s, i) => (
                <p key={i} className="text-[11px] text-foreground">• {s.description}{s.estimatedDays != null && s.estimatedDays > 0 ? ` (~${s.estimatedDays}d)` : ''}</p>
              ))}
              <div className="flex gap-3 text-[10px] text-muted-foreground pt-1">
                {a.entryPrice != null && <span>Entrada ${a.entryPrice.toFixed(2)}</span>}
                {a.stopLoss != null && <span>Stop ${a.stopLoss.toFixed(2)}</span>}
                {a.takeProfit != null && <span>Target ${a.takeProfit.toFixed(2)}</span>}
                {a.kind === 'anticipatory' && <span className="ml-auto">score {Math.round(a.score)}</span>}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
