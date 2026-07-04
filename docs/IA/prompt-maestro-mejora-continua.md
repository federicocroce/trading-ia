# Prompt maestro — mejora continua del trading dashboard

> **Uso**: pegá este documento (o referencialo) como prompt inicial de cualquier sesión de IA que vaya a trabajar en este repo — incluido `/ralph-loop` para corridas nocturnas autónomas. Contiene todo lo que una sesión fresca necesita: objetivo, reglas duras, estado, evidencia, backlog y verificación. Última actualización: 2026-07-04 (post-P3 + deuda-discovery).

---

## 1. Objetivo del dueño (no negociable)

Federico es un swing trader argentino individual. La app existe para **una sola cosa**: que gane plata operando con ventaja informativa real. Eso se descompone en:

1. **Anticiparse al mercado**: detectar setups operables ANTES de que sean obvios (screener, re-armado, señales de evidencia PEAD/insiders).
2. **Saber cuándo entrar y cuándo salir**: niveles concretos (entrada, stop, target), R/R honesto, trailing stops, jerarquía de decisión clara.
3. **CERO humo**: nunca recomendar un ticker que no pase los filtros de calidad (caso SDOT: micro-cap pumpeada por noticias, recomendada, −72% en 2 semanas). Ante la duda, la app dice "no sé" o "hoy no se opera" — jamás inventa convicción.
4. **Coherencia total**: ninguna sección puede contradecir a otra (mismo ticker VENDER en un lado y COMPRAR en otro = pecado capital, ya pasó con MARA y se arregló con la jerarquía de verbos).

Si una mejora no sirve directamente a 1-4, no se hace. Fuera de alcance a consciencia: day-trading intradía (velas 1-5min), screeners pagos, opciones.

## 2. La app

- **Repo**: `/Users/federicocroce/Docu/Fede/trading` — monorepo npm workspaces: `apps/backend` (Hono + tRPC + SQLite/drizzle), `apps/frontend` (React + Vite + Tailwind), `packages/shared` (tipos).
- **Flujo core**: pipeline diario (cron pre-market 7:30 ET, lun-vie) → noticias (RSS/NewsAPI) → extracción de tickers → screener de mercado (Yahoo) → scan técnico+fundamental de ~110-130 símbolos → scoring compuesto → veredictos con niveles → digest/reporte con LLM (capa narrativa) → vista "Hoy" con verbos de decisión.
- **Datos**: `data/trading.db` (SQLite). Tablas clave: `opportunity_scans`/`opportunity_snapshots`, `signal_tracking` (resolución path-aware de señales, R-multiples), `anticipatory_alerts` (kinds: anticipatory/stop_breach/rearm), `discovered_symbols`, `anti_hype_rejections`, `market_digests`/`market_reports`, `unified_analysis_results`.
- **LLMs**: Gemini 2.5 Pro/Flash, Groq llama-3.3-70b, OpenRouter free (nemotron-3-ultra-550b, gpt-oss-120b, nemotron-3-nano-reasoning, llama-3.3-70b), LM Studio local, Sonnet en chat. Router con fallbacks + circuit breaker + timeouts 90s + tracking de tokens.
- **Branch de trabajo**: `feat/outcome-resolver` (remote `github-personal:federicocroce/trading-ia.git`). Trabajá siempre en branches `fix/...` desde ahí; merge solo con review aprobado.

## 3. Reglas duras (violarlas = rechazo automático en review)

1. **Fail-closed en todo**: dato faltante = rechazo/null honesto, NUNCA neutral ni pass silencioso. (marketCap null → no pasa quality bar; changePct null → no pasa anti-chase; SMA200 null → screener lo descarta.)
2. **Jerarquía de decisión** (contrato de P2, intocable):
   - Trailing/chandelier stop tocado = salida dura → verbo **VENDER**.
   - Motor dice SELL sin stop tocado = advisory → verbo **REVISAR**.
   - LLM = capa narrativa; su `action` solo puede DEGRADAR (gate `applyLlmAction`, rank SELL:0 < WATCH:1 < HOLD:2 < BUY:3). El LLM jamás sube una acción ni decide un verbo.
3. **Quality bar**: acciones requieren marketCap ≥$500M Y precio ≥$5 (fail-closed si falta dato); ETF/commodity solo precio; crypto exenta. Riesgo del setup: stop ≤3×ATR y riesgo ≤10% o `setupQuality='invalid'` → BUY degradado a WATCH, sin sizing.
4. **envNumber lazy** (`apps/backend/src/shared/env-number.ts`): toda constante configurable se lee DENTRO de la función. Jamás `process.env` a nivel módulo (el hoisting ESM corre antes de `dotenv.config()` — ya causó env vars inertes).
5. **Payloads tRPC aditivos**: campos nuevos por spread sobre el shape existente. Jamás wrappers que rompan consumidores (ya se revirtió una violación).
6. **Tests canónicos**: `npm run test --workspace=apps/backend` — ÚNICO conteo válido (420 al 2026-07-04, post deuda-discovery). El vitest de la raíz barre worktrees stale y da conteos falsos: NUNCA usarlo ni citarlo. Todo claim de verificación se re-corre antes de aceptarse (un implementador ya fabricó "587 tests" inexistentes).
7. **Convenciones**: comentarios en español, imports ESM con `.js`, TDD (test rojo primero) para toda lógica, funciones de decisión puras (sin I/O) para testearlas sin mocks. Commits terminan con `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
8. **Migraciones drizzle**: journal reparado en P2; toda migración nueva lleva `when` mayor a las existentes. Verificar que la columna exista en la DB viva antes de asumir que un insert funciona.
9. **Proceso**: planes en `docs/superpowers/plans/YYYY-MM-DD-*.md`; ejecución subagent-driven (implementador fresco por task + review por task + review final whole-branch en el modelo más capaz); ledger durable en `.superpowers/sdd/progress.md` — leelo SIEMPRE antes de empezar (tasks marcadas complete NO se repiten).

## 4. Evidencia acumulada (no re-litigar sin datos nuevos)

- **Sentiment de noticias NO tiene señal**: r=+0.03 vs win (n=565). Peso reducido a 0.05 simbólico con test de invariante. No subirlo sin evidencia de expectancy.
- **Técnico es la única señal medida**: r=+0.24 monótono. Fundamental: signo invertido (r=−0.07).
- **Causal chains: 52% de acierto** (moneda). Útiles como contexto, no como señal.
- **Win rate real BUY: ~37%** (el 83% histórico era un bug de WATCH evaluado como short). Expectancy: setups limpios (riesgo ≤10%) +0.03R vs legacy −0.02R — el clamp de riesgo PAGA.
- **El LLM aporta narrativa y macro_events**; su `action` solo cambia el resultado en ~3.9% de casos (siempre degradando). No dar más poder de decisión al LLM sin medirlo.
- **signal_tracking captura gratis** la expectancy segmentada por fuente (`source='screener'`, setups clean/legacy, WATCH-con-setup-inválido como grupo de medición). Toda propuesta de cambiar pesos/filtros debe citar estos números.

## 5. Estado (2026-07-04, post-P0/P1/P2/P3 — todo mergeado y pusheado)

Hecho y verificado: resolución direccional path-aware de señales + R-multiples; gate LLM; quality bar; clamp de riesgo; cron pre-market; tokens end-to-end; verbo REVISAR + jerarquía; extractor de tickers por word-boundary (mató las alucinaciones ROAD/CAST); sentiment 0.05; screener de mercado Yahoo (embudo: quality bar → anti-chase ±15% → SMA200 → setup válido + RR≥2 → `discovered_symbols source='screener'`); watchlist de re-armado (invalid→valid + BUY/WATCH + score≥55 → alerta `kind='rearm'` + sección visible con badge "SETUP OPERABLE"); noTradeMode determinístico (<3 setups válidos o sin scan → "hoy no se opera"); suggestedWeight graduado (10/6/5/0); rrToFirstResistance; aviso de concentración sectorial sobre recomendaciones renderizadas.

**Verificación runtime pendiente** (primer pipeline con mercado abierto, lunes 2026-07-07): digest con noTradeMode/concentración en vivo; primer re-armado real; screener con volumen>0.

## 6. Backlog priorizado (arrancá por acá)

**A. Con impacto directo en decisiones:**
1. **Stage de noticias tarda ~65 min** (903 artículos) — cuello de botella del pipeline entero. Perfilar y paralelizar/cachear.
2. **Anti-hype del scan es fail-open cuando falta `tech`** (deja pasar el símbolo entero; señalado por review final P3, pre-existente). Alinear con la filosofía fail-closed y medir cuántos símbolos afecta.
3. **Concentración agrupa por plaza, no sector económico** (`sectorLabel`: 3 CEDEARs no correlacionados = "mismo trade"). Decidir taxonomía (riesgo CCL compartido es parcialmente defendible).
4. **Expectancy segmentada del screener**: cuando `signal_tracking` junte 1-2 meses de señales `source='screener'`, medir si el embudo paga o ajustar umbrales (SCREENER_MIN_RR, anti-chase).
5. **FMP key 403** (market movers muertos) — el usuario decide si renovarla; si no, eliminar el código muerto.

**B. Deuda técnica que puede morder:**
6. ~~ticker-validator 1 letra~~, ~~upsertDiscoveredSymbol sin refresh de contexto~~, ~~relevance piso del screener~~ y ~~.env.example sin vars de screener/no-trade~~ — **saldados en branch `fix/deuda-discovery` (2026-07-04)**: whitelist fail-closed de 21 tickers de 1 letra; `buildDiscoveredSymbolUpdate` pura refresca `discoveredFrom`+contexto al reactivar (caso PFE) con relevanceScore entrante como piso; screener entra con relevance 30 y eviction extraída a `selectEvictionCandidates` testeada; `.env.example` documenta SCREENER_*/NO_TRADE_MIN_SETUPS/MAX_SETUP_RISK_PCT.
7. Race en eviction (123 > cap 120); GC de 7 días del bloque anticipatory no gatea por kind (benigno documentado).
8. Relevance de filas ACTIVAS no escala por re-mención (estructural: `registerNovelTickers` filtra activas como known — el UPDATE solo corre al reactivar). Si algún día se quiere escalar relevance en vivo, es feature deliberada, no patch.

**C. Cosmético/menor**: citas de línea "scoring.ts:696" en comentarios/tests (se pudren); copy "hoy" en RearmWatchlist con alertas de hasta 7 días (falta mostrar `lastSeenDate`); umbral display 0.1 vs toFixed(1) en OpportunityCard; webSearch (EXA/Tavily) caído en 104/121 runs — skip honesto ya implementado, decidir si se arregla o se elimina.

## 7. Preguntas abiertas (responder con datos, no con opinión)

- ¿El screener encuentra ganadores o solo ruido líquido? → esperar n≥30 señales `source='screener'` resueltas y comparar expectancy vs discovery por noticias.
- ¿El re-armado anticipa entradas buenas? → medir outcome de los símbolos alertados con `kind='rearm'` vs los que entraron directo.
- ¿noTradeMode se activa demasiado/poco? → contar días active=true vs performance de los picks en esos días.
- ¿Vale la pena el stage de noticias completo si sentiment r=0.03? → lo que paga son macro_events/causal context para el reporte, no el sentiment; si el costo (65 min + tokens) supera eso, recortar agresivamente.
- ¿El calibrador de pesos (weight proposals) ya tiene n suficiente post-fix para proponer pesos con evidencia? (`scoring_weight_history` estaba vacía → defaults.)

## 8. Cómo verificar cualquier cambio (checklist de cierre)

1. `npm run build:shared && npm run typecheck` — limpio en los 3 workspaces.
2. `npm run test --workspace=apps/backend` — citar el conteo EXACTO (baseline 399; todo cambio con lógica suma tests).
3. Si tocaste el pipeline/scan: one-shot real (script temporal `npx tsx` desde `apps/backend`, cargando el `.env` de la RAÍZ del repo — `dotenv.config({ path: '../../.env' })` — o las API keys no cargan) y verificar en `data/trading.db` que las filas esperadas existan. Borrar el script temporal después.
4. Coherencia: ¿alguna superficie (Hoy / Oportunidades / digest / reporte / chat) puede ahora contradecir a otra? Buscar el doble discurso activamente.
5. ¿La feature es VISIBLE para el usuario? (P3 casi shippea la watchlist de re-armado sin ninguna superficie de render — verificar la ruta completa DB → tRPC → componente montado.)
6. Review final whole-branch en el modelo más capaz antes de merge; merge a `feat/outcome-resolver` + push solo con "Ready to merge: Yes".

## 9. Para corridas autónomas (`/ralph-loop`)

```
/ralph-loop "Leé docs/IA/prompt-maestro-mejora-continua.md y .superpowers/sdd/progress.md. Elegí el ítem de backlog de mayor prioridad (sección 6, orden A→B→C) que no esté marcado complete en el ledger, armá un plan corto en docs/superpowers/plans/ con fecha actual, ejecutalo con subagent-driven-development (tests canónicos: npm run test --workspace=apps/backend), review final, y registrá TODO en el ledger. NO mergees a feat/outcome-resolver sin review 'Ready to merge: Yes'; dejá el branch listo y el veredicto en el ledger. Al completar el ítem y dejar el ledger actualizado decí: ITEM_COMPLETO_Y_VERIFICADO" --completion-promise "ITEM_COMPLETO_Y_VERIFICADO" --max-iterations 20
```

Reglas para el loop: un ítem por corrida; la promise solo se emite con suite verde citada + ledger actualizado; ante ambigüedad que requiera decisión del dueño (ej. renovar FMP, taxonomía de sectores), NO decidir — dejar la pregunta escrita en el ledger y pasar al siguiente ítem.
