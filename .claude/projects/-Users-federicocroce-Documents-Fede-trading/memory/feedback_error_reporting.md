---
name: Error reporting to frontend
description: Siempre reportar errores de APIs y servicios al frontend, nunca silenciarlos
type: feedback
---

Los errores de APIs externas (Yahoo, Finnhub, etc.) DEBEN reportarse al usuario en el frontend, no solo loguearse en console.warn.

**Why:** Yahoo Finance fundamentals estuvo fallando silenciosamente (401 Unauthorized) y todos los datos fundamentales venian como null. Las 53 acciones daban "Observar" porque no habia datos para evaluar. El usuario no tenia forma de saber que algo andaba mal.

**How to apply:** Cada servicio debe usar `reportOk()`/`reportError()` del service-health registry. El frontend muestra el estado via `ServiceHealthBar`. Cuando se agrega una nueva fuente de datos o API, instrumentarla con service-health desde el inicio.
