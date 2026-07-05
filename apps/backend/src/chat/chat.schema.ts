import { z } from 'zod';

export const chatInput = z.object({
  messages: z.array(
    z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string(),
    })
  ),
});

// Turno del chat agéntico: con `resume` alcanza el último mensaje (la memoria vive en la sesión)
export const agentChatInput = z.object({
  message: z.string().min(1),
  sessionId: z.string().optional(),
  requestId: z.string().min(1),
});
