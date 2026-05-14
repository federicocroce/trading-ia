# ETF Watchlist & Pipeline Integration — Design Spec

**Date:** 2026-05-04  
**Status:** Approved

## Goal

Add ETFs (and other instruments: bonds, commodities, sector ETFs, crypto ETFs) as first-class citizens in the recommendation pipeline, with a dedicated watchlist management UI and filters across the app. No breaking changes to existing portfolio, P&L, or transaction logic.

---

## Architecture

```
NUEVO                          EXISTENTE (sin cambios)
─────────────────────          ─────────────────────────
etf_watchlist (tabla DB)       symbols (tabla DB)
~60 ETFs por categoría         Portfolio + stocks curated
                               P&L, transacciones, CRUD

getEtfWatchlist()              getActiveSymbolList()
↓                              ↓
         PIPELINE UNIFICADO
         ┌──────────────────────────────┐
         │ Evidence Signals Scanner     │
         │  Stocks → PEAD+insider+opciones│
         │  ETFs   → técnicos+macro+opciones│
         └──────────────────────────────┘
                    ↓
         Opportunity Scoring (stocks + ETFs juntos)
                    ↓
         LLM Unified Analysis
         "BUY NVDA" + "BUY GLD" + "HOLD QQQ"
                    ↓
         ┌──────────────────────────────┐
         │ UI: OpportunityDashboard     │
         │ Filtro: [Todos][Acciones][ETFs][Crypto]│
         └──────────────────────────────┘
```

**Principio clave:** `etf_watchlist` es completamente separada de `symbols`. Portfolio, P&L, transacciones, CRUD — nada de eso se toca. Los ETFs solo entran al pipeline de análisis y recomendaciones.

---

## Sección 1: Data Layer

### Nueva tabla `etf_watchlist`

```sql
etf_watchlist
├── id          integer primary key autoincrement
├── symbol      text unique not null       -- "SPY"
├── name        text not null              -- "SPDR S&P 500 ETF"
├── category    text not null              -- ver categorías abajo
├── description text                       -- "Replica el S&P 500..."
└── active      boolean default true
```

**Categorías válidas:** `indices` | `sectores` | `bonos` | `commodities` | `latam` | `internacional` | `crypto` | `factor`

### Seed inicial (~60 ETFs)

| Categoría | Símbolos |
|-----------|---------|
| indices | SPY, QQQ, IWM, DIA, VT, VTI |
| sectores | XLK, XLE, XLF, XLV, XLI, XLY, XLP, XLU, XLB, XLRE, XLC, SMH, SOXX, IBB |
| bonos | TLT, IEF, SHY, AGG, HYG, LQD, EMB, TIP |
| commodities | GLD, SLV, USO, UNG, CORN, WEAT, SOYB |
| latam | EWZ, ILF, ARGT, GXG, ECH |
| internacional | EFA, EEM, EWJ, EWG, EWU, FXI, KWEB, INDA |
| crypto | IBIT, FBTC, ETHA |
| factor | VTV, VUG, VIG, MTUM |

### Nuevas funciones en `repository.ts`

- `getEtfWatchlist()` → todos los ETFs activos con metadata completa
- `getEtfSymbols()` → solo array de strings de símbolos
- `addEtfToWatchlist(symbol, name, category, description?)` → solo inserta, sin validación
- `removeEtfFromWatchlist(symbol)` → soft delete (active = false)

---

## Sección 2: Cambios al Pipeline (Backend)

Todos aditivos. Cero cambios destructivos.

### 2a. News Aggregator — `news-aggregator.service.ts`

```ts
// Antes
const symbols = getActiveSymbolList();

// Después
const symbols = [...getActiveSymbolList(), ...getEtfSymbols()];
```

Los ETFs del watchlist reciben noticias igual que stocks.

### 2b. Evidence Signals Scanner — `symbol-screener.service.ts`

Reemplazar el array hardcodeado `CURATED_ETF_SYMBOLS` con `getEtfSymbols()` dinámico desde DB. La lógica ETF ya existe (sin PEAD, sin insider, solo técnicos + opciones) — solo cambia la fuente de la lista.

### 2c. Opportunity Scoring — `opportunities.service.ts`

El scorer ya tiene soporte para `'etfs-sectors'`. Extender el universo de candidatos para incluir símbolos de `getEtfSymbols()`. El `asset-classifier.ts` ya detecta `instrumentType: 'etf'` correctamente vía Yahoo Finance.

### Sin tocar

- Pipeline de portfolio (P&L, transacciones, posiciones)
- Market report diario
- Sector rotation (sigue usando sus ETFs hardcodeados internamente)
- Deep analysis
- Macro intelligence

---

## Sección 3: API (tRPC)

Nuevo router `etf.router.ts`:

```ts
etf.getWatchlist()           // GET todos los ETFs activos con metadata
etf.addToWatchlist(symbol, category, description?)  // POST: valida símbolo en Yahoo Finance (quoteType=ETF), luego inserta
etf.removeFromWatchlist(symbol)  // DELETE soft
etf.getCategories()          // GET lista de categorías disponibles
```

---

## Sección 4: UI

### 4a. OpportunityDashboard — filtro por tipo de instrumento

Agregar chips encima del grid de oportunidades:

```
[Todos] [Acciones] [ETFs] [Crypto]
```

Filtra client-side por `instrumentType` del opportunity. Sin cambios al backend.

### 4b. Watchlist — rediseño con tabs

Estructura nueva:

```
Watchlist
├── Search bar: "Buscar por nombre o símbolo..."
│
├── Tabs por tipo:
│   [Portfolio] [ETFs] [Acciones] [Crypto]
│
├── Tab "Portfolio"
│   └── Posiciones actuales (igual que hoy, sin cambios)
│
├── Tab "ETFs"
│   ├── Sub-filtro por categoría (chips)
│   │   [Todos][Índices][Sectores][Bonos][Commodities][Latam][Internacional][Crypto][Factor]
│   ├── Grid de ETF cards (símbolo, nombre, categoría, descripción)
│   └── Botón "+" → modal: ingresar símbolo → validar → elegir categoría → guardar
│
├── Tab "Acciones"
│   └── Todos los símbolos de la tabla `symbols` que no tienen posición en portfolio (curated US stocks, discovered tickers) — filtrable por nombre/símbolo
│
└── Tab "Crypto"
    └── BTC-USD, ETH-USD, etc.
```

El search bar filtra en la tab activa por nombre o símbolo (y descripción en tab ETFs).

### 4c. Componentes nuevos

- `ETFWatchlistTab.tsx` — tab ETFs con sub-filtros y grid
- `ETFCard.tsx` — card individual con símbolo, nombre, categoría, descripción
- `AddETFModal.tsx` — modal para agregar nuevo ETF al watchlist

---

## Consideraciones técnicas

- **EWZ y AGG** ya están en `symbols` table. Se pueden dejar ahí (portfolio) y también agregar al `etf_watchlist` para análisis — no hay conflicto porque son tablas separadas.
- **CURATED_ETF_SYMBOLS** hardcodeado se reemplaza con DB, pero el comportamiento (sin PEAD/insider) permanece igual.
- **Validación al agregar:** antes de insertar un ETF nuevo, verificar via Yahoo Finance que el símbolo existe y es de tipo ETF/MUTUALFUND. Rechazar si no.
- **Cache:** el pipeline de oportunidades ya tiene su propio TTL. No se necesita cache adicional para ETFs.

---

## Lo que esta feature NO hace (fuera de scope)

- Opciones sobre ETFs (ya se analizan, sin cambios)
- Leveraged ETFs (3x) — se pueden agregar al watchlist manualmente pero no se recomiendan activamente
- Forex ETFs (UUP, FXE) — fuera de scope por ahora
- Backtesting de ETFs — fuera de scope
