import { z } from 'zod';
import { router, publicProcedure } from '../trpc.js';
import {
  getActiveAnticipatoryAlerts,
  getRecentAnticipatoryAlerts,
  markAnticipatoryAlertsSeen,
  countUnseenAnticipatoryAlerts,
} from '../db/repository.js';

export const alertsRouter = router({
  /** Activas + historial reciente, para la sección fijada y el panel. */
  list: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(200).default(50) }).optional())
    .query(({ input }) => ({
      active: getActiveAnticipatoryAlerts(),
      recent: getRecentAnticipatoryAlerts(input?.limit ?? 50),
    })),

  /** Cuenta de no-vistas activas — alimenta el badge y la notificación browser. */
  unseenCount: publicProcedure.query(() => ({ count: countUnseenAnticipatoryAlerts() })),

  /** Marca vistas (todas, o ids puntuales). Se llama al abrir el panel. */
  markSeen: publicProcedure
    .input(z.object({ ids: z.array(z.string()).optional() }).optional())
    .mutation(({ input }) => {
      markAnticipatoryAlertsSeen(input?.ids);
      return { ok: true };
    }),
});
