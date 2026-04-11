# Analisis Fundamental - Sistema de Trading IA

## Resumen

El sistema evalua valuacion, expectativas de crecimiento, posicion en rango de 52 semanas y dividendos. Es un pilar complementario que se integra con tecnico y sentimiento, con peso variable segun el horizonte de inversion (15% corto plazo, 50% mediano plazo).

---

## Fuente de Datos

- **API**: Yahoo Finance `quoteSummary` con 3 modulos: `defaultKeyStatistics`, `financialData`, `summaryDetail`
- **Autenticacion**: cookie-crumb con TTL de 30 min
- **Cache**: 1 hora en memoria
- **Fallbacks**:
  1. Endpoint autenticado (`query2.finance.yahoo.com`)
  2. Sin auth (`query1.finance.yahoo.com`)
  3. Chart endpoint (solo precio + 52w)
  4. Datos neutros (todo null, score 0)

---

## Datos Extraidos

| Dato | Modulo Yahoo |
|------|-------------|
| currentPrice | financialData / summaryDetail |
| marketCap | summaryDetail |
| peRatio (trailing) | summaryDetail |
| forwardPE | defaultKeyStatistics |
| eps (trailing) | defaultKeyStatistics |
| dividendYield | summaryDetail |
| fiftyTwoWeekHigh/Low | summaryDetail |
| avgVolume | summaryDetail |
| beta | defaultKeyStatistics |

**Metricas calculadas**:
- `priceVs52wHigh = ((precio - 52wHigh) / 52wHigh) * 100`
- `priceVs52wLow = ((precio - 52wLow) / 52wLow) * 100`

---

## Scoring Fundamental (-100 a +100)

Cada metrica aporta puntos de forma **aditiva e independiente**. Si falta una, las otras siguen puntuando.

| Factor | Condicion | Puntos |
|--------|-----------|--------|
| **P/E Ratio** | P/E < 15 y EPS > 0 | +25 |
| | P/E < 20 | +10 |
| | P/E > 50 | -15 |
| | P/E > 30 | -10 |
| | P/E < 0 (perdidas) | -15 |
| **Forward P/E** | < 10 | +20 |
| | < 15 | +10 |
| | < 20 | +5 |
| | > 40 | -10 |
| **Forward vs Current P/E** | Mejora > 50% | +15 |
| | Mejora > 20% | +10 |
| **52-Week Position** | Cerca del minimo (<10% arriba) | +15 |
| | <20% arriba del minimo | +5 |
| | Cerca del maximo (<5% abajo) | -10 |
| **Dividendo** | Yield > 3% | +10 |
| | Yield > 2% | +5 |

**Senal final**:
- Score > 15 → `undervalued`
- Score < -15 → `overvalued`
- Entre -15 y 15 → `fair`

**Archivo**: `apps/backend/src/fundamental/fundamental-analysis.service.ts` - funcion `scoreFundamental()`

---

## Peso en el Sistema Compuesto

El fundamental se mezcla con tecnico y sentimiento con pesos por horizonte:

| Horizonte | Fundamental | Tecnico | Sentimiento |
|-----------|------------|---------|-------------|
| **Corto plazo** (1-4 sem) | **15%** | 45% | 40% |
| **Mediano plazo** (1-6 meses) | **50%** | 30% | 20% |

Score compuesto = promedio de corto y mediano plazo.

**Archivo**: `apps/backend/src/opportunities/scoring.ts`

---

## Votos en Confluencia (5 votos fundamentales)

Dentro del sistema de confluencia (~19 votos totales), el fundamental aporta 5 votos independientes:

| Voto | Bullish | Bearish |
|------|---------|---------|
| F1: P/E | < 15 y EPS > 0 | > 30 o negativo |
| F2: Forward vs Current P/E | Forward < 80% del actual | Forward > 120% del actual |
| F3: Dividendo | Yield > 3% | - |
| F4: Precio vs max 52s | > 25% abajo (oportunidad) | Dentro del 5% |
| F5: Precio vs min 52s | > 50% arriba (fuerza) | Dentro del 10% (debilidad) |

**Archivo**: `apps/backend/src/opportunities/scoring.ts` - funcion `computeConfluence()`

---

## Estimacion de Retorno (componente fundamental)

### Corto plazo (15% del peso)

```
fundComponent = 0
if (forwardPE < currentPE) → + ((currentPE - forwardPE) / currentPE) * 20
if (precio > 30% abajo de 52wHigh) → +5
if (dividendYield > 3%) → +2
if (fundScore > 20) → +5
if (fundScore < -20) → -5
fundComponent = clamp(-10, 20)
```

### Mediano plazo (45% del peso)

Misma formula pero con mayor impacto en el resultado final.

---

## Manejo de Datos Faltantes

Las 3 situaciones estan implementadas:

1. **Crypto / sin datos**: Si `peRatio`, `forwardPE`, `eps` y `fiftyTwoWeekHigh` son todos null → `{ signal: 'fair', score: 0 }` (linea 24-25)
2. **Datos parciales**: Cada metrica se evalua con `!= null` antes de puntuar — si falta P/E pero hay dividendo, el dividendo suma puntos normalmente
3. **API caida**: El `catch` retorna objeto neutro con todo null y score 0, no rompe el sistema (linea 84-96)

---

## Flujo Completo

```
Yahoo Finance quoteSummary (con fallbacks y auth)
    |
    v
FundamentalData (13 campos)
    |
    v
scoreFundamental()  -->  score (-100 a +100) + senal (undervalued/overvalued/fair)
    |
    v
Se usa en:
  1. Composite score (15-50% del peso segun horizonte)
  2. Confluencia (5 votos independientes)
  3. Estimacion de retorno (componente fundamental)
  4. Opportunity card (keyFactors display)
```

---

## Limitaciones

- **No analiza**: balance, flujo de caja, deuda, margenes, revenue growth
- **Solo metricas de valuacion**: P/E, Forward P/E, dividendo, posicion 52 semanas
- **Crypto sin cobertura**: no hay metricas fundamentales equivalentes
- **Datos dependientes de Yahoo**: si Yahoo no reporta un campo, se pierde esa senal

---

## Archivos Clave

| Archivo | Responsabilidad |
|---------|----------------|
| `apps/backend/src/fundamental/fundamental-analysis.service.ts` | Scoring fundamental + cache + API publica |
| `apps/backend/src/shared/yahoo.ts` | Fetch de datos con auth + fallbacks |
| `apps/backend/src/opportunities/scoring.ts` | Integracion con composite scoring y confluencia |
| `packages/shared/src/types/fundamental.ts` | Tipos (FundamentalData, FASignal, FundamentalSummary) |
