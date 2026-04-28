import { useRef, useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { trpc } from '@/shared/trpc';

export type AiMode = 'cloud' | 'local';

interface ModalProps {
  open: boolean;
  lmAvailable: boolean;
  lmChecking: boolean;
  onSelect: (mode: AiMode) => void;
}

function AiModeModalUI({ open, lmAvailable, lmChecking, onSelect }: ModalProps) {
  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        className="sm:max-w-sm"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">¿Dónde ejecutar el análisis?</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 mt-2">
          <button
            onClick={() => onSelect('cloud')}
            className="flex flex-col items-center gap-2 rounded-lg border border-border p-4 hover:bg-accent transition-colors text-left"
          >
            <span className="text-2xl">☁️</span>
            <span className="text-sm font-medium">Nube</span>
            <span className="text-[10px] text-muted-foreground">Gemini · DeepSeek · Groq</span>
          </button>
          <button
            onClick={() => onSelect('local')}
            disabled={!lmAvailable && !lmChecking}
            className="flex flex-col items-center gap-2 rounded-lg border border-border p-4 hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span className="text-2xl">🖥️</span>
            <span className="text-sm font-medium">Local</span>
            <span className="text-[10px] text-muted-foreground">LM Studio · Qwen 9B</span>
            {lmChecking ? (
              <span className="text-[9px] text-muted-foreground animate-pulse">Verificando...</span>
            ) : (
              <span className={`text-[9px] ${lmAvailable ? 'text-green-400' : 'text-red-400'}`}>
                {lmAvailable ? '● Online' : '● Offline'}
              </span>
            )}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function useAiModeModal() {
  const [open, setOpen] = useState(false);
  const resolveRef = useRef<((mode: AiMode) => void) | null>(null);

  const lmStatus = trpc.intelligence.lmStudioStatus.useQuery(undefined, {
    enabled: open,
    staleTime: 0,
    retry: false,
  });

  const selectMode = useCallback((): Promise<AiMode> => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setOpen(true);
    });
  }, []);

  const handleSelect = useCallback((mode: AiMode) => {
    setOpen(false);
    resolveRef.current?.(mode);
    resolveRef.current = null;
  }, []);

  const modal = (
    <AiModeModalUI
      open={open}
      lmAvailable={lmStatus.data?.available ?? false}
      lmChecking={lmStatus.isLoading && open}
      onSelect={handleSelect}
    />
  );

  return { selectMode, modal };
}
