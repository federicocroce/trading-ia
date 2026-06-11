import { useEffect, useRef } from 'react';
import { trpc } from '@/shared/trpc';

const OPTIN_KEY = 'alerts:notifications';

export function notificationsEnabled(): boolean {
  return typeof window !== 'undefined'
    && 'Notification' in window
    && Notification.permission === 'granted'
    && window.localStorage.getItem(OPTIN_KEY) === 'on';
}

export async function enableNotifications(): Promise<boolean> {
  if (!('Notification' in window)) return false;
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return false;
  window.localStorage.setItem(OPTIN_KEY, 'on');
  return true;
}

export function disableNotifications(): void {
  window.localStorage.setItem(OPTIN_KEY, 'off');
}

/**
 * Polea unseenCount (cadencia diaria de alertas → 60s sobra) y notifica
 * SOLO cuando el count SUBE (alerta nueva), nunca en el primer render.
 */
export function useAlertNotifications() {
  const { data } = trpc.alerts.unseenCount.useQuery(undefined, { refetchInterval: 60_000 });
  const prev = useRef<number | null>(null);

  useEffect(() => {
    const count = data?.count;
    if (count == null) return;
    // No notificar si el usuario ya esta mirando el panel de Alertas con la tab visible.
    const viewingPanel = document.visibilityState === 'visible'
      && new URLSearchParams(window.location.search).get('tab') === 'alertas';
    if (prev.current != null && count > prev.current && !viewingPanel && notificationsEnabled()) {
      // Copy generico: unseenCount no distingue kind (puede ser setup bullish o stop perforado).
      const n = new Notification('⚡ Alertas nuevas', {
        body: `${count - prev.current} alerta(s) nueva(s) — setup anticipatorio o stop perforado. Abrí el panel de Alertas.`,
        tag: 'anticipatory-alerts', // colapsa repetidas
      });
      n.onclick = () => {
        window.focus();
        window.location.search = '?tab=alertas';
      };
    }
    prev.current = count;
  }, [data?.count]);
}
