import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Card, CardContent } from '@/components/ui/card';
import { trpc } from '@/shared/trpc';
import type { ChatMessage } from '@trading/shared';

const QUICK_ACTIONS = [
  'Resumen del portfolio hoy',
  'Que impacto tiene la guerra en mis acciones?',
  'Deberia vender VIST ahora?',
  'Analiza GGAL',
  'Como esta el petroleo?',
];

export function ChatPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const sendMessage = trpc.chat.send.useMutation();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (text?: string) => {
    const content = text ?? input.trim();
    if (!content) return;

    const userMsg: ChatMessage = { role: 'user', content, timestamp: Date.now() };
    const updated = [...messages, userMsg];
    setMessages(updated);
    setInput('');

    const trpcMessages = updated.map((m) => ({ role: m.role, content: m.content }));
    const response = await sendMessage.mutateAsync({ messages: trpcMessages });
    setMessages((prev) => [...prev, response]);
  };

  return (
    <aside className="w-96 bg-card border-l border-border flex flex-col">
      <div className="p-4">
        <h2 className="text-sm font-semibold">Chat con Claude</h2>
        <p className="text-xs text-muted-foreground">Analista financiero IA</p>
      </div>
      <Separator />

      <ScrollArea className="flex-1 p-4">
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
                  <CardContent className="text-sm">{msg.content}</CardContent>
                </Card>
              )}
            </div>
          ))}

          {sendMessage.isPending && (
            <Card size="sm" className="max-w-[85%]">
              <CardContent className="text-sm text-muted-foreground">
                Analizando...
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
            disabled={!input.trim() || sendMessage.isPending}
          >
            Enviar
          </Button>
        </div>
      </div>
    </aside>
  );
}
