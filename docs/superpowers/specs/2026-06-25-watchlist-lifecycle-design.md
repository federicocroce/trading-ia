# Watchlist con ciclo de vida — Design

**Fecha:** 2026-06-25
**Branch:** `feat/outcome-resolver`

## Problema

El watchlist (tabla `symbols`, vía botón `+ Watchlist` → `addToWatchlist` → `promoteToWatchlist`)
solo crece. Guarda `symbol/name/type/active` — **sin precio de alta, sin tesis, sin estado**.
Estructuralmente no tiene con qué resolver, así que nada cierra: el usuario acumula símbolos
indefinidamente y es la única memoria del sistema sobre qué seguir mirando y qué descartar.

En paralelo existe `signal_tracking`: rico, con entry/target/stop y resolución real a 7/30d
(`win`/`loss`/`neutral`/`pending`), pero **desconectado del watchlist** — solo alimenta
dashboards de accuracy internos.

No es un bug de supresión (no hay dedup). Es una desconexión: la resolución existe pero no se
aplica al watchlist ni se le muestra al usuario.

## Objetivo

Darle al watchlist un lado que cierra. Cada item recomendado captura su contexto al agregarse
y un resolver le asigna estado en el tiempo. El watchlist se autolimita: el sistema dice cuáles
limpiar en vez de que el usuario adivine.

## Alcance (aprobado)

- Watchlist con ciclo de vida: captura de contexto + resolver + estados + autolimitación.
- Superficie: estado en el Sidebar (lista del watchlist) + badge en `OpportunityCard`.

**Fuera de alcance (a propósito):**
- Desacoplar liveness del universo news-driven (TTL 14d) — gated en data forward.
- Rearm "dejar correr" (re-armar un resuelto a precio actual) — fast-follow, no v1.

## Modelo de datos — tabla nueva `watchlist_items`

No se toca `symbols` (membresía compartida con portfolio/ETFs). Tabla companion, una fila activa
por símbolo:

| campo | tipo | qué guarda |
|---|---|---|
| `id` | pk | |
| `symbol` | text | FK lógico a `symbols.symbol` |
| `addedAt` | text (ISO date) | cuándo se agregó |
| `source` | text | `recommendation` \| `manual` |
| `entryPrice` | real | precio al agregar |
| `entryAction` | text | acción de la recomendación (BUY/SELL/WATCH/HOLD) o `manual` |
| `entryScore` | int | `opportunityScore` al agregar |
| `entryConfidence` | int | `confidence` al agregar |
| `targetPrice` | real? | de `tradeLevels.takeProfit` |
| `stopLoss` | real? | de `tradeLevels.stopLoss` |
| `thesis` | text? | `tradeLevels.entryReason` / `reasoning` recortado |
| `horizonDays` | int | ventana antes de expirar (default 30) |
| `status` | text | `live` \| `triggered` \| `invalidated` \| `expired` \| `archived` |
| `lastPrice` | real? | última cotización evaluada |
| `lastReturn` | real? | retorno % vs entry (para mostrar sin pegar quote en render) |
| `lastEvaluatedAt` | text? | |
| `resolvedAt` | text? | al cerrar |
| `resolutionPrice` | real? | |
| `resolutionReturn` | real? | |
| `createdAt` | text | default `datetime('now')` |

Migración: `0038_watchlist_lifecycle.sql` (vía `drizzle-kit generate` desde `schema.ts`).

## Resolver — función pura `resolveWatchlistStatus()`

Módulo nuevo `watchlist-resolver.ts`, función pura y testeable (TDD). Misma lógica de hit que
`resolveExpiredSignals` (target/stop/return + dirección BUY vs SELL), mapeada a estados de
watchlist.

Input: `{ entryAction, entryPrice, targetPrice, stopLoss, currentPrice, daysSince, horizonDays }`
Output: `{ status, returnPct, hitTarget, hitStop }`

Reglas (en orden):
1. precio toca `stopLoss` (para BUY: `current <= stop`; SELL invierte) → **`invalidated`**
2. precio toca `takeProfit` (BUY: `current >= target`; SELL invierte) → **`triggered`**
3. `daysSince >= horizonDays` sin target/stop → **`expired`**
4. si no → **`live`**

`manual` sin levels (target/stop null): nunca `triggered`/`invalidated`; solo `live` → `expired`
por horizonte. No inventa tesis.

No se reescribe el resolver de signal_tracking (funciona y está en uso); se replica la lógica en
un módulo propio y testeado. Una futura unificación queda como deuda anotada.

## Captura al agregar

`addToWatchlist` pasa de `{ symbol }` a `{ symbol, entry?: { price, action, score, confidence,
targetPrice?, stopLoss?, thesis? } }`.

- `OpportunityCard` / `WatchlistButton` mandan el snapshot de la `Opportunity`.
- Adds manuales (symbol page) mandan solo `{ symbol }` → `source: manual`, sin levels.
- **Backward-compatible.** Sigue promoviendo a `symbols` (comportamiento actual) y además crea la
  fila `watchlist_items`.
- Si ya existe una fila `live` para el símbolo, no se duplica. Si la última está resuelta/archivada,
  un nuevo alta crea una fila `live` nueva (re-entrada legítima).

## Resolución (cuándo corre)

- `resolveWatchlistItems()` en el arranque del scan (junto a `resolveExpiredSignals`).
- Mutation manual `resolveWatchlist` para forzar.
- Para cada item `live`: fetch quote (`getQuote`), computa `daysSince`, aplica
  `resolveWatchlistStatus`, persiste `lastPrice`/`lastReturn`/`lastEvaluatedAt`; si cambia a
  `triggered`/`invalidated`/`expired`, setea `resolvedAt`/`resolutionPrice`/`resolutionReturn`.

## Autolimitación

El Sidebar separa **Activas** (`live`) de **Para revisar** (`triggered`/`invalidated`/`expired`).
Los resueltos muestran badge + botón **Archivar** → `status: archived` + remueve del watchlist
(`portfolio.symbols.delete` existente). La lista activa se mantiene corta.

## API (tRPC, opportunities router)

- `addToWatchlist` (extendido con `entry?`)
- `watchlistStatus` (query) → items no archivados con estado + retorno
- `resolveWatchlist` (mutation)
- `archiveWatchlistItem` (mutation, `{ symbol }`)

## Superficies UI

- **Sidebar:** badge de estado por símbolo (🟢 viva / 🎯 gatillada / ❌ invalidada / ⏳ expirada)
  + sección "Para revisar" con Archivar.
- **OpportunityCard:** donde hoy se oculta `+ Watchlist` (símbolo ya en watchlist), muestra el badge
  con estado + retorno.

## Testing

- Pure `resolveWatchlistStatus` (vitest, sin DB): target→triggered, stop→invalidated,
  horizonte→expired, dentro de ventana→live, SELL invierte, levels null→solo live/expired.
- Captura: `addToWatchlist` con `entry` crea item con snapshot; sin `entry` → manual.

## Componentes (límites)

- `watchlist-resolver.ts` — pura, sin deps. Qué hace: decide estado dado precio/levels/días.
- `watchlist-tracking.service.ts` — orquesta captura + loop de resolución (usa repo + getQuote).
- `repository.ts` — CRUD de `watchlist_items`.
- Router — expone API.
- Frontend — badges + secciones.
