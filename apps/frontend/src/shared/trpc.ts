import { createTRPCReact } from '@trpc/react-query';
import { httpBatchLink } from '@trpc/client';
import type { AppRouter } from '@trading/backend/trpc';

export const trpc = createTRPCReact<AppRouter>();

export function getTRPCClient() {
  const baseUrl = import.meta.env.VITE_API_URL || '';
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: `${baseUrl}/trpc`,
      }),
    ],
  });
}
