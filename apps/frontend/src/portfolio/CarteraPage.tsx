import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AllocationPlanPanel } from './AllocationPlanPanel';
import { PortfolioDiagnosticPanel } from './PortfolioDiagnosticPanel';
import { ConcentrationPanel } from './ConcentrationPanel';
import { PortfolioTable } from './PortfolioTable';
import { TransactionHistory } from './TransactionHistory';

/**
 * Cartera: TODO lo que es tuyo, en un solo lugar.
 *
 * Fusionado el 2026-07-28. Antes eran dos tabs de primer nivel —"Portfolio" (posiciones y
 * operaciones) y "Cartera" (capas y aportes)— que respondían la misma pregunta desde dos
 * lados: qué tengo y cómo debería estar armado. Tenerlas separadas obligaba a saltar entre
 * tabs para contestar algo tan simple como "¿cuánto tengo y dónde va el próximo aporte?".
 *
 * Orden por urgencia de decisión: riesgo del conjunto → dónde va el aporte → qué tengo →
 * qué operé. Lo primero es lo que más plata mueve (la cartera real son 1.8 apuestas, no 8).
 */
export function CarteraPage() {
  const [sub, setSub] = useState('riesgo');

  return (
    <div className="p-4 space-y-3">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground">💼 Cartera</h2>
        <p className="text-[11px] text-muted-foreground mt-1">
          Todo lo que es tuyo: cuánto riesgo tenés de verdad, dónde va el próximo aporte, qué posiciones y qué operaste.
        </p>
      </div>

      <Tabs value={sub} onValueChange={setSub}>
        <TabsList variant="line" className="w-full justify-start">
          <TabsTrigger value="riesgo">Riesgo del conjunto</TabsTrigger>
          <TabsTrigger value="aportes">Dónde va el aporte</TabsTrigger>
          <TabsTrigger value="posiciones">Posiciones</TabsTrigger>
          <TabsTrigger value="operaciones">Operaciones</TabsTrigger>
        </TabsList>

        <TabsContent value="riesgo" className="space-y-4">
          <ConcentrationPanel />
          <PortfolioDiagnosticPanel />
        </TabsContent>
        <TabsContent value="aportes"><AllocationPlanPanel /></TabsContent>
        <TabsContent value="posiciones"><PortfolioTable /></TabsContent>
        <TabsContent value="operaciones"><TransactionHistory /></TabsContent>
      </Tabs>
    </div>
  );
}
