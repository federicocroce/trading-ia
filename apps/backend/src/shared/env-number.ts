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

/** Igual que envNumber pero para strings: lectura lazy y vacío tratado como ausente. */
export function envString(name: string, fallback: string): string {
  const v = process.env[name]?.trim();
  return v ? v : fallback;
}
