# Comando /radar-ciclos — detector de gestación de grandes ciclos bursátiles

> **Autocontenido a propósito**: este documento tiene TODO lo necesario para que cualquier LLM con acceso a búsqueda web lo ejecute — framework, métricas, umbrales, fuentes, proceso, formato de salida y reglas anti-humo. No requiere contexto previo del repo.

## 1. Objetivo (leer dos veces)

Responder con evidencia fechada y citada: **¿en qué país y sector se está GESTANDO el próximo gran ciclo de ganancia bursátil?** — donde "gestando" significa que las señales estructurales ya son medibles pero el precio y el consenso todavía no lo reflejan del todo.

Lo que este comando NO es:
- NO predice. Rankea candidatos por fuerza de señales verificables y define qué confirmaría o refutaría cada tesis. La honestidad intelectual vale más que la convicción: si las señales son ambiguas, el informe lo dice.
- NO da timing de entrada. El resultado alimenta una watchlist/universo; el timing lo deciden los filtros técnicos de siempre (setup, R/R, stop).
- NO recomienda humo: todo instrumento propuesto debe pasar la barrera de calidad (sección 6).

El lector es un swing trader argentino individual que opera acciones US, CEDEARs y ETFs. Ni opciones ni futuros ni day-trading.

## 2. El framework — dónde se gestan los grandes ciclos

Todos los grandes ciclos (Japón 80s, Nasdaq 90s, commodities/BRICs 2000s, FAANG 2010s, AI 2023+) compartieron el mismo patrón de gestación: **capital que huyó + años de sub-inversión + un driver nuevo de demanda + fundamentals dándose vuelta ANTES que el precio**. Evaluar cada candidato contra estos 4 ejes, con las métricas concretas de cada uno:

### Eje 1 — Ciclo de capital (peso alto)
Sectores con 5-10 años de capex deprimido donde aparece demanda estructural nueva. La oferta no puede responder rápido → márgenes explotan por años.
Métricas a buscar:
- Capex agregado del sector vs su promedio de 10 años (en % de ventas o USD). Señal: capex en mínimos de década + demanda nueva creciendo >5%/año.
- Años de lead time para agregar capacidad (minas: 7-15 años; plantas nucleares: 8-12; grid: 3-7). Más lead time = ciclo más largo.
- Utilización de capacidad instalada / inventarios en mínimos históricos.
- Déficit oferta-demanda proyectado por fuentes primarias (agencias de energía, estudios de la industria — no bancos de inversión vendiendo el trade).

### Eje 2 — Valuación + flujos (peso alto)
Países/sectores baratos contra su propia historia que EMPIEZAN a recibir inflows tras años de salidas. El primer 10% del flujo es la señal; el último 90% es la burbuja.
Métricas a buscar:
- CAPE / P/E forward / P/B del país o sector vs su mediana de 15-20 años (percentil <30 = barato; >80 = caro).
- Flujos de fondos hacia ETFs del país/sector (creaciones netas, AUM) — dirección y CAMBIO de dirección, no nivel.
- Peso del país/sector en índices globales vs su peso económico (sub-representación = espacio para re-rating).
- Descuento/prima de las acciones locales vs pares globales del mismo negocio.

### Eje 3 — Reformas + estabilización macro (peso medio; aplica a tesis-país)
Métricas a buscar:
- Inflación interanual cayendo por ≥12 meses consecutivos y expectativas convergiendo.
- Moneda: brecha cambiaria cerrándose / régimen unificándose / reservas del central subiendo.
- Crédito doméstico al sector privado como % del PBI creciendo desde base baja (<40% del PBI con crecimiento >10%/año = despegue típico).
- Reformas con hechos, no anuncios: leyes aprobadas, privatizaciones ejecutadas, acuerdos con organismos cumpliéndose.
- Riesgo país (spread soberano) comprimiendo de forma sostenida.

### Eje 4 — Smart money (peso medio; confirmatorio, nunca suficiente solo)
Métricas a buscar:
- Compras de insiders (directivos comprando SUS propias acciones con plata propia; ratio compras/ventas del sector).
- M&A entrante: adquirentes estratégicos o private equity comprando activos del sector/país (pagan por valor de largo plazo, no momentum).
- Inversión extranjera directa (IED) anunciada Y ejecutada en el sector.
- Posicionamiento institucional: si los surveys de gestores muestran al activo como "más odiado" u "olvidado", mejor (contrarian); si ya es el "most crowded trade", es señal de VENTA de la tesis, no de compra.

### Anti-hype (eliminatorio)
Un candidato con señales fuertes pero que YA es consenso masivo (tapa de diarios, most crowded en surveys, valuación en percentil >80, retail entrando en masa) se degrada a "ciclo maduro — no es gestación". Decirlo explícitamente es parte del valor del informe.

## 3. Candidatos base a evaluar (no limitarse a ellos)

Evaluar SIEMPRE estos (son las tesis vivas al momento de escribir el comando) y agregar cualquier candidato nuevo que surja de la búsqueda:
1. EE.UU. — electricidad/infraestructura para AI (utilities, nuclear, gas, grid).
2. Argentina — energía (Vaca Muerta: shale oil/gas, midstream) y bancos.
3. Cobre/litio — Chile, Perú, Argentina (electrificación + sub-inversión minera).
4. India — manufactura e infraestructura.
5. Japón — reforma corporativa (recompras, gobernanza, salida de deflación).
6. Europa — defensa (rearme estructural).
7. **Comodín obligatorio**: buscar activamente al menos 1 candidato NO listado acá (ej. "most hated sector/country 2026", "sectores con capex en mínimos de década", "países saliendo de crisis con reformas"). Los mejores ciclos nacen donde nadie mira.

## 4. Proceso de ejecución

1. **Descomponer** la pregunta en búsquedas por eje × candidato. Mínimo 5 ángulos de búsqueda distintos (capex/oferta, flujos/valuación, macro/reformas, smart money, contrarian/comodín).
2. **Buscar** con queries en inglés (mejores fuentes) y español para lo argentino. Priorizar: agencias oficiales (EIA, IEA, FMI, bancos centrales), datos de la industria (WoodMac, CRU, informes de cámaras), prensa financiera primaria (FT, Bloomberg, Reuters, WSJ), filings (13F, Form 4 para insiders). Evitar: newsletters de venta de trades, seeking-alpha de retail, cualquier fuente que gane comisión con la tesis.
3. **Verificar**: toda cifra clave (capex, flujos, valuaciones, déficits) debe tener fuente + fecha. Si dos fuentes contradicen, reportar ambas. Distinguir SIEMPRE dato duro ("los inflows a ETFs de India fueron $X en Q2 2026, fuente Y") de opinión de analista ("Goldman espera..."). Lo que no se pudo verificar se marca "sin verificar" o se elimina.
4. **Scorear** cada candidato: cada eje 0-10 con justificación de una línea + cita. Score total = promedio ponderado (ejes 1 y 2 pesan doble). Aplicar el filtro anti-hype DESPUÉS del score: un candidato caro/consensuado se reporta pero degradado.
5. **Sintetizar** en el formato de salida (sección 5). Guardar el informe en `docs/IA/research/YYYY-MM-DD-radar-ciclos.md` (crear la carpeta si no existe).
6. **Comparar con el informe anterior** si existe uno en `docs/IA/research/`: ¿qué señal se fortaleció/debilitó desde la última corrida? El DELTA es más valioso que la foto.

## 5. Formato de salida obligatorio

```markdown
# Radar de ciclos — YYYY-MM-DD

## Veredicto en 3 líneas
[El candidato #1, por qué, y la advertencia principal. Si ningún candidato tiene señales claras de gestación, DECIRLO: "hoy no hay gestación clara; lo menos malo es X".]

## Ranking
| # | País/Sector | Capital | Val+Flujos | Macro | Smart $ | Total | ¿Hype? |
[una fila por candidato, scores 0-10, columna hype: gestación / madurando / consenso-caro]

## Detalle por candidato (en orden de ranking)
### N. [País — Sector]
- **Tesis en una frase.**
- **Señales a favor** (cada una con cifra + fuente + fecha).
- **Señales en contra / riesgos** (ídem).
- **Qué la CONFIRMARÍA en 6-12 meses** (2-3 hechos observables y medibles).
- **Qué la REFUTARÍA** (2-3 hechos observables — si pasan, la tesis muere, sin vueltas).
- **Instrumentos accesibles**: tickers US/ETFs/CEDEARs líquidos, marketCap ≥$500M, precio ≥$5. Indicar cuáles tienen CEDEAR. Máximo 5 por tesis, los más representativos y líquidos.

## Anti-hype: lo que YA está caro/consensuado
[Lista explícita con evidencia de por qué llegaste tarde.]

## Lo que no pudimos verificar
[Cifras o claims que quedaron sin fuente sólida — honestidad sobre los huecos.]

## Delta vs informe anterior (si existe)
[Qué cambió de señal desde la última corrida.]

## Fuentes
[Lista numerada completa: título, medio, fecha, URL.]
```

## 6. Reglas duras (violarlas invalida el informe)

1. **Toda cifra con fuente y fecha.** Sin excepción. Cifra sin fuente = se elimina o va a "no pudimos verificar".
2. **Dato duro ≠ opinión.** "Los flujos fueron X" (verificable) vs "los analistas esperan Y" (opinión). Etiquetar siempre.
3. **Barrera de calidad de instrumentos**: marketCap ≥$500M y precio ≥$5. Nada de micro-caps, OTC ni tickers ilíquidos. Ante la duda sobre un dato del instrumento, NO se incluye (fail-closed).
4. **"No sé" es una respuesta válida.** Si la evidencia es ambigua, el informe lo dice. Jamás inventar convicción para que el informe "quede mejor".
5. **Cada tesis lleva su refutación.** Una tesis sin condiciones de refutación observables no es una tesis, es una expresión de deseo — no entra al informe.
6. **El comodín (sección 3, punto 7) es obligatorio.** Si no se buscó al menos un candidato fuera de la lista, el informe está incompleto.
7. **Anti-hype explícito**: el informe DEBE tener la sección de lo que ya está caro. Un radar que solo dice qué comprar y nunca qué evitar es marketing, no research.

## 7. Después del informe (opcional, si se corre dentro del repo de trading)

- Los tickers de las 1-2 tesis top pueden cargarse al universo de la app (tabla `discovered_symbols` vía `registerNovelTickers(tickers, 'llm')` o manualmente a la watchlist). Los filtros de siempre (quality bar, anti-hype del scan, setup+RR) deciden CUÁNDO hay entrada operable — este informe solo decide QUÉ mirar.
- Cadencia sugerida: mensual o ante evento macro mayor. Los ciclos se gestan en trimestres, no en días — correrlo seguido solo agrega ruido.
- El informe NO alimenta el scoring ni los verdicts de la app. Es capa de contexto/universo, nunca de señal (evidencia del sistema: las capas narrativas no predicen — sentiment r=+0.03, causal chains 52%).
