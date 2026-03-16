import type { Server } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import type { Price } from '@trading/shared';
import { getQuotes } from './yahoo.js';
import { getActiveSymbolList } from '../db/repository.js';

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

  // Broadcast prices every 10 seconds
  intervalId = setInterval(async () => {
    if (!wss || wss.clients.size === 0) return;

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
    }
  }, 10_000);

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

export function closeWebSocket() {
  if (intervalId) clearInterval(intervalId);
  if (wss) wss.close();
}
