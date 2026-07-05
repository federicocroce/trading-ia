import { router, publicProcedure } from '../trpc.js';
import { chatInput, agentChatInput } from './chat.schema.js';
import { chat } from './chat.service.js';
import { chatAgentTurn } from './chat-agent.service.js';

export const chatRouter = router({
  send: publicProcedure
    .input(chatInput)
    .mutation(async ({ input }) => {
      return chat(input.messages);
    }),

  // Chat agéntico (Agent SDK). Aditivo: `send` queda intacto como fallback.
  sendAgent: publicProcedure
    .input(agentChatInput)
    .mutation(async ({ input }) => {
      const result = await chatAgentTurn(input);
      return {
        role: 'assistant' as const,
        content: result.content,
        timestamp: Date.now(),
        sessionId: result.sessionId,
        agent: true as const,
      };
    }),
});
