import { useEffect, useState } from 'react';
import { getMarketStatus } from './marketStatus';

const MARKET_POLL_MS = 60_000; // 1/min mientras el mercado está abierto

/**
 * Intervalo de refetch para queries que dependen del precio (portfolio, watchlist,
 * ticker, "Hoy"): `MARKET_POLL_MS` con el mercado US abierto, `false` (poll apagado)
 * cuando está cerrado —finde, feriado NYSE, fuera de hora— para no pegarle a Yahoo
 * al pedo con data que no se mueve.
 *
 * Re-chequea el estado cada 30s: cuando el mercado abre, `open` cambia, el componente
 * re-renderiza y React Query reanuda el polling sin recargar la app.
 */
export function useMarketRefetchInterval(ms: number = MARKET_POLL_MS): number | false {
  const [open, setOpen] = useState(() => getMarketStatus().open);

  useEffect(() => {
    const id = setInterval(() => setOpen(getMarketStatus().open), 30_000);
    return () => clearInterval(id);
  }, []);

  return open ? ms : false;
}
