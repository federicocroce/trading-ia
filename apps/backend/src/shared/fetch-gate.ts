/**
 * Limitador de concurrencia con carril de prioridad. Acota cuántas operaciones
 * corren a la vez (p. ej. conexiones a Yahoo) y deja que las llamadas interactivas
 * (navegar a un símbolo) salten por delante del barrido masivo del ticker.
 *
 * `release` handa el slot directo al siguiente waiter (active no cambia) para no
 * abrir una ventana donde otro tome el slot en el medio.
 */
export interface FetchGate {
  acquire(opts?: { priority?: boolean }): Promise<void>;
  release(): void;
}

export function createFetchGate(max: number): FetchGate {
  let active = 0;
  const normalQueue: Array<() => void> = [];
  const priorityQueue: Array<() => void> = [];

  return {
    acquire(opts) {
      if (active < max) {
        active++;
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        if (opts?.priority) priorityQueue.push(resolve);
        else normalQueue.push(resolve);
      });
    },
    release() {
      // Prioridad primero; dentro de cada carril, FIFO.
      const next = priorityQueue.shift() ?? normalQueue.shift();
      if (next) {
        next();
      } else {
        active--;
      }
    },
  };
}
