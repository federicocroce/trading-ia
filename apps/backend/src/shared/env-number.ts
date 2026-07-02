/**
 * Lee un env var numérico en el momento de uso, no al cargar el módulo: con ESM los imports
 * se hoistean antes que el `dotenv.config()` de index.ts corra, así que un `const X = envNumber(...)`
 * a nivel de módulo captura el valor ANTES de que la env var exista y queda inerte para siempre.
 * También filtra `Number('')` (que da 0, no NaN) y otros valores no positivos.
 */
export function envNumber(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
