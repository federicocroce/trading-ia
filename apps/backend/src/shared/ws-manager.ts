import type { Server } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import type { Price } from '@trading/shared';
import { getQuotes } from './yahoo.js';
import { getActiveSymbolList } from '../db/repository.js';
import { envNumber } from './env-number.js';

let wss: WebSocketServer | null = null;
let intervalId: ReturnType<typeof setInterval> | null = null;

export function initWebSocket(server: Server) {
  wss = new WebSocketServer({ server, path: '/ws/prices' });

  wss.on('connection', (ws) => {
    console.log('[WS] Client connected');

    ws.on('close', () => {
      console.log('[WS] Client disconnected');
    });
  });

  // Broadcast de precios. Un fan-out del universo (~196 símbolos, un request por símbolo)
  // tarda más en drenar el limitador global de Yahoo (6 slots) que el intervalo: sin el
  // guard, los ticks se apilaban sin límite y la cola de Yahoo nunca se vaciaba — todo lo
  // demás que toca Yahoo (validación de tickers, market regime, fundamentals) esperaba
  // minutos detrás del streamer. Un tick nuevo no arranca si el anterior sigue en vuelo.
  let tickInFlight = false;
  intervalId = setInterval(async () => {
    if (!wss || wss.clients.size === 0) return;
    if (tickInFlight) return;
    tickInFlight = true;

    try {
      const prices = await getQuotes(getActiveSymbolList());
      const data = JSON.stringify({ type: 'prices', data: prices });

      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(data);
        }
      });
    } catch (err) {
      console.error('[WS] Error fetching prices:', err);
    } finally {
      tickInFlight = false;
    }
  }, envNumber('WS_PRICES_INTERVAL_MS', 30_000));

  console.log('[WS] WebSocket server initialized on /ws/prices');
}

export function broadcastPrices(prices: Price[]) {
  if (!wss) return;

  const data = JSON.stringify({ type: 'prices', data: prices });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

/**
 * Eventos del chat agéntico (deltas de texto, actividad de tools) hacia el frontend.
 * Reusa el mismo WS de precios: el cliente filtra por `type === 'chat_agent'` y
 * correlaciona por requestId, así el canal de precios no cambia.
 */
export function broadcastChatAgentEvent(payload: Record<string, unknown>) {
  if (!wss) return;

  const data = JSON.stringify({ type: 'chat_agent', ...payload });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

export function closeWebSocket() {
  if (intervalId) clearInterval(intervalId);
  if (wss) wss.close();
}
