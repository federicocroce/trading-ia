import { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Card, CardContent } from '@/components/ui/card';
import { RotateCcw } from 'lucide-react';
import { trpc } from '@/shared/trpc';
import type { ChatMessage } from '@trading/shared';
import { useChatAgentStream, type ChatAgentEvent } from './useChatAgentStream';

const QUICK_ACTIONS = [
  'Resumen del portfolio hoy',
  'Cómo vienen resultando las señales del motor? Mirá signal_tracking',
  'Debería vender VIST ahora?',
  'Analiza GGAL',
  'Qué dice el último scan de oportunidades?',
];

export function ChatPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  // Turno en vuelo: texto que va llegando por WS + última actividad de tools
  const [streamText, setStreamText] = useState('');
  const [toolActivity, setToolActivity] = useState<string | null>(null);
  const activeRequestId = useRef<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const sendAgent = trpc.chat.sendAgent.useMutation();
  const sendClassic = trpc.chat.send.useMutation();
  const isPending = sendAgent.isPending || sendClassic.isPending;

  const onAgentEvent = useCallback((evt: ChatAgentEvent) => {
    if (evt.requestId !== activeRequestId.current) return;
    if (evt.kind === 'delta' && evt.text) {
      setToolActivity(null);
      setStreamText((prev) => prev + evt.text);
    } else if (evt.kind === 'tool' && evt.detail) {
      setToolActivity(evt.detail);
    }
    // 'done'/'error': el cierre real lo maneja la mutation (respuesta completa o throw)
  }, []);
  useChatAgentStream(onAgentEvent);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamText, toolActivity]);

  const handleSend = async (text?: string) => {
    const content = text ?? input.trim();
    if (!content || isPending) return;

    const userMsg: ChatMessage = { role: 'user', content, timestamp: Date.now() };
    const updated = [...messages, userMsg];
    setMessages(updated);
    setInput('');

    const requestId = crypto.randomUUID();
    activeRequestId.current = requestId;
    setStreamText('');
    setToolActivity(null);

    try {
      const response = await sendAgent.mutateAsync({ message: content, sessionId, requestId });
      if (response.sessionId) setSessionId(response.sessionId);
      setMessages((prev) => [...prev, response]);
    } catch {
      // Fallback honesto al chat clásico (API directa, sin tools) — se avisa en el mensaje
      try {
        const trpcMessages = updated.map((m) => ({ role: m.role, content: m.content }));
        const response = await sendClassic.mutateAsync({ messages: trpcMessages });
        setMessages((prev) => [...prev, {
          ...response,
          content: `⚠️ El agente no está disponible; respuesta del chat clásico (sin acceso a la base):\n\n${response.content}`,
        }]);
      } catch {
        setMessages((prev) => [...prev, {
          role: 'assistant',
          content: '⚠️ No pude responder: ni el agente ni el chat clásico están disponibles. Revisá que el backend esté corriendo y logueado en Claude Code.',
          timestamp: Date.now(),
        }]);
      }
    } finally {
      activeRequestId.current = null;
      setStreamText('');
      setToolActivity(null);
    }
  };

  const handleNewConversation = () => {
    if (isPending) return;
    setMessages([]);
    setSessionId(undefined);
  };

  return (
    <aside className="w-96 h-full bg-card border-l border-border flex flex-col">
      <div className="p-4 flex items-start justify-between">
        <div>
          <h2 className="text-sm font-semibold">Chat con Claude</h2>
          <p className="text-xs text-muted-foreground">Agente con acceso a tus datos reales</p>
        </div>
        {messages.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground"
            onClick={handleNewConversation}
            disabled={isPending}
            title="Nueva conversación"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      <Separator />

      <ScrollArea className="flex-1 min-h-0 p-4">
        <div className="space-y-3">
          {messages.length === 0 && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground mb-3">Acciones rapidas:</p>
              {QUICK_ACTIONS.map((action) => (
                <Button
                  key={action}
                  variant="secondary"
                  size="sm"
                  className="w-full justify-start text-left h-auto py-2 text-xs"
                  onClick={() => handleSend(action)}
                >
                  {action}
                </Button>
              ))}
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'user' ? (
                <div className="max-w-[85%] rounded-lg bg-primary text-primary-foreground px-3 py-2 text-sm">
                  {msg.content}
                </div>
              ) : (
                <Card className="max-w-[85%]" size="sm">
                  <CardContent className="text-sm whitespace-pre-wrap">{msg.content}</CardContent>
                </Card>
              )}
            </div>
          ))}

          {isPending && (
            <Card size="sm" className="max-w-[85%]">
              <CardContent className="text-sm">
                {streamText ? (
                  <span className="whitespace-pre-wrap">{streamText}</span>
                ) : (
                  <span className="text-muted-foreground">
                    {toolActivity ?? 'Analizando...'}
                  </span>
                )}
                {streamText && toolActivity && (
                  <div className="mt-1 text-xs text-muted-foreground">{toolActivity}</div>
                )}
              </CardContent>
            </Card>
          )}

          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      <Separator />
      <div className="p-4">
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Pregunta sobre tu portfolio..."
          />
          <Button
            onClick={() => handleSend()}
            disabled={!input.trim() || isPending}
          >
            Enviar
          </Button>
        </div>
      </div>
    </aside>
  );
}
