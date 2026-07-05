# Plan — Chat agéntico con Claude Agent SDK (patrón Jarvis)

**Fecha**: 2026-07-05 · **Branch**: `feat/chat-agente` (desde `main`) · **Acordado con el dueño**: sí (upgrade del chat primero; análisis post-pipeline y mejora de prompts quedan para después).

## Objetivo

Reemplazar la capa del chat (hoy: una llamada simple a la API de Anthropic con contexto armado a mano y capado) por un agente Claude embebido vía `@anthropic-ai/claude-agent-sdk` — mismo patrón que Jarvis (`claude -p` headless) pero con API tipada. El agente investiga con tools acotadas en vez de recibir todo pre-digerido.

## Diseño

- **`apps/backend/src/chat/sql-guard.ts`** (pura, TDD): valida que un SQL sea una única sentencia de solo lectura (`SELECT`/`WITH`). Fail-closed: cualquier duda = rechazo.
- **`apps/backend/src/chat/chat-agent.service.ts`**: sesión por turno con `query()` del SDK + `resume` (session id) para memoria multi-turno.
  - Tool custom `consultar_db` (MCP in-process): SQL read-only sobre `data/trading.db` — conexión `readonly: true` + sql-guard + cap de filas.
  - `allowedTools`: `Read`, `Grep`, `Glob` (cwd = raíz del repo, para docs/) + la tool de DB. Sin `Bash`, sin `Edit`/`Write`.
  - System prompt: el mismo enriquecido del chat actual (portfolio + acciones del motor + guard anti-contradicción) + reglas del agente (solo narrativa, citar datos, "no sé" honesto).
  - Streaming: deltas de texto + avisos de tool-use → `broadcastChatEvent` por el WS existente, correlacionados por `requestId`.
  - Timeout duro por turno (`CHAT_AGENT_TIMEOUT_MS`, envNumber lazy) vía AbortController.
- **`chat.router.ts`**: procedure nuevo `chat.sendAgent` (aditivo — `chat.send` intacto como fallback). Respuesta = shape actual + `sessionId` + `agent: true` por spread.
- **`ws-manager.ts`**: `broadcastChatEvent()` aditivo (el canal de precios no cambia).
- **Frontend `ChatPanel.tsx`**: usa `sendAgent` con `requestId`; muestra deltas en vivo y actividad de tools; si el agente falla, cae a `chat.send` y lo dice. Botón "nueva conversación" resetea `sessionId`.

## Reglas duras aplicables

- El agente es capa narrativa: no decide verbos; el guard de acciones del motor va en el system prompt (regla 2).
- Fail-closed en la tool de DB (regla 1) y en el fallback (error visible, no silencioso).
- Payload tRPC aditivo (regla 5). envNumber lazy (regla 3). TDD para sql-guard (regla 7).

## Verificación

`npm run test --workspace=apps/backend` (baseline main: verificar antes), typecheck monorepo, backend levanta, smoke e2e del procedure con una pregunta real.

## Dependencias

`@anthropic-ai/claude-agent-sdk` requiere zod ^4 (peer) — el repo tiene zod 3.25.76 que expone `zod/v4`; instalado con `--legacy-peer-deps`, verificar contra los types del SDK instalado cómo consume zod. `@anthropic-ai/sdk` actualizado 0.39 → latest (solo se usa `messages.create` en `shared/claude.ts`).

## Fuera de alcance (fases siguientes, acordadas)

- Pase analista post-pipeline (digest con acceso a DB).
- Job de crítica de prompts contra `signal_tracking`.
