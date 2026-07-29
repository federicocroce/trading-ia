# Ledger — Abogado del diablo

> Registro durable de la auditoría adversarial. Se escribe desde `/abogado-del-diablo <sector>`.
> El prompt vive en `.claude/commands/abogado-del-diablo.md`; el criterio contra el que se juzga todo está en `docs/IA/prompt-maestro-mejora-continua.md` §1.
>
> **Regla del ledger**: un hallazgo sin evidencia verificable (código con línea citada, SQL con `n` y output, o comando con salida) no entra acá — va a "sospechas sin verificar" del informe y se queda ahí hasta que alguien lo pruebe.

## Estado por sector

Un sector queda `AUDITADO` cuando una corrida completa no produce hallazgos P0–P3 nuevos y los abiertos están `RESUELTO` o `ACEPTADO`. **La fecha caduca**: el código se mueve, y un sector auditado hace dos meses vuelve a estar sucio.

| sector | último pase | estado | abiertos |
|---|---|---|---|
| `pipeline` | — | nunca auditado | — |
| `descubrimiento` | — | nunca auditado | — |
| `motor` | — | nunca auditado | — |
| `guardian` | — | nunca auditado | — |
| `cartera` | — | nunca auditado | — |
| `medicion` | — | nunca auditado | — |
| `llm` | — | nunca auditado | — |
| `backend` | — | nunca auditado | — |
| `frontend` | — | nunca auditado | — |
| `operacion` | 2026-07-29 | pre-flight solamente | AD-001, AD-002, AD-003 |
| `negocio` | — | nunca auditado | — |
| `coherencia` | — | nunca auditado | — |

**Prioridad sugerida para la primera vuelta**: `guardian` y `medicion` primero. Son los dos sectores que sostienen todo lo que el §4 da por bueno y, justamente por eso, los menos atacados. Después `pipeline` y `descubrimiento` (donde el usuario ya sospecha que hay mejora), y `negocio` al final, cuando haya evidencia acumulada para contestarlo en serio.

---

## Hallazgos

Severidades: **P0** pierde plata · **P1** humo · **P2** incoherencia · **P3** medición falsa · **P4** peso muerto · **P5** cosmético.
Estados: `ABIERTO` · `REFUTADO` · `ACEPTADO` (el dueño convive con el riesgo) · `RESUELTO` (commit).

### AD-001 · P1 · operacion · 2026-07-29 · ABIERTO

**Claim atacado**: la app muestra el estado del mercado de hoy.

**Hallazgo**: el pipeline no corre desde el viernes 2026-07-24. Al miércoles 29 se perdieron tres ruedas (lun 27, mar 28, mié 29) y todas las superficies muestran datos del 24 — sin que se haya verificado que la UI declare esa antigüedad.

**Evidencia**:
```
$ sqlite3 data/trading.db "SELECT date, status FROM pipeline_runs WHERE date >= '2026-07-20' ORDER BY date;"
2026-07-20|ok
2026-07-21|partial
2026-07-22|ok
2026-07-23|failed
2026-07-23|ok
2026-07-24|ok        <- última

$ sqlite3 data/trading.db "SELECT 'opportunity_scans', MAX(scanned_at) FROM opportunity_scans
  UNION ALL SELECT 'today_proposals', MAX(scan_date) FROM today_proposals
  UNION ALL SELECT 'market_digests', MAX(report_date) FROM market_digests
  UNION ALL SELECT 'cycle_radar_snapshots', MAX(snapshot_date) FROM cycle_radar_snapshots
  UNION ALL SELECT 'signal_tracking', MAX(signal_date) FROM signal_tracking;"
opportunity_scans|2026-07-24T13:42:01.299Z
today_proposals|2026-07-24
market_digests|2026-07-24
cycle_radar_snapshots|2026-07-24
signal_tracking|2026-07-24

$ lsof -ti:3001
(vacío — nada escuchando)
```

**Causa inmediata**: el cron vive dentro del proceso del backend (`apps/backend/src/shared/cron.ts`). Sin proceso a las 7:30 ET no hay pipeline. No es un bug: es cron in-process en una laptop, y la disponibilidad del sistema es la disponibilidad de la máquina.

**Qué habría que creer para que esto esté bien**: que el dueño levanta el backend todos los días hábiles antes de la apertura, **y** que la UI declara visiblemente la antigüedad del dato cuando no corrió.

**Test que lo falsifica**: contar días hábiles con corrida sobre los últimos 60; abrir la app con datos viejos y ver si la fecha del scan es visible sin buscarla.

**Daño**: decidir con niveles, stops y precios de hace cinco ruedas creyéndolos de hoy. Toca el objetivo #1 (protección) y el #3 (cero humo). Sube a **P0** si se confirma que la UI no declara la antigüedad.

**Estado**: ABIERTO — falta verificar el lado del frontend.

---

### AD-002 · P3 · operacion · 2026-07-29 · ABIERTO

**Claim atacado**: §4 del prompt maestro, *"el pipeline fallaba el 35.8% de las corridas… **Fix**: timeout duro (`NEWS_STAGE_TIMEOUT_MS`, 300s) + solo `analysis` puede marcar la corrida como FALLIDA"*, presentado como saldado.

**Hallazgo**: el fix tiene **cero corridas reales**. El commit es del 2026-07-28 16:07; la última corrida del pipeline es del 2026-07-24. Ninguna línea de ese cambio se ejecutó nunca contra el mercado.

**Evidencia**:
```
$ git log -1 --format="%h %ad %s" --date=iso 48e0bd5
48e0bd5 2026-07-28 16:07:52 -0300 fix(fiabilidad): que noticias no tumbe el pipeline, gatear smart y medir tokens

$ sqlite3 data/trading.db "SELECT MAX(started_at) FROM pipeline_runs;"
2026-07-24T13:32:02.526Z
```

**Qué habría que creer para que esto esté bien**: que los tests unitarios cubren el comportamiento de `withStageTimeout` y del cálculo `ok`/`partial`/`failed` en condiciones de fallo real de red y de proveedor. Los tests cubren la lógica; no cubren que la etapa efectivamente se destrabe en producción.

**Test que lo falsifica**: una corrida real posterior al commit que registre `news_status='failed'` o vencido por timeout, con `status` de la corrida en `'partial'` y el scan del día producido igual.

**Daño**: el §4 registra como resuelto el modo de fallo más frecuente del sistema. Si el fix no funciona —o funciona a medias— la próxima lectura de la tasa de fallo va a atribuirle una mejora que no hizo. Es el quinto caso del mismo patrón en este repo: `EXIT_ON_CLOSE` inerte, el e2e apuntando a un puerto equivocado, la etiqueta `yahoo`/`finnhub`, el calibrador que escribe en una tabla que nadie lee.

**Estado**: ABIERTO — se cierra con una corrida real, no con una lectura de código.

---

### AD-003 · P4 · operacion · 2026-07-29 · ABIERTO

**Claim atacado**: implícito en el §4 — que la confiabilidad del pipeline es un problema conocido y en vías de mejora.

**Hallazgo**: la tasa de fallo es **plana en cuatro meses**, no descendente. Y hay más corridas que días hábiles, o sea disparos manuales mezclados con el cron: cualquier lectura de "el pipeline corre todos los días" está midiendo dos cosas a la vez.

**Evidencia**:
```
$ sqlite3 data/trading.db "SELECT substr(date,1,7) mes, COUNT(*) n, SUM(status='ok') ok,
    SUM(status='partial') partial, SUM(status='failed') failed FROM pipeline_runs GROUP BY 1 ORDER BY 1;"
2026-04|39|25|0|14   (36% failed)
2026-05|30|18|0|9    (30%)
2026-06|31|16|3|12   (39%)
2026-07|23|11|3|9    (39%)
```
Julio: 23 corridas hasta el día 24 (~17 días hábiles). El 2026-07-23 tiene dos corridas registradas — una `failed` y una `ok`.

**Qué habría que creer para que esto esté bien**: que las corridas manuales son re-intentos deliberados y que el `ok` posterior al `failed` del mismo día produjo trabajo real, no un no-op por el skip de "ya hay datos del día".

**Test que lo falsifica**: comparar `pipeline_stage_artifacts` de las dos corridas del 2026-07-23 y ver qué produjo cada una; separar corridas por origen (cron vs manual) antes de leer cualquier tasa.

**Daño**: la métrica de confiabilidad que se usa para priorizar trabajo mezcla poblaciones. Si las manuales son las que fallan menos —porque el dueño está mirando— la confiabilidad desatendida es peor que el 39% reportado.

**Estado**: ABIERTO
