import { Button } from '@/components/ui/button';

interface Props {
  open: boolean;
  onRetry: () => void;
  onSkip: () => void;
  onCancel: () => void;
}

export function WebSearchBlockedModal({ open, onRetry, onSkip, onCancel }: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-sm rounded-lg border border-white/10 bg-zinc-900 p-5 shadow-2xl">
        <div className="mb-1 text-base font-semibold text-orange-400">⚠️ Web Search falló</div>
        <p className="mb-5 text-sm text-zinc-400">
          No se pudo obtener datos frescos del mercado. El análisis podría estar
          desactualizado sin esta información.
        </p>
        <div className="flex gap-2">
          <Button variant="default" size="sm" className="flex-1" onClick={onRetry}>
            Reintentar
          </Button>
          <Button variant="outline" size="sm" className="flex-1" onClick={onSkip}>
            Continuar sin datos
          </Button>
          <Button variant="ghost" size="sm" className="flex-1 text-zinc-500" onClick={onCancel}>
            Cancelar
          </Button>
        </div>
      </div>
    </div>
  );
}
