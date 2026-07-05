import { useEffect, useRef } from 'react';

export interface ChatAgentEvent {
  type: 'chat_agent';
  requestId: string;
  kind: 'delta' | 'tool' | 'done' | 'error';
  text?: string;
  detail?: string;
  message?: string;
}

/**
 * Escucha los eventos del chat agéntico que el backend emite por el WS de precios
 * (mismo endpoint, filtrados por type === 'chat_agent'). El handler se guarda en un
 * ref para que reconectar no dependa de la identidad del callback.
 */
export function useChatAgentStream(onEvent: (evt: ChatAgentEvent) => void) {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${protocol}//${window.location.host}/ws/prices`);

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'chat_agent') handlerRef.current(msg as ChatAgentEvent);
        } catch { /* mensaje no-JSON: ignorar */ }
      };

      ws.onclose = () => {
        if (!closed) retryTimer = setTimeout(connect, 3000);
      };
      ws.onerror = () => ws?.close();
    };

    connect();
    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      ws?.close();
    };
  }, []);
}
