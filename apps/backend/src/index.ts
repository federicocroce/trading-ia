import dotenv from 'dotenv';
import { resolve } from 'path';

// Load .env from monorepo root (CWD may be apps/backend/ via npm workspaces)
dotenv.config({ path: resolve(process.cwd(), '../../.env') });
dotenv.config(); // Also try local .env as fallback

import { initDatabase } from './db/init.js';
initDatabase();

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { trpcServer } from '@hono/trpc-server';
import { serve } from '@hono/node-server';
import { appRouter } from './router.js';
import { createContext } from './trpc.js';
import { initWebSocket } from './shared/ws-manager.js';

const app = new Hono();

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';
const PORT = Number(process.env.PORT ?? 3001);

// CORS
app.use('/*', cors({ origin: FRONTEND_URL }));

// Health check
app.get('/health', (c) => c.json({ status: 'ok', timestamp: Date.now() }));

// tRPC
app.use(
  '/trpc/*',
  trpcServer({
    router: appRouter,
    createContext: (_opts, _c) => createContext(),
  })
);

// Start server — serve() returns the underlying http.Server
const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`🚀 Backend running on http://localhost:${info.port}`);
  console.log(`   tRPC:      http://localhost:${info.port}/trpc`);
  console.log(`   WebSocket: ws://localhost:${info.port}/ws/prices`);
  console.log(`   Health:    http://localhost:${info.port}/health`);
});

// Attach WebSocket to the same server
initWebSocket(server as any);
