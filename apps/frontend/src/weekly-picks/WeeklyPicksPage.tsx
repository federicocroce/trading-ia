import { trpc } from '@/shared/trpc';
import { Button } from '@/components/ui/button';
import { PickCard } from './PickCard';

export function WeeklyPicksPage() {
  const { data: picks, isLoading, refetch } = trpc.macro.weeklyPicks.useQuery();
  const generateMutation = trpc.macro.generatePicks.useMutation({
    onSuccess: () => refetch(),
  });

  const today = new Date().toLocaleDateString('es-AR', {
    weekday: 'long', day: 'numeric', month: 'long',
  });

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Picks de la Semana</h1>
          <p className="text-sm text-muted-foreground">{today} · Alta convicción solamente</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => generateMutation.mutate()}
          disabled={generateMutation.isPending}
        >
          {generateMutation.isPending ? 'Generando...' : 'Generar ahora'}
        </Button>
      </div>

      {isLoading && (
        <div className="text-center text-muted-foreground py-12">Cargando picks...</div>
      )}

      {!isLoading && (!picks || picks.length === 0) && (
        <div className="text-center py-12 space-y-2">
          <p className="text-muted-foreground">Sin picks de alta convicción esta semana.</p>
          <p className="text-sm text-muted-foreground">
            Puede indicar régimen RIESGO o falta de señales con suficiente evidencia.
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending}
          >
            Intentar generar
          </Button>
        </div>
      )}

      {picks && picks.length > 0 && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {picks.length} setup{picks.length !== 1 ? 's' : ''} · {picks.filter((p) => p.tier === 'HIGH').length} alta convicción
          </p>
          {picks.map((pick) => (
            <PickCard key={pick.symbol} pick={pick} />
          ))}
        </div>
      )}
    </div>
  );
}
