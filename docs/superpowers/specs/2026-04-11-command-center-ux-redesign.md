# Trading Dashboard — Command Center UX Redesign

## Goal

Transformar el layout actual (tabs planos + chat fijo) en un Command Center adaptivo donde:
1. **Reliability** es siempre visible — errores de API con retry inline, datos cacheados con badge de edad
2. **Flujo principal** Resumen → Oportunidades → Portfolio es prioritario y sin fricción
3. **Opportunity cards** muestran Score + Acción + Entry/Stop/Target al frente sin scroll
4. **Chat Claude** es colapsable (0 ↔ 384px), persistido en localStorage
5. **Todo sigue funcionando** — cero breaking changes en backend, routing, o lógica existente

## Layout Architecture

```
[InfraBar 28px — service health global + scan progress + data staleness]
[Header 1 línea — título + botón Analizar + N/F/A icons + portfolio summary]
[PriceTicker]
─────────────────────────────────────────────────────────────────────────
[Sidebar 160px | MainPanel flex-1          | ChatPanel 0↔384px]
[watchlist     | Tabs: Resumen/Opps/Port/  | toggle button]
[              | Noticias/Operaciones       |               ]
```

## Design Decisions

- **InfraBar**: reemplaza ServiceHealthBar (solo en Oportunidades hoy) → global, siempre visible, 28px
- **Scan progress**: se mueve al InfraBar cuando hay scan activo
- **Chat toggle**: botón en el borde izquierdo del ChatPanel, estado en localStorage
- **Opportunity card hero**: primera fila visible = Score + Action badge + Entry/Stop/Target
- **Staleness badges**: datos con >1h de antigüedad muestran badge amarillo "hace Xh" en header de cada vista
- **Retry inline**: cuando un servicio falla, botón "Reintentar" aparece en InfraBar junto al servicio afectado
- **Tab badges**: Oportunidades muestra count de BUY signals activos
- **Playwright**: instalar y escribir smoke tests para verificar que nada se rompe en cada tarea

## What NOT to change

- Backend: ningún cambio de rutas, procedures, o schemas
- tRPC queries/mutations: mismas queries, solo se mueven o agregan consumers
- Routing: `?symbol=X` navigation se mantiene igual
- shadcn components: se usan los existentes, no se reinstalan

## User Profile

Swing trader táctico, flujo principal: Resumen → Oportunidades → Portfolio. Usa el dashboard mañana (pre-market), intraday, y noche. Quiere anticiparse al mercado. Necesita saber exactamente qué APIs están caídas y qué tan viejos son los datos, sin que eso bloquee la visualización de caché.
