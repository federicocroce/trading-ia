# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> Documento maestro con objetivo, evidencia acumulada, estado y backlog: `docs/IA/prompt-maestro-mejora-continua.md`. Leelo antes de cualquier trabajo sustancial — este archivo solo resume lo operativo.

## Qué es

Dashboard de trading personal de un swing trader argentino. El sistema NO predice: su valor es disciplina de riesgo (fail-closed, niveles concretos, "hoy no se opera" antes que inventar convicción). Toda mejora debe servir a: anticipar setups, saber entrar/salir, cero humo, coherencia entre secciones.

## Comandos

```bash
npm run dev              # mata puertos 3001/5050 y levanta backend + frontend
npm run build            # buildea packages/shared primero (frontend/backend lo importan desde dist/)
npm run typecheck        # todos los workspaces

# Tests — comando CANÓNICO (único conteo válido):
npm run test --workspace=apps/backend
# Un solo archivo:
npm run test --workspace=apps/backend -- src/opportunities/scoring.test.ts
# NUNCA correr vitest desde la raíz: barre worktrees stale y da conteos falsos.

# E2E (frontend, requiere app levantada):
npx playwright test --config apps/frontend/playwright.config.ts

# DB (siempre --workspace=apps/backend):
npm run db:generate --workspace=apps/backend   # genera migración drizzle — ⚠️ ver landmine abajo
npm run db:migrate --workspace=apps/backend    # aplica migraciones sobre data/trading.db
npm run db:studio --workspace=apps/backend
```

Config en `.env` de la raíz del monorepo (el backend lo carga desde `../../.env`); template en `.env.example`. Backend en puerto 3001 (vía `PORT` en .env; el default del código es 3030), frontend Vite en 5050 con proxy de `/trpc` y `/ws` al backend.

## Arquitectura

Monorepo npm workspaces:

- **`apps/backend`** — Hono + tRPC + drizzle/better-sqlite3. Cada dominio es una carpeta en `src/` (`opportunities/`, `quant/`, `radar/`, `signals/`, `intelligence/`, `news/`, …) con su `*.router.ts` mergeado en `src/router.ts`. WebSocket de precios en `/ws/prices`, cron jobs en `src/shared/cron.ts` (pipeline pre-market 7:30 ET lun-vie).
- **`apps/frontend`** — React 19 + Vite + Tailwind 4 + shadcn/radix. Tabs: hoy / daily / opportunities / portfolio / historico / radar (`src/App.tsx`). Consume el tipo `AppRouter` del backend vía el export `@trading/backend/trpc`.
- **`packages/shared`** — tipos y constantes. Se importa desde `dist/`: si cambiás algo acá, `npm run build:shared` antes de que backend/frontend lo vean.

**Flujo core**: pipeline diario → noticias → extracción de tickers → screener de mercado (Yahoo) → scan técnico+fundamental (~110-130 símbolos) → scoring compuesto → veredictos con niveles → digest LLM → vista "Hoy".

**Datos**: `data/trading.db` (SQLite WAL). Tablas clave: `opportunity_scans`/`opportunity_snapshots`, `signal_tracking` (R-multiples), `anticipatory_alerts`, `discovered_symbols`, `cycle_radar_snapshots`, `market_digests`.

**LLMs**: router multi-provider con fallbacks + circuit breaker (Gemini, Groq, OpenRouter free, LM Studio local, Anthropic en chat). El LLM es capa narrativa: su `action` solo puede DEGRADAR un veredicto (gate `applyLlmAction`), jamás subirlo.

## Reglas duras (violarlas = rechazo en review)

1. **Fail-closed**: dato faltante = rechazo/null honesto, nunca neutral ni pass silencioso.
2. **Jerarquía de decisión**: stop tocado → VENDER (dura); motor SELL sin stop → REVISAR (advisory); LLM solo degrada. No tocar sin releer el prompt maestro.
3. **`envNumber` lazy** (`apps/backend/src/shared/env-number.ts`): toda constante configurable se lee DENTRO de la función. Jamás `process.env` a nivel módulo — el hoisting ESM corre antes de `dotenv.config()` y deja la env var inerte.
4. **Payloads tRPC aditivos**: campos nuevos por spread sobre el shape existente; nunca wrappers que rompan consumidores.
5. **Convenciones**: comentarios en español, imports ESM con extensión `.js`, TDD (test rojo primero) para toda lógica, funciones de decisión puras (sin I/O).
6. **Migraciones drizzle — LANDMINE**: `initDatabase()` corre `migrate()` en CADA boot del backend. Generar una migración = asumir que se aplica en el próximo arranque; backup de `data/trading.db` ANTES de `db:generate`. Toda migración nueva lleva `when` mayor a las existentes; el migrate sobre DB fresca está roto — usar `db:migrate` incremental sobre la DB real. Verificar que la columna exista en la DB viva antes de asumir que un insert funciona.
7. **Evidencia antes que intuición**: los pesos del scoring están calibrados con datos medidos (sección 4 del prompt maestro). Toda propuesta de cambiar pesos/filtros debe citar los números de `signal_tracking`.

## Proceso

- Planes en `docs/superpowers/plans/YYYY-MM-DD-*.md`; ledger de ejecución en `.superpowers/sdd/progress.md` — leelo antes de empezar (tasks marcadas complete no se repiten).
- Trabajar siempre en branches `fix/...` o `feat/...`; merge solo con review aprobado.
- Todo claim de verificación (tests, conteos) se re-corre antes de aceptarse.
