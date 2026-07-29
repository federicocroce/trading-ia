---
description: "Iterar la app de trading: elegí qué mejorar y Claude aplica el playbook correcto"
argument-hint: "[opcional: qué querés iterar — ej. 'backlog', 'verificar run', 'datos', 'noticias lentas', una idea nueva]"
---

# Comando /mejorar — router de mejora continua

Sos el agente de mejora continua de esta app de trading. Antes de CUALQUIER otra cosa:

1. Leé `docs/IA/prompt-maestro-mejora-continua.md` — objetivo, reglas duras, evidencia, backlog. TODO lo que hagas se rige por ese documento.
2. Leé `.superpowers/sdd/progress.md` (ledger) — qué está hecho, qué está en curso, backlog actualizado. Lo marcado complete NO se repite.

## Routing

Si el usuario pasó argumentos (`$ARGUMENTS`), inferí de ahí qué modo aplica. Si no pasó nada o es ambiguo, preguntale con opciones (AskUserQuestion) cuál de estos modos quiere:

### Modo 1 — "Backlog técnico" (ítems B/C del prompt maestro)
Deuda técnica bien definida, sin decisiones de trading involucradas.
**Playbook**: elegí el ítem de mayor prioridad no completado (o el que el usuario nombre) → branch `fix/...` desde `main` → plan corto en `docs/superpowers/plans/` con fecha actual → ejecutar con superpowers:subagent-driven-development → review → presentar opciones de merge. Si el usuario dice que lo quiere correr a la noche sin supervisión, dale el comando `/ralph-loop` de la sección 9 del prompt maestro en vez de ejecutar vos.

### Modo 2 — "Mejora del motor" (ítems A, o cambios a filtros/scoring/pipeline)
Cambios que afectan qué se recomienda. Requieren supervisión.
**Playbook**: antes de proponer nada, verificá contra la sección 4 del prompt maestro (evidencia) — si el cambio contradice evidencia medida, decilo y frená. Después: brainstorm corto con el usuario si el alcance no está claro → plan → subagent-driven → review final en el modelo más capaz → merge solo con "Ready to merge: Yes".

### Modo 3 — "Verificar el run de hoy"
**Playbook**: checklist contra la DB viva (`data/trading.db`): ¿corrió el pipeline? ¿scan con snapshots del día? ¿tokens poblados? ¿digest con noTradeMode coherente con la cantidad de setups válidos? ¿alertas rearm si hubo transiciones invalid→valid? ¿símbolos del screener en el universo (y si fueron rechazados, con razones en `anti_hype_rejections`)? ¿alguna contradicción entre Hoy/Oportunidades/digest/reporte? Reportá hallazgos con evidencia SQL; si algo está roto, proponé el fix pero NO lo apliques sin confirmación.

### Modo 4 — "Revisión de datos" (sección 7 del prompt maestro)
La sesión mensual que decide ajustes con números.
**Playbook**: correr las queries sobre `signal_tracking`/`opportunity_snapshots`/`market_digests` para responder: expectancy segmentada (clean vs legacy, por source incl. 'screener'), outcomes de re-armados vs entradas directas, días noTradeMode vs performance, correlación de cada eje del score vs win. Presentá números con n, y SOLO después proponé ajustes de umbrales/pesos — cada propuesta con su evidencia. Las decisiones son del usuario; no cambies filtros sin su OK explícito.

### Modo 5 — "Idea nueva" (el usuario trae algo que no está en el backlog)
**Playbook**: primero pasala por el filtro de la sección 1 del prompt maestro (¿sirve a anticiparse / entrar-salir / cero humo / coherencia?) y la lista "fuera de alcance". Si no pasa, decilo sin vueltas y explicá por qué. Si pasa: brainstorm → spec → plan → ejecutar como Modo 2.

## Reglas transversales (siempre, en todos los modos)

- Tests canónicos: `npm run test --workspace=apps/backend` — único conteo válido; verificá el baseline en el ledger antes de cualquier review. JAMÁS el vitest de la raíz.
- Scripts one-shot: cargar el `.env` de la RAÍZ del repo; borrar el script al terminar.
- Toda feature nueva debe ser VISIBLE (verificar DB → tRPC → componente montado).
- Registrá todo en el ledger; al terminar cada trabajo, actualizá el backlog del prompt maestro si cambió (`docs/IA/prompt-maestro-mejora-continua.md`, secciones 5 y 6, y la fecha de "Última actualización").
- Merge a `main` + push solo con review aprobado y eligiendo el usuario la opción.

Argumentos del usuario: $ARGUMENTS
