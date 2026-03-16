import { router, publicProcedure } from '../trpc.js';
import { chatInput } from './chat.schema.js';
import { chat } from './chat.service.js';

export const chatRouter = router({
  send: publicProcedure
    .input(chatInput)
    .mutation(async ({ input }) => {
      return chat(input.messages);
    }),
});
