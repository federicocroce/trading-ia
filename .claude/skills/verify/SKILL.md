---
name: verify
description: Receta de verificación runtime de este repo — cómo levantar, pegarle a tRPC por curl, escuchar el WS y manejar la UI
---

# Verificación runtime — trading dashboard

## Handle

- Backend: suele estar YA corriendo en :3001 (`npm run dev` del dueño, `tsx watch` → hot-reload automático al editar). Chequear `curl -s localhost:3001/health` antes de levantar nada. Si hay que levantarlo: `npm run dev:backend`.
- Frontend: Vite en :5050 (`npm run dev:frontend`), proxy de `/trpc` y `/ws` al backend. HMR también automático.
- OJO: guardar un archivo del backend reinicia el proceso → mata requests en vuelo. No editar código mientras hay un turno del chat agéntico corriendo.

## Superficies

- **tRPC por curl** (sin transformer, JSON plano):
  `curl -s -X POST "localhost:3001/trpc/<router>.<proc>" -H "Content-Type: application/json" -d '<input JSON directo>'`
  Queries: GET con `?input=<url-encoded JSON>`.
- **WebSocket** (`/ws/prices` — precios + eventos `chat_agent`): listener node con el `ws` del repo:
  `node -e "const WebSocket=require('<repo>/node_modules/ws'); ..."` conectando a `ws://localhost:3001/ws/prices` (directo) o `:5050` (vía proxy).
- **UI**: Playwright MCP contra `http://localhost:5050`. Los snapshots de accesibilidad alcanzan para leer el estado del chat/tabs; screenshots solo para evidencia visual. Borrar `.playwright-mcp/` y capturas del root al terminar.

## Flujos que valen la pena

- Chat agéntico: POST `chat.sendAgent` `{message, requestId, sessionId?}` — un turno con pregunta que exija DB ("cuántas señales hay en signal_tracking?") prueba agente+tool+guard. Los eventos de streaming salen por el WS con ese `requestId`. Turnos pesados (VIST) tardan 3-5 min de pared: esperar de a 90-120s, no asumir cuelgue.
- Probes útiles: input vacío (zod 400), `sessionId` basura (500 honesto + evento `kind:'error'` por WS), pedirle al agente que escriba en la DB (debe negarse / guard rechaza).

## Gotchas

- El pipeline no corre fines de semana; datos "de hoy" pueden ser del último día hábil.
- `data/trading.db` es la DB REAL del dueño: solo lecturas en verificación.
