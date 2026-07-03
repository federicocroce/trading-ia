import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(3030),
  FRONTEND_URL: z.string().default('http://localhost:5050'),

  // AI providers (at least one should be available)
  LMSTUDIO_BASE_URL: z.string().default('http://127.0.0.1:1234/v1'),
  LMSTUDIO_MODEL: z.string().default('local-model'),
  ANTHROPIC_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  GROQ_API_KEY_1: z.string().optional(),
  GROQ_API_KEY_2: z.string().optional(),
  GROQ_API_KEY_3: z.string().optional(),
  GROQ_API_KEY_4: z.string().optional(),
  GOOGLE_AI_API_KEY_1: z.string().optional(),
  GOOGLE_AI_API_KEY_2: z.string().optional(),
  GOOGLE_AI_API_KEY_3: z.string().optional(),
  GOOGLE_AI_API_KEY_4: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),

  // Web search providers (stage webSearch se saltea sin ellas — ver runWebSearchStage)
  TAVILY_API_KEY: z.string().optional(),
  EXA_API_KEY: z.string().optional(),

  // Data sources
  FMP_API_KEY: z.string().optional(),
  FINNHUB_API_KEY: z.string().optional(),
  NEWSAPI_API_KEY: z.string().optional(),

  // Database
  DB_PATH: z.string().default('../../data/trading.db'),
});

export type Env = z.infer<typeof envSchema>;

let _env: Env | null = null;

export function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('[env] Invalid environment variables:');
    for (const issue of result.error.issues) {
      console.error(`  ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }
  _env = result.data;
  return result.data;
}

export function getEnv(): Env {
  if (!_env) throw new Error('Env not validated yet. Call validateEnv() first.');
  return _env;
}

const has = (v: string | undefined) => !!v && v.trim().length > 0;

/**
 * Fuente de verdad ÚNICA para "¿hay alguna key de búsqueda web?" (con trim: una key de
 * solo espacios cuenta como NO configurada). La usan tanto el log de visibilidad al boot
 * como el gate de runWebSearchStage en pipeline.service.ts — así nunca divergen.
 * Lee process.env directo (no getEnv()) para no depender del orden de validateEnv().
 */
export function hasWebSearchKeys(): boolean {
  return has(process.env.TAVILY_API_KEY) || has(process.env.EXA_API_KEY);
}

/**
 * Log de visibilidad de proveedores opcionales al arrancar. Nada de esto hace throw —
 * todos son opcionales — pero deja constancia clara de qué stages van a saltearse.
 * Evita el caso silencioso: semanas de "EXA_API_KEY not set" en logs de pipeline runs
 * sin que nadie note que ninguna key estaba configurada.
 */
export function logProviderVisibility(): void {
  const env = getEnv();

  const tavilyOk = has(env.TAVILY_API_KEY);
  const exaOk = has(env.EXA_API_KEY);
  console.log(`[Env] Tavily: ${tavilyOk ? 'OK' : 'NO configurada'}${tavilyOk ? '' : ' — stage webSearch se salteará'}`);
  console.log(`[Env] Exa: ${exaOk ? 'OK' : 'NO configurada'}${exaOk ? '' : ' — stage webSearch se salteará'}`);
  if (!hasWebSearchKeys()) {
    console.log('[Env] webSearch: sin ninguna key configurada — el stage se marcará como skipped (no failed).');
  }

  const groqOk = has(env.GROQ_API_KEY_1) || has(env.GROQ_API_KEY_2) || has(env.GROQ_API_KEY_3) || has(env.GROQ_API_KEY_4) || has(env.GROQ_API_KEY);
  console.log(`[Env] Groq: ${groqOk ? 'OK' : 'NO configurada'}${groqOk ? '' : ' — fallback a otros providers de IA'}`);

  const geminiOk = has(env.GOOGLE_AI_API_KEY_1) || has(env.GOOGLE_AI_API_KEY_2) || has(env.GOOGLE_AI_API_KEY_3) || has(env.GOOGLE_AI_API_KEY_4);
  console.log(`[Env] Gemini: ${geminiOk ? 'OK' : 'NO configurada'}${geminiOk ? '' : ' — fallback a otros providers de IA'}`);
}
