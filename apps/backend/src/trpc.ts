import { initTRPC } from '@trpc/server';

export type TRPCContext = Record<string, unknown>;

export function createContext(): TRPCContext {
  return {};
}

const t = initTRPC.context<TRPCContext>().create();

export const router = t.router;
export const publicProcedure = t.procedure;
export const mergeRouters = t.mergeRouters;
