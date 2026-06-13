import { router, publicProcedure } from '../trpc.js';
import { z } from 'zod';
import { runBacktest } from './backtest.service.js';
import { getBacktestRun, listBacktestRuns } from './backtest.repository.js';
import { getStageQuantContext } from '../intelligence/pipeline.service.js';
import { runMaTrendUniverse, runMaTrendDetail, resolveBacktestUniverse } from './ma-trend.service.js';
import { runAlertBacktestUniverse, runAlertBacktestForSymbol } from './alert-backtest.service.js';
import { runSignalEdgeStudy } from './signal-edge.service.js';
import { runEventStudy, getEventPlaybook } from './event-study.service.js';
import { runExitRuleBacktest } from './exit-rule-backtest.service.js';

const alertBacktestOptsShape = {
  years: z.number().int().min(2).max(15).default(5),
  horizonDays: z.number().int().min(3).max(60).default(14),
  atrStopMult: z.number().min(0.5).max(5).default(1.5),
  atrTargetMult: z.number().min(0.5).max(10).default(2.5),
};

const maTrendStrategySchema = z.object({
  entryMas: z.array(z.number().int().positive()).min(1).max(4),
  exitMa: z.number().int().positive(),
  commissionPct: z.number().min(0).max(5).optional(),
  slippagePct: z.number().min(0).max(5).optional(),
  stopLossPct: z.number().min(0).max(100).optional(),
  takeProfitPct: z.number().min(0).max(1000).optional(),
});

const strategyConfigSchema = z.object({
  name: z.string(),
  shortTermWeights: z.object({
    sentiment: z.number().min(0).max(1),
    technical: z.number().min(0).max(1),
    fundamental: z.number().min(0).max(1),
    evidence: z.number().min(0).max(1).default(0),
  }).optional(),
  mediumTermWeights: z.object({
    sentiment: z.number().min(0).max(1),
    technical: z.number().min(0).max(1),
    fundamental: z.number().min(0).max(1),
    evidence: z.number().min(0).max(1).default(0),
  }).optional(),
  buyThreshold: z.number().min(0).max(100),
  sellThreshold: z.number().min(0).max(100),
  stopLossPercent: z.number().min(0).max(100),
  takeProfitPercent: z.number().min(0).max(100),
});

export const quantRouter = router({
  triggerBacktest: publicProcedure
    .input(z.object({
      symbol: z.string().min(1),
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      strategy: strategyConfigSchema,
    }))
    .mutation(async ({ input }) => {
      const runId = await runBacktest(input);
      return { runId };
    }),

  getBacktestRun: publicProcedure
    .input(z.object({ runId: z.number() }))
    .query(({ input }) => getBacktestRun(input.runId)),

  listBacktestRuns: publicProcedure
    .input(z.object({ limit: z.number().optional().default(20) }))
    .query(({ input }) => listBacktestRuns(input.limit)),

  getQuantContext: publicProcedure
    .query(() => getStageQuantContext()),

  /** Universo fijo (portfolio + watchlist + benchmarks) que se va a backtestear. */
  backtestUniverse: publicProcedure.query(() => resolveBacktestUniverse()),

  /**
   * Backtest de REGLA PURA de medias sobre todo el universo. Default = la regla del video:
   * comprar sobre SMA300 y SMA1000, vender bajo SMA300. Devuelve estrategia vs buy&hold.
   */
  runMaTrendUniverse: publicProcedure
    .input(z.object({
      strategy: maTrendStrategySchema.default({ entryMas: [300, 1000], exitMa: 300, commissionPct: 0.1, slippagePct: 0.05 }),
      years: z.number().int().min(2).max(20).default(10),
    }))
    .mutation(({ input }) => runMaTrendUniverse(input.strategy, { years: input.years })),

  /** Detalle de un símbolo (trades + curva de equity) para la regla de medias. */
  runMaTrendSymbol: publicProcedure
    .input(z.object({
      symbol: z.string().min(1),
      strategy: maTrendStrategySchema.default({ entryMas: [300, 1000], exitMa: 300, commissionPct: 0.1, slippagePct: 0.05 }),
      years: z.number().int().min(2).max(20).default(10),
    }))
    .mutation(({ input }) => runMaTrendDetail(input.symbol, input.strategy, input.years)),

  /**
   * Backtest de las REGLAS DE ALERTA ANTICIPATORIA del sistema sobre todo el universo.
   * Mide si disparar la alerta (≥2 confluencias bullish) predice mejor que una barra
   * cualquiera (base-rate), con el mismo manejo de riesgo. El edge es lo que importa.
   */
  runAlertBacktestUniverse: publicProcedure
    .input(z.object({ ...alertBacktestOptsShape }).optional())
    .mutation(({ input }) => runAlertBacktestUniverse(input ?? {})),

  /** Backtest de la regla de alerta para un solo símbolo. */
  runAlertBacktestSymbol: publicProcedure
    .input(z.object({ symbol: z.string().min(1), ...alertBacktestOptsShape }))
    .mutation(({ input }) => {
      const { symbol, ...opts } = input;
      return runAlertBacktestForSymbol(symbol, 'watchlist', opts);
    }),

  /**
   * Estudio de aislamiento de señales: mide el edge de cada ingrediente del motor por
   * separado (RSI oversold, sobre SMA200, golden cross, MACD…) vs base-rate. La base de
   * "robusto y confiable": quedarse solo con lo que mide edge real.
   */
  signalEdgeStudy: publicProcedure
    .input(z.object({
      years: z.number().int().min(2).max(15).default(5),
      horizonDays: z.number().int().min(3).max(60).default(14),
    }).optional())
    .mutation(({ input }) => runSignalEdgeStudy(input ?? {})),

  /**
   * Event-study: aprende empíricamente de la historia de PRECIOS qué le hace cada tipo de
   * evento (petróleo, tasas, risk-off, oro) a cada sector. Recalcula y persiste el playbook.
   */
  runEventStudy: publicProcedure.mutation(() => runEventStudy()),

  /** Lee el playbook empírico guardado (opcionalmente filtrado por tipo de evento). */
  eventPlaybook: publicProcedure
    .input(z.object({ eventType: z.string().optional() }).optional())
    .query(({ input }) => getEventPlaybook(input?.eventType)),

  /**
   * Head-to-head: valida con datos cuál de las dos reglas opuestas conviene cuando el motor y
   * "Hoy" se contradicen — vender en la divergencia (motor) vs dejar correr con trailing (Hoy).
   */
  exitRuleBacktest: publicProcedure
    .input(z.object({ years: z.number().int().min(3).max(15).default(7) }).optional())
    .mutation(({ input }) => runExitRuleBacktest(input ?? {})),
});
