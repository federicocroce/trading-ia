# Radar de ciclos cuantitativo v1 — Design

> Aprobado en conversación el 2026-07-05 (el usuario eligió la recomendación "radar cuantitativo v1" y autorizó ejecución autónoma; gates de review de spec con el usuario diferidos a su regreso — decisión registrada en el ledger). Complementa el comando `/radar-ciclos` (informe narrativo mensual): esto es la capa de DATOS diaria que ese informe no tiene.

## 1. Objetivo

Detectar de forma **medible y diaria** dónde se está gestando un ciclo (país/sector) usando señales computables con la infraestructura existente (Yahoo), sin LLM y sin búsquedas web: fuerza relativa contra SPY, tendencia propia (SMA200), fase de ciclo clasificada, y proxy de flujos vía delta de `sharesOutstanding` de ETFs. Todo visible en una pestaña nueva del dashboard.

**Reglas de coherencia (no negociables):**
- El radar es **capa de contexto, JAMÁS de señal**: no emite verbos (COMPRAR/VENDER/REVISAR), no toca scoring, verdicts ni sizing. La UI lo dice explícitamente.
- Fail-closed: símbolo sin datos suficientes → estado `null` con razón, nunca clasificación inventada. Proxy de flujos sin historia acumulada → "acumulando historia (N/21 días)", nunca 0% falso.
- Toda señal nueva se OBSERVA antes de confiarle peso: v1 no alimenta ningún filtro ni score del motor.

## 2. Fuera de alcance (v2, especificado para no perderlo)

- **Term structure de futuros de cobre** (contratos HG específicos en Yahoo son frágiles; diferido).
- **EDGAR Form 4** (clusters de compras de insiders por sector — API gratis, proyecto propio).
- **Informe narrativo mensual vía Gemini + Google Search grounding** como stage del pipeline.
- Breadth real por constituyentes de ETF (requiere listas de miembros; v1 usa la tendencia del ETF).
- FRED/BCRA para eje macro.

## 3. Universo (constante en el servicio, precedente `SECTOR_ETFS` de sector-rotation)

Benchmark: **SPY**. Canastas (23):
- **Países**: ARGT (Argentina), EWZ (Brasil), EWW (México), ECH (Chile), EPU (Perú), INDA (India), EWJ (Japón), MCHI (China), EWG (Alemania), EWU (UK), EEM (Emergentes).
- **Sectores/temas**: XLU (utilities US), XLE (energía US), XLF (finanzas US), XBI (biotech), SMH (semis — para medir el consenso), ITA (defensa), COPX (mineras cobre), URA (uranio), LIT (litio), GDX (mineras oro), TAN (solar), XME (metales y minería).

Cada entrada lleva `{ symbol, label, categoria: 'pais' | 'sector' }`.

## 4. Señales por canasta (funciones puras, testeadas sin mocks)

Con velas diarias de 2 años (`getHistoricalQuotes(symbol, '2y', '1d')`, ~500 sesiones — necesario: con 1 año, la SMA200 solo deja ~51 sesiones de "lado" conocido y los umbrales de 60/120 sesiones serían inalcanzables):

| Señal | Definición | Fail-closed |
|---|---|---|
| `ret3m`, `ret6m` | Retorno % a 63 y 126 sesiones | <130 velas → ret6m null |
| `rs3m`, `rs6m` | Exceso de retorno vs SPY (retCanasta − retSPY), puntos porcentuales | SPY sin datos → todo null |
| `sma200`, `distSma200Pct` | SMA200 y distancia % del cierre | <200 velas → null |
| `ladoSma` + `sesionesEnLado` | De qué lado de la SMA200 está el cierre y hace cuántas sesiones consecutivas (si nunca cruzó en la ventana, el conteo es cota inferior) | sin SMA → null |
| `cycleState` | Clasificador de fase (abajo) | cualquier input null → null + `reason` |

**Clasificador `classifyCycleState` (umbral exactos, constantes nombradas):**
1. `extendido`: cierre > SMA200 y `distSma200Pct > 20`.
2. `girando`: cruce ALCISTA de SMA200 hace ≤60 sesiones y `rs3m > 0`. — *la fase que busca el framework: gestación confirmándose.*
3. `tendencia`: cierre > SMA200 hace >60 sesiones y `rs3m ≥ 0`.
4. `odiado`: cierre < SMA200 hace ≥120 sesiones y `rs6m < 0`. — *candidato a vigilar, no a comprar.*
5. `neutro`: todo lo demás.

**Proxy de flujos** (requiere historia de snapshots propios): `flowDelta20d` = variación % de `sharesOutstanding` entre el snapshot de hoy y el de hace ~20 snapshots. Con <21 snapshots acumulados → null con `flowStatus: 'acumulando'`. `sharesOutstanding` se obtiene de `quoteSummary/defaultKeyStatistics` (fetch nuevo dedicado en `yahoo.ts`, patrón crumb existente de `getInsiderTransactions`).

## 5. Arquitectura

```
pipeline diario (runRemainingStages, tras runMarketScreener)
  └─ fire-and-forget (molde news-radar :532-543): runCycleRadar()
       ├─ getHistoricalQuotes SPY (benchmark) — si falla: abort honesto del stage
       ├─ por canasta (limiter Yahoo existente): velas 1y + getKeyStats(sharesOutstanding)
       ├─ cycle-signals.ts (puras): retornos, RS, SMA, cruce, classifyCycleState
       ├─ flowDelta20d desde historia de cycle_radar_snapshots
       └─ persistir snapshot del día (idempotente por (snapshot_date, symbol))
tRPC: radar.getLatest → snapshots del último snapshot_date + metadata (fecha, faltantes)
Frontend: tab nueva 'radar' en App.tsx → CycleRadarPage (tabla agrupada por cycleState)
```

**Módulos nuevos:**
- `apps/backend/src/radar/cycle-signals.ts` — funciones puras + constantes de umbral. Sin I/O.
- `apps/backend/src/radar/cycle-radar.service.ts` — universo + orquestador `runCycleRadar()`.
- `apps/backend/src/radar/radar.router.ts` — tRPC.
- `apps/frontend/src/radar/CycleRadarPage.tsx` — tabla.
- Migración drizzle 0042: tabla `cycle_radar_snapshots`.
- `apps/backend/src/shared/yahoo.ts` — función aditiva `getKeyStats(symbol)`.

**Tabla `cycle_radar_snapshots`** (índice único `(snapshot_date, symbol)`):
`id, snapshot_date (YYYY-MM-DD), symbol, label, categoria, close (real), sma200 (real|null), dist_sma200_pct (real|null), ret_3m (real|null), ret_6m (real|null), rs_3m (real|null), rs_6m (real|null), sesiones_en_lado (integer|null), lado_sma (text|null: 'arriba'|'abajo'), shares_outstanding (real|null), flow_delta_20d (real|null), cycle_state (text|null), state_reason (text|null), created_at`. Escritura idempotente: delete-por-fecha + insert batch (re-correr el día no duplica).

## 6. UI (tab "Radar")

- Tabla agrupada por fase en orden: **girando → odiado → tendencia → neutro → extendido**, con badge de color por fase y columnas: canasta, categoría, RS 3m/6m, dist SMA200, flujo 20d (o "acumulando N/21"), sesiones desde cruce.
- Banner fijo: "Contexto de ciclos — NO es señal de entrada. Los setups los decide el scan de siempre."
- Fecha del snapshot visible + aviso si es de un día anterior (staleness, patrón existente).
- Símbolos sin datos: fila con "sin datos: <razón>", no se ocultan (fail-closed visible).

## 7. Verificación (checklist prompt maestro §8)

1. build:shared + typecheck 3 workspaces; suite canónica `npm run test --workspace=apps/backend` (baseline 420, cada task suma).
2. Migración: `when > 1783100605156`, aplicada con `db:migrate` sobre la DB real CON BACKUP previo (gotcha journal conocido); verificar columnas en DB viva antes de asumir inserts.
3. One-shot real (script `npx tsx` desde apps/backend con `dotenv.config({ path: '../../.env' })`): correr `runCycleRadar()`, verificar ~23 filas en `cycle_radar_snapshots` con estados coherentes; borrar script.
4. Coherencia: el radar no toca verdicts/scoring/digest — grep de que nada del motor importe `radar/`.
5. Visibilidad: DB → tRPC (`radar.getLatest`) → tab montada y renderizando datos reales.
6. Review final whole-branch en el modelo más capaz. **SIN merge a `feat/outcome-resolver`: el branch queda listo para que el usuario lo pruebe y decida.**
