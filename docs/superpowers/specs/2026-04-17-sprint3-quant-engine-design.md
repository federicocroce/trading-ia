# Sprint 3 — Quant Engine Design

**Fecha:** 2026-04-17  
**Inspiración:** Jim Simons / Renaissance Technologies — combinar señales débiles, detectar régimen, aprender de historia  
**Enfoque elegido:** Nuevo dominio `quant/` (Enfoque B)

---

## 1. Objetivos

1. **Regime Detection** — clasificar el mercado como trending/mean-reverting/volátil y que afecte scoring weights + narrativa del digest
2. **Cross-Sectional Momentum** — rankear todos los activos del universo por momentum relativo al mercado
3. **Adaptive Weights** — recalibrar automáticamente los pesos de scoring en cada pipeline run usando historial de `signal-tracking`
4. **Backtesting** — replay de señales sobre datos históricos con UI completa (equity curve, drawdown, comparación de estrategias)

---

## 2. Arquitectura General

```
apps/backend/src/quant/
├── regime-detector.service.ts      ← detecta régimen de mercado
├── momentum-ranker.service.ts      ← cross-sectional ranking vs universo
├── weight-calibrator.service.ts    ← auto-ajusta HorizonWeights con historial
├── backtest.service.ts             ← replay scoring sobre OHLCV histórico
├── backtest.repository.ts          ← persiste BacktestRun en SQLite
└── quant.router.ts                 ← endpoints tRPC: triggerBacktest, getBacktestRun, listBacktestRuns

apps/frontend/src/backtest/
├── BacktestPage.tsx                ← página principal /backtest
├── StrategyConfigForm.tsx          ← selección de símbolo, fechas, presets
├── EquityCurveChart.tsx            ← Recharts LineChart: portfolio value vs buy&hold
├── DrawdownChart.tsx               ← Recharts AreaChart: % drawdown en el tiempo
├── MetricsCards.tsx                ← Sharpe, max DD, win rate, total return, nro trades
└── StrategyCompareTable.tsx        ← tabla de múltiples runs side-by-side

packages/shared/src/types/
└── quant.ts                        ← tipos compartidos: MarketRegime, QuantContext, BacktestRun, etc.
```

**Principio:** `quant/` es consumidor, no productor. Lee datos existentes (TechnicalSummary, signal-tracking, OHLCV) y produce `QuantContext` que el pipeline propaga hacia adelante.

---

## 3. Tipos Compartidos (`packages/shared/src/types/quant.ts`)

```typescript
export type MarketRegime =
  | 'trending_bull'    // tendencia alcista clara
  | 'trending_bear'    // tendencia bajista clara
  | 'mean_reverting'   // mercado lateral/oscilante
  | 'volatile'         // alta volatilidad sin dirección
  | 'unknown';         // datos insuficientes

export interface RegimeResult {
  regime: MarketRegime;
  confidence: number;          // 0-100
  indicators: {
    adxValue: number;          // ADX proxy (trend strength)
    atrRatio: number;          // ATR/precio = volatilidad relativa
    trendConsistency: number;  // % de activos sobre SMA200
    spyMomentum: number;       // ROC 20d de SPY/MERVAL
  };
  detectedAt: string;          // ISO timestamp
}

export interface MomentumRanking {
  symbol: string;
  rank: number;                // 1 = mayor momentum
  relativeStrength: number;    // ROC 20d del símbolo / ROC 20d del índice
  absoluteMomentum: number;    // ROC 20d propio
  percentile: number;          // 0-100, posición en el universo
}

export interface CalibratedWeights {
  shortTerm: { sentiment: number; technical: number; fundamental: number };
  mediumTerm: { sentiment: number; technical: number; fundamental: number };
  calibratedAt: string;
  basedOnDays: number;         // días de historial usados
  signalAccuracies: Record<string, number>;  // nombre señal → % accuracy
}

export interface QuantContext {
  regime: RegimeResult;
  momentumRankings: MomentumRanking[];
  calibratedWeights: CalibratedWeights | null;  // null si no hay historial suficiente
}

// --- Backtesting ---

export interface StrategyConfig {
  name: string;
  shortTermWeights?: { sentiment: number; technical: number; fundamental: number };
  mediumTermWeights?: { sentiment: number; technical: number; fundamental: number };
  buyThreshold: number;        // score ≥ X para BUY
  sellThreshold: number;       // score < X para SELL
  stopLossPercent: number;     // % de stop loss
  takeProfitPercent: number;   // % de take profit
}

export interface BacktestTrade {
  symbol: string;
  entryDate: string;
  exitDate: string;
  entryPrice: number;
  exitPrice: number;
  returnPercent: number;
  exitReason: 'signal' | 'stop_loss' | 'take_profit' | 'end_of_period';
}

export interface BacktestMetrics {
  totalReturnPercent: number;
  buyAndHoldReturnPercent: number;
  sharpeRatio: number;
  maxDrawdownPercent: number;
  winRate: number;             // % trades ganadores
  numTrades: number;
  avgTradeDurationDays: number;
}

export interface BacktestEquityPoint {
  date: string;
  portfolioValue: number;      // valor normalizado (empieza en 100)
  buyAndHoldValue: number;     // baseline normalizado
  drawdownPercent: number;
}

export interface BacktestRun {
  id: number;
  symbol: string;
  startDate: string;
  endDate: string;
  strategy: StrategyConfig;
  metrics: BacktestMetrics;
  trades: BacktestTrade[];
  equityCurve: BacktestEquityPoint[];
  createdAt: string;
  status: 'running' | 'completed' | 'failed';
  error?: string;
}
```

---

## 4. Regime Detector (`regime-detector.service.ts`)

### Algoritmo

El régimen se detecta usando proxy indicators calculados sobre datos ya disponibles (TechnicalSummary del universo, sin llamadas externas adicionales):

```
1. trendConsistency = % de símbolos del universo cuyo price > SMA200
   - trendConsistency > 65% AND spyMomentum > 0  → trending_bull
   - trendConsistency < 35% AND spyMomentum < 0  → trending_bear

2. adxProxy = avg(|RSI - 50| * 2) para todos los símbolos
   - adxProxy > 30 → mercado con dirección (refuerza trending)
   - adxProxy ≤ 30 → mercado sin dirección → candidato mean_reverting

3. atrRatio = avg(ATR14 / price) para todos los símbolos
   - atrRatio > 0.025 (2.5%) → volatile (override sobre mean_reverting)

4. Matriz de decisión:
   trendConsistency > 65% AND adxProxy > 30 AND atrRatio ≤ 0.025 → trending_bull
   trendConsistency < 35% AND adxProxy > 30 AND atrRatio ≤ 0.025 → trending_bear
   atrRatio > 0.025                                                → volatile
   default                                                         → mean_reverting
```

### Impacto del régimen sobre scoring weights

| Régimen | Cambio en weights |
|---|---|
| `trending_bull` | momentum +10%, sentiment +5%, fundamental -15% |
| `trending_bear` | momentum +10%, sentiment +10%, fundamental -20% |
| `mean_reverting` | RSI/Bollinger efectivos → technical +10%, momentum -10% |
| `volatile` | reduce todas las señales, aumenta fundamental +15% (calidad > dirección) |
| `unknown` | usa weights base sin modificar |

Los pesos del régimen se aplican **sobre** los pesos calibrados (calibrated weights primero, régimen adjustment después).

### Impacto sobre el digest

Se inyecta el régimen en `DAILY_MARKET_DIGEST_PROMPT` como contexto adicional:
```
RÉGIMEN DE MERCADO: trending_bull (confianza: 78%)
Indicadores: 71% de activos sobre SMA200, momentum SPY +4.2% en 20d
```
El LLM adapta el tono y las recomendaciones según el régimen.

---

## 5. Momentum Ranker (`momentum-ranker.service.ts`)

### Algoritmo

Cross-sectional momentum: rankear cada activo por su fuerza relativa vs el índice de referencia.

```typescript
relativeStrength(symbol) = ROC_20d(symbol) / ROC_20d(indexProxy)

// indexProxy = SPY para activos US, MERVAL para CEDEARs/ARG
// ROC_20d = (price_hoy - price_hace_20d) / price_hace_20d
```

Ranking:
1. Calcular `relativeStrength` para todos los símbolos del universo
2. Ordenar descendente → asignar rank 1 al mayor
3. Calcular percentil: `percentile = (totalSymbols - rank) / totalSymbols * 100`

### Uso en el sistema

- El `MomentumRanking` se expone en el frontend (columna nueva en tabla de oportunidades)
- En `trending_bull`: bonus de +5 puntos al composite score para símbolos en top 25% de momentum
- En `mean_reverting`: momentum ranking se ignora (condición no favorable para momentum)
- En el digest: top 3 y bottom 3 por momentum se mencionan explícitamente

---

## 6. Weight Calibrator (`weight-calibrator.service.ts`)

### Fuente de datos

Lee de `signal_tracking` en SQLite: registros de señales pasadas con:
- `predicted_action` (BUY/SELL/HOLD)
- `actual_outcome` (precio N días después)
- `signal_type` (technical/fundamental/sentiment)
- `signal_name` (RSI_oversold, MACD_crossover, etc.)

Requiere mínimo **30 registros** en los últimos 90 días para activarse. Si hay menos, usa weights base.

### Algoritmo de calibración

```
Para cada signal_type (technical, fundamental, sentiment):
  accuracy[type] = count(predicciones correctas) / count(total) en últimos 90d

Normalizar: sum(accuracy) = 1.0 (softmax simple)
Aplicar smoothing: nuevo_peso = 0.7 * accuracy_calculado + 0.3 * peso_base
```

El smoothing evita que el sistema oscile demasiado ante pequeñas muestras.

### Persistencia

Los pesos calibrados se guardan en SQLite (tabla `calibrated_weights`) con timestamp. Se releen al inicio del pipeline. La calibración corre como parte del **Stage 3 (analysis)**, antes de que los scores se calculen.

---

## 7. Backtesting (`backtest.service.ts`)

### Input

```typescript
triggerBacktest(params: {
  symbol: string;
  startDate: string;   // YYYY-MM-DD
  endDate: string;     // YYYY-MM-DD, máx 2 años atrás
  strategy: StrategyConfig;
})
```

### Proceso

```
1. Fetch OHLCV histórico de Yahoo Finance para el símbolo (startDate → endDate)
2. Para cada día de trading (iteración día a día):
   a. Calcular todos los indicadores técnicos sobre ventana hasta ese día
   b. Simular scoring con los weights de la estrategia (sin adaptive, para reproducibilidad)
   c. Determinar acción: BUY / SELL / HOLD según thresholds
   d. Simular trade:
      - Si no hay posición y acción = BUY → open trade al precio de cierre
      - Si hay posición y (acción = SELL OR stop_loss triggered OR take_profit triggered) → close trade
   e. Calcular portfolio value del día
3. Cerrar posición abierta al final del período
4. Calcular métricas y equity curve
5. Guardar BacktestRun en DB
6. Retornar run ID al frontend para polling
```

### Restricciones

- Solo un símbolo por run (no portfolio-level backtest en este sprint)
- Datos disponibles: 1-2 años de OHLCV de Yahoo Finance
- Sin costos de transacción ni slippage en V1 (se puede agregar en V2)
- Sin posiciones short (solo long)

### Métricas calculadas

- **Total Return %**: (valor final - valor inicial) / valor inicial
- **Buy & Hold %**: retorno de mantener el activo todo el período
- **Sharpe Ratio**: `(avg_daily_return - risk_free) / std(daily_returns) * sqrt(252)`  (risk_free = 0 en V1)
- **Max Drawdown %**: máxima caída desde un pico
- **Win Rate**: trades con retorno > 0 / total trades
- **Num Trades**: total operaciones
- **Avg Trade Duration**: días promedio por trade

---

## 8. Pipeline Integration

### Nuevo stage: `quant` (entre analysis y digest)

```
Stage 1: webSearch
Stage 2: news
Stage 3: analysis
Stage 3.5: quant     ← NUEVO (non-blocking: si falla, pipeline continúa con weights base)
Stage 4: digest
Stage 5: fundamentals
Stage 6: intelligence
Stage 7: report
```

El stage `quant`:
1. Corre `detectRegime()` sobre TechnicalSummaries del universo
2. Corre `rankMomentum()` sobre los mismos datos
3. Corre `calibrateWeights()` si hay historial suficiente
4. Construye `QuantContext` y lo pasa hacia adelante vía módulo en memoria (similar al patrón de `_stageUnifiedAnalyses`)

El `QuantContext` es consumido por:
- `scoring.ts`: `computeHorizonScore()` recibe `regimeAdjustedWeights` opcionales
- `market-digest.service.ts`: inyecta régimen en el prompt
- `unified-analysis.service.ts`: menciona momentum percentile en el asset card

El pipeline stages map en `PipelineRun` pasa de 7 a incluir `quant`.

---

## 9. Frontend — Backtesting UI

### Ruta: `/backtest`

**Layout:**
```
┌─────────────────────────────────────────────────────┐
│  StrategyConfigForm                                  │
│  [Símbolo] [Desde] [Hasta] [Preset ▼] [Correr]     │
├─────────────────────────────────────────────────────┤
│  MetricsCards                                        │
│  [Return: +23.4%] [B&H: +18.1%] [Sharpe: 1.42]    │
│  [Max DD: -12.3%] [Win Rate: 61%] [Trades: 14]     │
├─────────────────────────────────────────────────────┤
│  EquityCurveChart (LineChart)                        │
│  ── Estrategia  ── Buy & Hold                       │
├─────────────────────────────────────────────────────┤
│  DrawdownChart (AreaChart)                           │
├─────────────────────────────────────────────────────┤
│  StrategyCompareTable                                │
│  (acumula múltiples runs para comparar)             │
└─────────────────────────────────────────────────────┘
```

### Presets de estrategia

| Preset | Descripción |
|---|---|
| `Base` | Weights actuales del sistema (scoring-weights.ts) |
| `Momentum-Heavy` | Technical +20%, Fundamental -20% |
| `Fundamental-Heavy` | Fundamental +20%, Technical -20% |
| `Balanced` | 33/33/33 en todos los horizontes |
| `Custom` | Sliders para ajustar manualmente |

### UX

- Click "Correr" → POST a `quant.triggerBacktest` → recibe `runId`
- Polling cada 2s a `quant.getBacktestRun(runId)` hasta `status = 'completed'`
- Charts usan Recharts (ya en el proyecto)
- Compare table: botón "Agregar al comparador" en cada run completado
- Responsive (mobile: cards apiladas, charts scrollables)

---

## 10. Endpoints tRPC (`quant.router.ts`)

```typescript
quant.triggerBacktest(input: {
  symbol: string;
  startDate: string;
  endDate: string;
  strategy: StrategyConfig;
}): { runId: number }

quant.getBacktestRun(input: { runId: number }): BacktestRun

quant.listBacktestRuns(input: { limit?: number }): BacktestRun[]

quant.getQuantContext(): QuantContext | null  // último contexto del pipeline
```

---

## 11. Base de Datos

### Nueva tabla: `backtest_runs`

```sql
CREATE TABLE backtest_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  strategy TEXT NOT NULL,           -- JSON serializado
  metrics TEXT,                     -- JSON serializado
  trades TEXT,                      -- JSON serializado
  equity_curve TEXT,                -- JSON serializado
  status TEXT NOT NULL DEFAULT 'running',
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Nueva tabla: `calibrated_weights`

```sql
CREATE TABLE calibrated_weights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  weights TEXT NOT NULL,            -- JSON serializado (CalibratedWeights)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Nueva tabla: `quant_context_cache`

```sql
CREATE TABLE quant_context_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  context TEXT NOT NULL,            -- JSON serializado (QuantContext)
  pipeline_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

---

## 12. No incluido en este sprint

- Portfolio-level backtesting (múltiples símbolos simultáneos)
- Costos de transacción / slippage en backtest
- Short selling
- Walk-forward optimization (auto-tuning de thresholds)
- Hidden Markov Models (HMM) para regime detection avanzado — posible V2
- Datos históricos > 2 años (requiere fuente adicional)
- Backtesting de la estrategia completa (fundamental + sentiment histórico) — solo technical scoring

---

## 13. Orden de implementación recomendado

1. Tipos compartidos en `packages/shared/src/types/quant.ts`
2. DB migrations (3 tablas nuevas)
3. `regime-detector.service.ts` + tests
4. `momentum-ranker.service.ts`
5. `weight-calibrator.service.ts` (requiere signal_tracking con datos)
6. Integración en pipeline como Stage 3.5
7. `backtest.service.ts` + `backtest.repository.ts`
8. `quant.router.ts`
9. Frontend: BacktestPage + componentes
10. Exponer QuantContext y momentum ranking en UI existente (oportunidades)
