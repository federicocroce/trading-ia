# Analisis Tecnico - Sistema de Trading IA

## Resumen

El sistema implementa un analisis tecnico multi-indicador con scoring gradual, filtros anti-hype, sistema de confluencia y analisis de timing predictivo. Todo se basa en **velas diarias** (1 año de historia). La diferenciacion corto/mediano/largo plazo se logra variando los **periodos de los indicadores**, no el intervalo de las velas.

---

## Datos de Entrada

- **Fuente**: Yahoo Finance API (`apps/backend/src/shared/yahoo.ts`)
- **Intervalo**: Diario (`1d`)
- **Rango**: 1 año (`1y`)
- **Cache**: 1 hora de TTL para no saturar la API
- **Datos**: OHLC (Open, High, Low, Close) + Volumen

---

## Indicadores Calculados

### Momentum (corto plazo)

#### RSI (Relative Strength Index) - Periodo 14

- **Calculo**: Wilder's smoothing
  1. Separar gains y losses de los cambios de precio
  2. `avgGain = (avgGain * 13 + gain) / 14`
  3. `avgLoss = (avgLoss * 13 + loss) / 14`
  4. `RS = avgGain / avgLoss`
  5. `RSI = 100 - (100 / (1 + RS))`
- **Zonas**: <30 sobreventa, >70 sobrecompra
- **Serie**: Se genera RSI de ultimas 10 barras para deteccion de tendencia

#### MACD (Moving Average Convergence Divergence) - 12/26/9

- **Calculo**:
  1. Linea MACD = EMA(12) - EMA(26)
  2. Signal = EMA(9) de la linea MACD
  3. Histograma = MACD - Signal
- **Nota**: Se normaliza por ATR para el scoring

#### Stochastic Oscillator - 14, 3, 3 (Slow)

- **Calculo**:
  1. Raw %K = ((Close - Min14) / (Max14 - Min14)) x 100
  2. %K suavizado = SMA(3) del Raw %K
  3. %D = SMA(3) del %K suavizado
- **Zonas**: <20 sobreventa, >80 sobrecompra

---

### Tendencia (mediano/largo plazo)

#### Medias Moviles Simples (SMA)

| SMA | Uso |
|-----|-----|
| **SMA 20** | Tendencia de corto plazo |
| **SMA 50** | Tendencia de mediano plazo |
| **SMA 200** | Tendencia de largo plazo |

- **Calculo**: Promedio simple de los ultimos N cierres
- **Distancia**: `priceVsSmaX = ((precio - SMAX) / SMAX) * 100`

#### Medias Moviles Exponenciales (EMA) - 12/26/9

- **Calculo**:
  1. `k = 2 / (period + 1)` (constante de suavizado)
  2. Seed con SMA de los primeros N valores
  3. `EMA = price * k + prevEMA * (1 - k)`
- **Uso**: Para calculo del MACD y signal line

#### Golden Cross / Death Cross

- **Golden Cross**: SMA50 cruza arriba de SMA200 (alcista)
- **Death Cross**: SMA50 cruza abajo de SMA200 (bajista)
- **Estimacion**: Se mide la tasa de convergencia en 10 dias y se estiman dias al proximo cruce

---

### Volatilidad

#### Bollinger Bands - Periodo 20, Multiplicador 2

- **Calculo**:
  1. Middle Band = SMA(20)
  2. StdDev = desviacion estandar de los ultimos 20 cierres
  3. Upper Band = Middle + (2 x StdDev)
  4. Lower Band = Middle - (2 x StdDev)
- **Width Ratio**: `(upper - lower) / middle`
- **Squeeze Detection**: Intensidad > 70% y ancho decreciente = squeeze activo (potencial breakout)
  - Se trackea el ancho de BB sobre 20 dias
  - `Intensidad = (1 - (currentWidth - minWidth) / range) * 100`

#### ATR (Average True Range) - Periodo 14

- **Calculo**:
  1. `TR = max(H-L, abs(H-prevClose), abs(L-prevClose))`
  2. Primer ATR = promedio de primeros 14 TR
  3. Siguiente: `ATR = (prevATR * 13 + currentTR) / 14` (Wilder's smoothing)
- **Output**: Valor absoluto + porcentaje del precio actual (`atrPercent`)

#### Volume Ratio - 20 dias

- **Calculo**: `volumenActual / promedioVolumen20dias`
- **Uso**: >1.5x confirma interes real del mercado

---

### Volumen

#### OBV (On-Balance Volume)

- **Calculo**:
  - Si close > prevClose: `OBV += volume`
  - Si close < prevClose: `OBV -= volume`
  - Si close == prevClose: sin cambio
- **Tendencia** (lookback 10 dias):
  - Rising: promedio OBV reciente > promedio anterior en > 5%
  - Falling: promedio OBV reciente < promedio anterior en > 5%
- **Divergencias**:
  - Alcista: Precio baja pero OBV sube
  - Bajista: Precio sube pero OBV baja

---

### Niveles

#### Soporte y Resistencia - Lookback 120 dias

- **Identificacion**:
  1. Swing highs: barra con high > todas las barras en ventana de +-5
  2. Swing lows: barra con low < todas las barras en ventana de +-5
- **Clustering** (dentro del 1.5% del precio actual):
  1. Agrupar swing points cercanos
  2. Promediar precio por cluster
  3. `Strength = count * (0.5 + recency_weight * 0.5)`
- **Output**: Top 3 soportes (abajo) y Top 3 resistencias (arriba)
- **Distancia**:
  - `nearestSupport = ((precio - soporte) / precio) * 100`
  - `nearestResistance = ((resistencia - precio) / precio) * 100`

---

## Scoring Tecnico (-100 a +100)

Sistema gradual que asigna puntos por cada indicador y los suma.

| Factor | Puntos max | Logica |
|--------|-----------|--------|
| RSI | +-15 | Curva gradual: mas extremo = mas puntos. <30 da +15 + bonus, >70 da -15 - penalizacion |
| MACD | +-15 | Histograma normalizado por ATR: `max(-15, min(15, normalizedHist * 50))` |
| SMA 200 | +-12 | `max(-12, min(12, priceVsSma200 * 0.3))` |
| SMA 50 | +-15 | `max(-15, min(15, priceVsSma50 * 0.4))` |
| Stochastic | +-10 | K<20 y K>D = +10 (alcista), K>80 y K<D = -10 (bajista) |
| OBV divergencia | +-12 | Divergencia alcista = +12, bajista = -12 |
| Soporte cercano (<3%) | +8 | Bonus cerca de soporte |
| Resistencia cercana (<3%) | -5 | Penalizacion cerca de resistencia |
| Golden/Death Cross | +-15 | Evento discreto, alto impacto |
| BB Squeeze | x1.15 | **Amplificador** si squeeze activo e intensidad >70% |
| BB position | +-8 | Posicion <20% del rango = +8, >80% = -8 |
| Volumen alto | x1.0-1.3 | **Amplificador** gradual si volumeRatio > 1.5 |

**Senal final**: `score > 20` = bullish, `score < -20` = bearish, entre ambos = neutral

**Archivo**: `apps/backend/src/technical/technical-analysis.service.ts` - funcion `scoreTechnical()`

---

## Sistema de Timing (cuando actuar)

Estima **cuantos dias faltan** para que se active cada trigger, usando velocidades y tasas de convergencia.

**Archivo**: `apps/backend/src/technical/timing-analysis.service.ts`

### 7 Triggers de Timing

#### 1. SMA Crossover (0-15 dias)

- Si Golden/Death Cross ya existe: `estimatedDays = 0`, impact = high
- Si no: mide gap entre SMA50 y SMA200, calcula `convergenceRate` en 10 dias
- `daysToTouch = -gap / convergenceRate`
- Solo reporta si esta a 0-15 dias

#### 2. RSI Zone Entry (0-10 dias)

- Si RSI ya < 30 o > 70: inmediato, impact = high
- Si no: `velocidadRSI = (RSI_actual - RSI_hace5bars) / 5`
- `daysToOversold = (30 - RSI) / abs(velocity)`
- Solo si 0-10 dias y velocidad suficiente

#### 3. Soporte/Resistencia Arrival (0-15 dias)

- **Price velocity** via regresion lineal (10 dias):
  - `slope = (n*sumXY - sumX*sumY) / (n*sumXX - sumX^2)`
- **Support bounce**: precio cayendo + dentro del 10% del soporte + strength >= 1.5
- **Resistance break**: precio subiendo + dentro del 10% de resistencia + strength >= 1.5
- `daysToLevel = distancia / abs(slope)`

#### 4. Bollinger Band Squeeze (1-3 dias)

- Trigger: intensidad > 70%
- Direccion: `priceVsSma20 > 0` = alcista, sino bajista
- `estimatedDays`: 1 si intensidad > 85%, sino 3

#### 5. MACD Cross (0-10 dias)

- Analiza ultimas 5 barras de MACD vs Signal
- `convergenceRate = (gap_actual - gap_inicial) / (bars - 1)`
- `daysToTouch = abs(gap / convergenceRate)`
- Cruzando arriba = alcista, cruzando abajo = bajista

#### 6. Stochastic Cross (inmediato)

- Alcista: K < 25 y K > D (en zona sobreventa)
- Bajista: K > 75 y K < D (en zona sobrecompra)
- `estimatedDays = 0`
- Impact: high si K < 15 o > 85

#### 7. OBV Divergencia (2 dias)

- Divergencia alcista (precio baja, OBV sube): "reversal probable"
- Divergencia bajista (precio sube, OBV baja): "correction probable"
- `estimatedDays = 2` fijo

### Decision Final del Timing

- Se cuentan buy triggers vs sell triggers
- **BUY**: buyTriggers > sellTriggers AND buyTriggers >= 2
- **SELL**: sellTriggers > buyTriggers AND sellTriggers >= 2
- **WAIT**: cualquier otro caso

**Clasificacion temporal**:
- `now`: estimatedDays <= 1
- `soon`: estimatedDays <= 3
- `approaching`: estimatedDays > 3

**Confianza**:
```
base = min(90, 30 + totalCount * 12 + highImpactCount * 8)
consensus = abs(buyCount - sellCount) / totalCount
confidence = round(base * (0.6 + consensus * 0.4))
Rango: 15-90
```

---

## Filtros Anti-Hype

Filtran activos sobrecomprados o sin momentum real. Solo pasan los que cumplen los 3 criterios:

| Filtro | Umbral | Logica |
|--------|--------|--------|
| Precio > SMA200 | Obligatorio | Tendencia alcista de largo plazo confirmada |
| RSI | 35-70 | Rango saludable, evita FOMO (>70) y debilidad (<35) |
| Volumen | > 1.2x promedio 20d | Interes real del mercado |

**Excepcion**: Activos en portfolio siempre pasan (para permitir senales SELL).

**Archivo**: `apps/backend/src/opportunities/scoring.ts` - funcion `applyAntiHypeFilters()`

---

## Sistema de Confluencia (Confidence Score)

Evalua cuantos indicadores independientes apuntan en la misma direccion.

### Senales evaluadas (~19 votos)

#### Tecnicas (~11 votos)

| # | Senal | Bullish cuando | Bearish cuando |
|---|-------|---------------|---------------|
| 1 | RSI | < 35 (sobreventa) | > 70 (sobrecompra) |
| 2 | MACD histograma | Positivo | Negativo |
| 3 | Precio vs SMA200 | Precio > SMA200 | Precio < SMA200 |
| 4 | Precio vs SMA50 | Precio > SMA50 | Precio < SMA50 |
| 5 | Golden/Death Cross | Golden Cross reciente | Death Cross reciente |
| 6 | Stochastic | K < 20 + cruce alcista | K > 80 + cruce bajista |
| 7 | Bollinger position | Precio en banda inferior (<20%) | Precio en banda superior (>80%) |
| 8 | OBV trend | Acumulacion (rising) | Distribucion (falling) |
| 9 | OBV divergencia | Divergencia alcista | Divergencia bajista |
| 10 | Soporte cercano | Dentro del 3% de soporte | - |
| 11 | Resistencia cercana | - | Dentro del 3% de resistencia |
| 12 | Volumen alto | Confirma direccion del score tecnico | Confirma direccion del score tecnico |

#### Fundamentales (~5 votos)

| # | Senal | Bullish cuando | Bearish cuando |
|---|-------|---------------|---------------|
| F1 | P/E Ratio | < 15 con EPS positivo (barato) | > 30 (caro) o negativo (perdidas) |
| F2 | Forward P/E vs P/E | Forward < 80% del actual (crecimiento) | Forward > 120% del actual (deterioro) |
| F3 | Dividendo | Yield > 3% (atractivo) | - |
| F4 | Precio vs max 52 sem | > 25% debajo (oportunidad) | Dentro del 5% del maximo |
| F5 | Precio vs min 52 sem | > 50% arriba (fuerza) | Dentro del 10% del minimo (debilidad) |

#### Sentimiento (~3 votos)

| # | Senal | Bullish cuando | Bearish cuando |
|---|-------|---------------|---------------|
| S1 | Score general | > 15% positivo | < -15% negativo |
| S2 | Distribucion noticias | >= 60% positivas (3+ noticias) | >= 60% negativas (3+ noticias) |
| S3 | Consenso total | Todas positivas (2+) | Todas negativas (2+) |

### Calculo

```
confluencePercent = (votos_direccion_dominante / total_votos) * 100 + bonus_datos
```

- **>= 70%**: Alta confluencia (verde)
- **50-69%**: Confluencia moderada (amarillo)
- **< 50%**: Baja confluencia (rojo)

**Archivo**: `apps/backend/src/opportunities/scoring.ts` - funcion `computeConfluence()`

---

## Flujo Completo de Datos

```
Yahoo Finance (1y daily data)
    |
    v
getCachedHistory(symbol)  [cache 1hr TTL]
    |
    v
computeIndicators(history)
    |-- calculateSMA(closes, 20/50/200)
    |-- calculateEMA(closes, 12/26)
    |-- computeMACDFromEMAs(ema12, ema26)
    |-- calculateRSI(closes, 14)
    |-- calculateStochastic(history, 14, 3, 3)
    |-- calculateBollingerBands(closes, 20, 2)
    |-- calculateATR(history, 14)
    |-- calculateOBV(history)
    |-- calculateSupportResistance(history, 120)
    |-- detectCrossovers(closes)
    |-- detectBBSqueeze(closes)
    |
    v
scoreTechnical(indicators)  -->  score (-100 a +100)  -->  senal (bullish/bearish/neutral)
    |
    v
analyzeTimingSignals(history, indicators)
    |-- estimateSMACrossoverDays()
    |-- estimateRSIZoneEntry()
    |-- estimateSupportResistanceArrival()
    |-- estimateBBSqueezeTiming()
    |-- estimateMACDCross()
    |-- estimateStochasticCross()
    |-- estimateOBVDivergence()
    |
    v
TechnicalSummary {indicators, signal, score, timing}
    |
    v
Se integra con fundamentales + sentimiento de noticias
    |
    v
Senal final (IA via LM Studio o scoring algoritmico)
```

---

## Parametros Clave

| Indicador | Periodo | Parametros | Lookback |
|-----------|---------|-----------|----------|
| RSI | 14 | Wilder's smoothing | Daily |
| MACD | 12/26/9 | EMA-based | Daily |
| Stochastic | 14/3/3 | Slow stochastic | Daily |
| SMA | 20/50/200 | - | Daily |
| EMA | 12/26/9 | - | Daily |
| Bollinger Bands | 20 | Multiplicador 2 | Daily |
| ATR | 14 | Wilder's smoothing | Daily |
| Soporte/Resistencia | - | Ventana +-5 barras | 120 dias |
| OBV Trend | - | Lookback 10 | Daily |
| Datos historicos | - | 1 dia barras | 365 dias |

---

## Trade Levels (Entry / Stop-Loss / Take-Profit)

Cada oportunidad ahora incluye niveles concretos de operacion calculados automaticamente.

### Logica de calculo

**Para BUY/WATCH:**
- **Entry**: Soporte cercano (<5% del precio) si existe, sino precio actual
- **Stop-Loss**: Debajo del soporte mas fuerte - margen ATR, o 1.5x ATR debajo de entry
- **Take-Profit**: Resistencia mas cercana, o 2.5x ATR arriba de entry

**Para SELL:**
- **Entry**: Precio actual (vender ahora)
- **Stop-Loss**: Arriba de resistencia + margen ATR
- **Take-Profit**: Soporte mas cercano (objetivo de caida)

**Para HOLD:**
- Niveles informativos basados en soporte/resistencia o ATR

**Risk/Reward Ratio**: `reward / risk` — valores >= 2 son buenos

**Archivo**: `apps/backend/src/opportunities/scoring.ts` - funcion `computeTradeLevels()`

---

## Signal Tracking (Accuracy del Sistema)

Sistema automatico que registra las senales BUY/SELL emitidas y las compara con el precio real despues.

### Flujo
1. Cada scan registra senales BUY/SELL en tabla `signal_tracking`
2. En scans posteriores, se revisan senales pendientes (>7 dias)
3. Se compara precio actual vs precio de entrada
4. Se determina outcome: win (>+2%), loss (<-2%), neutral

### Criterios de resolucion
- **Hit target**: precio alcanzo el take-profit → win
- **Hit stop**: precio alcanzo el stop-loss → loss
- **Por retorno**: >+2% = win, <-2% = loss, entre = neutral
- **Resolucion definitiva**: a los 30 dias o cuando toca target/stop

### Metricas disponibles
- Win rate (%)
- Retorno promedio a 7d y 30d
- Total ganadas / perdidas / neutrales
- Historial detallado por senal

**Archivos**:
- `apps/backend/src/opportunities/signal-tracking.service.ts`
- `apps/backend/src/db/schema.ts` - tabla `signal_tracking`

---

## Pesos por Horizonte (ajustados al perfil del usuario)

| Horizonte | Fundamental | Tecnico | Sentimiento |
|-----------|------------|---------|-------------|
| **Corto plazo** (1-4 sem) | 20% | 40% | 40% |
| **Mediano plazo** (1-6 meses) | 45% | 35% | 20% |

Composite = 60% corto plazo + 40% mediano plazo

Pesos efectivos finales: Tecnico 38%, Sentimiento 32%, Fundamental 30%

Perfil: **Swing trader tactico con vision de mediano plazo**

**Archivo**: `apps/backend/src/opportunities/scoring.ts` - constantes `SHORT_TERM_WEIGHTS` y `MEDIUM_TERM_WEIGHTS`

---

## Limitaciones y Contexto

- **Ningun analisis tecnico tiene certeza**. Los mejores sistemas institucionales aciertan 55-65% de las veces.
- La rentabilidad viene de la **gestion de riesgo**, no de la prediccion.
- El sistema es util como **screening y priorizacion**, no como senal de trading automatico.
- Factores no cubiertos: macro global, politica monetaria, eventos black swan, liquidez del mercado.
- **Solo velas diarias**: no hay analisis intraday. El corto/mediano/largo plazo se diferencia por periodos de indicadores.

---

## Archivos Clave

| Archivo | Responsabilidad |
|---------|----------------|
| `apps/backend/src/technical/technical-analysis.service.ts` | Calculo de todos los indicadores + scoring |
| `apps/backend/src/technical/timing-analysis.service.ts` | Senales de timing (cuando actuar) |
| `apps/backend/src/opportunities/scoring.ts` | Anti-hype, confluencia, scoring compuesto, return estimates |
| `packages/shared/src/types/technical.ts` | Tipos de indicadores y senales |
| `packages/shared/src/types/opportunity.ts` | Tipos de oportunidad + ConfluenceDetail |
| `apps/backend/src/shared/yahoo.ts` | Fuente de datos (Yahoo Finance API) |
| `apps/backend/src/opportunities/signal-tracking.service.ts` | Tracking de accuracy de senales |
| `apps/frontend/src/daily/DailySummary.tsx` | Pagina de resumen diario + accuracy + alertas |
| `apps/frontend/src/opportunities/OpportunityCard.tsx` | Card con trade levels + timing triggers |
