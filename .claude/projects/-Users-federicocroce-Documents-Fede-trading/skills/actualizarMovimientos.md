---
name: actualizarMovimientos
description: Importa transacciones nuevas desde mov.js a la base de datos del trading dashboard
user_invocable: true
---

# Actualizar Movimientos desde mov.js

Ejecuta el script de importación que:
1. Lee `mov.js` en la raíz del proyecto (formato Buenbit)
2. Parsea todas las transacciones (BUY, SELL, DIVIDEND)
3. Filtra las que están COMPLETED y tienen quantity+price
4. Inserta solo las nuevas (compara por uuid/externalId para evitar duplicados)
5. Recalcula automáticamente las posiciones del portfolio

## Instrucciones

Ejecuta este comando:

```bash
npx tsx apps/backend/src/db/import-movements.ts
```

Muestra al usuario:
- Cuántas transacciones se encontraron en mov.js
- Cuáles se saltaron (PROCESSING, sin datos, duplicadas)
- Cuáles se insertaron nuevas
- Si se recalcularon las posiciones

Si hay transacciones con `status: "PROCESSING"`, informar al usuario que esas operaciones aún no se completaron en Buenbit y que las actualice en mov.js cuando se completen.
