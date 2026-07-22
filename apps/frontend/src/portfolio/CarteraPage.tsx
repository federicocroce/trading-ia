import { TabInfo, InfoSection } from '@/shared/TabInfo';
import { AllocationPlanPanel } from './AllocationPlanPanel';
import { PortfolioDiagnosticPanel } from './PortfolioDiagnosticPanel';

/**
 * Tab "Cartera": estructura por capas y plan de aportes, separada a propósito del
 * Portfolio (posiciones/operaciones). Portfolio = qué tenés hoy; Cartera = cómo
 * debería estar armado el conjunto y a dónde va cada dólar nuevo.
 */
export function CarteraPage() {
  return (
    <>
      <TabInfo>
        <InfoSection title="Qué muestra">
          La estructura de tu cartera como conjunto: el diagnóstico de correlación de riesgo (concentración por
          factor, cobertura faltante, qué candidatos apilan vs diversifican) y la estructura por capas (núcleo
          indexado / cobertura / riesgo) contra bandas objetivo, con el plan de asignación de aportes nuevos:
          a qué capa va cada dólar fresco para acercarte a los targets sin vender nada.
        </InfoSection>
        <InfoSection title="Cómo usarlo">
          Ingresá los USD que pensás aportar y calculá: el sistema reparte entre las capas subponderadas
          (instrumentos amplios: SPY/GLD — jamás picks individuales; el riesgo se llena con setups del scan).
          Es advisory puro: el sistema nunca ejecuta órdenes. Si falta el precio vivo de una posición, el plan
          no se genera (fail-closed).
        </InfoSection>
      </TabInfo>
      <div className="p-4 space-y-4">
        <PortfolioDiagnosticPanel />
        <AllocationPlanPanel />
      </div>
    </>
  );
}
