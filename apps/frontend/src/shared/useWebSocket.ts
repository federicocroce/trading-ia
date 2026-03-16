import { useEffect, useRef, useState, useCallback } from 'react';
import type { Price } from '@trading/shared';

interface WSMessage {
  type: 'prices';
  data: Price[];
}

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const [prices, setPrices] = useState<Map<string, Price>>(new Map());
  const [connected, setConnected] = useState(false);

  const connect = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/prices`);

    ws.onopen = () => {
      setConnected(true);
      console.log('[WS] Connected');
    };

    ws.onmessage = (event) => {
      const msg: WSMessage = JSON.parse(event.data);
      if (msg.type === 'prices') {
        setPrices((prev) => {
          const next = new Map(prev);
          msg.data.forEach((p) => next.set(p.symbol, p));
          return next;
        });
      }
    };

    ws.onclose = () => {
      setConnected(false);
      console.log('[WS] Disconnected, reconnecting in 3s...');
      setTimeout(connect, 3000);
    };

    ws.onerror = () => ws.close();

    wsRef.current = ws;
  }, []);

  useEffect(() => {
    connect();
    return () => wsRef.current?.close();
  }, [connect]);

  return { prices, connected };
}
