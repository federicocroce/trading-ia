import { router, publicProcedure } from '../trpc.js';
import { getAllTheses } from '../db/repository.js';
import { generateWeeklyTheses } from './thesis-generator.service.js';
import { evaluateActiveTheses } from './thesis-runner.service.js';

export const thesesRouter = router({
  // Todas las tesis, más nueva primero — la UI filtra/agrupa por estado del lado del cliente.
  list: publicProcedure.query(() => getAllTheses()),

  // Corrida manual del generador semanal (LLM). Idempotente por createdDate: si ya hay tesis de
  // hoy, generateWeeklyTheses devuelve generated:0 con la razón — no duplica.
  generate: publicProcedure.mutation(() => generateWeeklyTheses()),

  // Corrida manual del evaluador diario: revisa tesis activas/gatilladas contra precio vivo.
  evaluate: publicProcedure.mutation(() => evaluateActiveTheses()),
});
