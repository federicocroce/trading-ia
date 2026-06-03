# Digest: Secciones simétricas Portfolio vs Mercado

**Fecha:** 2026-05-28
**Estado:** Aprobado por el usuario, listo para plan de implementación.

## Problema

En el digest del día (`MarketDigest`), los campos `wouldDo` / `wouldNotDo` están etiquetados como "Lo que SÍ haría hoy" / "Lo que NO haría", pero en la práctica el LLM los puebla **solo con activos del portfolio**. Causa raíz: el prompt `COMBINED_SYNTHESIS_PROMPT` los ubica bajo `--- SECCIÓN PORTFOLIO (específica) ---` sin instrucción de incluir activos fuera del portfolio (a diferencia de `topOpportunities` / `topImpactNews` que tienen instrucción explícita de ser portfolio-agnósticas).

Resultado: la UI muestra "Lo que SÍ haría hoy" pero el usuario no entiende por qué solo aparecen tenencias actuales. Las ideas de mercado existen pero en cards separadas con otro formato (`Oportunidades destacadas`, `En radar`), lo que crea asimetría conceptual.

## Objetivo

Reorganizar el digest en **dos secciones simétricas**, cada una con SÍ / NO:

```
┌─ TU PORTFOLIO (lo que ya tenés) ─────────────┐
│  ✅ Lo que SÍ haría   → portfolioWouldDo
│  ❌ Lo que NO haría   → portfolioWouldNotDo
└──────────────────────────────────────────────┘
┌─ MERCADO (fuera de tu portfolio) ────────────┐
│  ✅ Lo que SÍ haría   → marketWouldDo (+ "en radar" subrenglón)
│  ❌ Lo que NO haría   → marketWouldNotDo
└──────────────────────────────────────────────┘
```

## Alcance

**Dentro:**
- `MarketDigest` (type, prompt, persistencia, render en `DailySummary.tsx`).
- Migración DB para columnas nuevas.
- Fallback synthesizers separados portfolio / mercado.

**Fuera (no se toca):**
- `UnifiedAssetAnalysis.wouldDo` / `wouldNotDo` per-symbol (UnifiedAssetAnalysis, OpportunityCard, SymbolDetailPage, `UNIFIED_ASSET_ANALYSIS_PROMPT`, `opportunities.service`). Son campos distintos a nivel activo individual.
- `MarketReport.avoidList` (es del reporte completo, no del digest; vive en `MarketReportView` y queda como está).

## Diseño

### 1. Tipo `MarketDigest` (`packages/shared/src/types/intelligence.ts`)

```ts
export interface MarketDigest {
  generatedAt: number;
  overnightSummary: string;
  portfolioImpact: string;
  topOpportunities: Array<{ symbol: string; action: 'BUY' | 'SELL'; narrative: string }>;
  watching?: Array<{ symbol: string; narrative: string }>;
  warnings: string[];
  marketMood: 'risk-on' | 'risk-off' | 'mixed';

  // PORTFOLIO (activos en cartera)
  portfolioWouldDo: string[];
  portfolioWouldNotDo: string[];

  // MERCADO (activos fuera del portfolio)
  marketWouldDo: string[];
  marketWouldNotDo: string[];
}
```

**Compatibilidad:** se elimina `wouldDo` / `wouldNotDo` del tipo. Los lugares que los lean (digest específicamente, no per-symbol) se actualizan.

### 2. Prompt `COMBINED_SYNTHESIS_PROMPT` (`packages/shared/src/constants/prompts.ts`)

Cambios al prompt:

- En `--- SECCIÓN PORTFOLIO (específica) ---`:
  - Renombrar `wouldDo` → `portfolioWouldDo` y `wouldNotDo` → `portfolioWouldNotDo`.
  - Aclarar explícitamente: "SOLO símbolos que aparecen en la sección PORTFOLIO del input. Prohibido incluir tickers fuera de tu portfolio."

- En `--- SECCIÓN MERCADO (independiente del portfolio) ---`, agregar:
  - `marketWouldDo`: 3-5 trades de mercado (NO en portfolio). Mismo formato que portfolioWouldDo (ticker, entrada, stop, target, razón). Pueden venir de `topOpportunities` BUY o nuevas ideas del análisis.
  - `marketWouldNotDo`: 3-5 cosas a evitar del mercado. Frase con razón concreta + número. PROHIBIDO incluir tickers del portfolio (van en portfolioWouldNotDo).

- Reglas nuevas:
  - "Los 4 arrays son ARRAYS DE STRINGS." (mantiene la regla existente).
  - Coherencia: si un ticker está en `topOpportunities` con `action=BUY` y NO está en portfolio → debe aparecer en `marketWouldDo` (no en marketWouldNotDo).
  - El conjunto portfolio se determina desde la sección `PORTFOLIO` que ya se inyecta en el user message ([market-report.service.ts:203-210](apps/backend/src/intelligence/market-report.service.ts#L203-L210)).

### 3. Backend (`apps/backend/src/intelligence/market-report.service.ts`)

- Reemplazar `synthesizeWouldDoFromBuys` / `synthesizeWouldNotDoFromSells` por versiones que aceptan `portfolioSymbolSet: Set<string>` y devuelven `{ portfolioWouldDo, portfolioWouldNotDo, marketWouldDo, marketWouldNotDo }` particionando opportunities por pertenencia.
- En `buildFallbackDigest`: poblar los 4 arrays.
- En el parser del LLM (alrededor de [market-report.service.ts:425-450](apps/backend/src/intelligence/market-report.service.ts#L425-L450)):
  - Leer `portfolioWouldDo`, `portfolioWouldNotDo`, `marketWouldDo`, `marketWouldNotDo` del JSON.
  - Aplicar `sanitizeWouldNotDo` (filtro de bare-tickers, conflicto con BUY) a los dos `*WouldNotDo`.
  - Si alguno viene vacío → fallback al synthesizer correspondiente.
  - Defensa adicional: reasignar items mal ubicados (ticker de portfolio en `marketWouldDo` → mover a `portfolioWouldDo`, y viceversa).

### 4. Base de datos (`apps/backend/src/db/schema.ts` + migración)

Tabla `marketDigest`:
- **Repurpose:** columnas `would_do` / `would_not_do` pasan a ser portfolio-específicas (mismo nombre, semántica acotada). No se renombran para no romper filas existentes.
- **Nuevas columnas:** `market_would_do TEXT NOT NULL DEFAULT '[]'` y `market_would_not_do TEXT NOT NULL DEFAULT '[]'` (JSON `string[]`).
- Migración Drizzle generada con `pnpm drizzle-kit generate` (siguiendo patrón del repo, separando ALTERs con `--> statement-breakpoint` como en migration 0034 según el commit reciente `8263658`).

### 5. Repositorio (`apps/backend/src/intelligence/pipeline-artifacts.repository.ts`)

- Serializar/deserializar los 4 campos. Mapeo:
  - `portfolioWouldDo` ↔ `would_do`
  - `portfolioWouldNotDo` ↔ `would_not_do`
  - `marketWouldDo` ↔ `market_would_do`
  - `marketWouldNotDo` ↔ `market_would_not_do`
- Lectura defensiva: si la columna market es `null` o JSON inválido → `[]`.

### 6. Frontend (`apps/frontend/src/daily/DailySummary.tsx`)

Reemplazar la sección actual (líneas ~615-677) por **dos bloques con headers**, cada uno con SÍ verde + NO rojo:

```
[Header: "TU PORTFOLIO"]
  ✅ Lo que SÍ haría con tu portfolio   — portfolioWouldDo
  ❌ Lo que NO haría con tu portfolio   — portfolioWouldNotDo

[Header: "MERCADO" (con subtítulo "fuera de tu portfolio")]
  ✅ Lo que SÍ haría en el mercado     — marketWouldDo
       ↳ "En radar (triggers de entrada)" — digest.watching (subrenglón)
  ❌ Lo que NO haría en el mercado     — marketWouldNotDo
```

- La card existente "Oportunidades destacadas" (`topOpportunities`) **se elimina del digest UI**: su contenido vive ahora en `marketWouldDo` (con precio/stop concretos en string).
- `digest.watching` se renderiza como sub-bloque dentro de Mercado → SÍ (porque son triggers de futuras entradas, no qué hacer hoy).
- Estado vacío:
  - Si `portfolioWouldDo` vacío → mostrar el placeholder amarillo "Regenerar" existente, pero específico de portfolio.
  - Si `marketWouldDo` vacío → texto discreto "Sin oportunidades nuevas hoy" (sin botón regenerar, evita duplicar el CTA).
- El render `portfolioImpact` queda dentro del header `TU PORTFOLIO`.

### 7. Otros consumidores del tipo

Búsqueda confirma que `MarketDigest.wouldDo` / `wouldNotDo` solo se leen en:
- `DailySummary.tsx` (cambia según punto 6).
- `pipeline-artifacts.repository.ts` (cambia según punto 5).
- `market-report.service.ts` (cambia según puntos 3 y 4).

Nada más en `apps/` o `packages/` los consume (otros matches son per-symbol).

## Riesgos / consideraciones

1. **Filas viejas sin `market_*`:** la migración pone default `'[]'`. La UI muestra los bloques de mercado vacíos hasta que se regenere el digest del día → aceptable.
2. **El LLM puede confundir y meter tickers de portfolio en `marketWouldDo`:** mitigado por (a) instrucción explícita en el prompt, (b) reasignación defensiva en el parser (punto 3).
3. **Pérdida de la card "Oportunidades destacadas":** la info no se pierde — se reformula como strings actionables en `marketWouldDo`. `topOpportunities` sigue en la data del digest por si en el futuro se quiere reusar.
4. **Persistencia del cambio:** dado que `would_do` / `would_not_do` ahora son portfolio-only, las filas pre-migración tendrán mezcla portfolio/market en `would_do`. Sintomático: viejos digests del historial mostrarán solo el lado portfolio (que ya era el comportamiento real). No requiere backfill.

## Criterios de aceptación

1. El digest generado por el pipeline incluye los 4 arrays con contenido coherente:
   - `portfolioWouldDo`/`portfolioWouldNotDo` solo con símbolos que están en el portfolio actual.
   - `marketWouldDo`/`marketWouldNotDo` solo con símbolos que NO están en el portfolio.
2. La UI de `DailySummary` muestra dos secciones tituladas TU PORTFOLIO y MERCADO, cada una con SÍ (verde) y NO (rojo).
3. La card vieja "Oportunidades destacadas" ya no aparece.
4. Regenerar el digest tras la migración produce los 4 arrays poblados.
5. Filas viejas se leen sin error: `marketWouldDo`/`marketWouldNotDo` quedan en `[]` y la UI lo refleja.

## Out of scope explícito

- Repensar `MarketReport` (el reporte completo, distinto del digest) — su `avoidList` y secciones quedan como están.
- Tocar `UnifiedAssetAnalysis.wouldDo`/`wouldNotDo` per-symbol.
- Cambiar `OpportunityCard` o `SymbolDetailPage` (consumen el per-symbol).
