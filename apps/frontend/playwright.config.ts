import { defineConfig } from '@playwright/test';

/**
 * ⚠️ ARREGLADO 2026-07-28: apuntaba a `localhost:5173` (el default de Vite) mientras la app
 * corre en **5050** (`strictPort: true` en vite.config.ts). Resultado: el e2e **nunca pudo
 * correr** — el webServer vencía por timeout y la suite abortaba antes del primer test.
 *
 * Por eso el smoke verificaba tabs que no existían (incluida "Noticias", que nunca existió):
 * nadie lo vio fallar jamás. Un test que no corre no es cobertura, es decoración.
 *
 * `command` levanta el monorepo entero (backend + frontend): sin backend la app carga pero
 * todas las queries fallan, y los tests darían falsos negativos.
 */
const PORT = 5050;

export default defineConfig({
  testDir: './e2e',
  // Sin paralelismo: los tests comparten un backend con SQLite y datos reales.
  workers: 1,
  use: {
    baseURL: `http://localhost:${PORT}`,
    headless: true,
  },
  webServer: {
    command: 'npm run dev --prefix ../..',
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    // El backend corre migraciones y siembra config al arrancar: 30s no alcanzaba.
    timeout: 120_000,
  },
});
