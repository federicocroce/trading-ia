import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(3001),
  FRONTEND_URL: z.string().default('http://localhost:5173'),

  // AI providers (at least one should be available)
  LMSTUDIO_BASE_URL: z.string().default('http://127.0.0.1:1234/v1'),
  LMSTUDIO_MODEL: z.string().default('local-model'),
  ANTHROPIC_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),

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
