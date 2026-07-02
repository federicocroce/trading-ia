/**
 * Envuelve una promesa con un límite de tiempo. Los SDKs de Groq/Gemini/OpenRouter
 * no traen timeout configurado y el pipeline corre stages en serie: una llamada
 * colgada bloquea el run entero (caso real: un news-radar tardó 91 minutos).
 * Al rechazar, el ai-router pasa al siguiente proveedor de la cadena.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer!)) as Promise<T>;
}
