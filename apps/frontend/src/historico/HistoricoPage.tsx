import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TabInfo, InfoSection } from '@/shared/TabInfo';
import { AccuracyDashboard } from '@/intelligence/AccuracyDashboard';
import { BacktestPage } from '@/backtest/BacktestPage';

type HistoricoSubTab = 'accuracy' | 'backtest';

export function HistoricoPage() {
  const [subTab, setSubTab] = useState<HistoricoSubTab>('accuracy');

  return (
    <>
      <TabInfo>
        <InfoSection title="Qué muestra">
          Vista de auditoría y validación del sistema. Reúne las métricas históricas que permiten medir si las señales del pipeline efectivamente acertaron, y la herramienta de backtest para probar estrategias contra datos pasados.
        </InfoSection>
        <InfoSection title="Sub-secciones">
          <strong>Accuracy</strong>: tracking de cada señal emitida (BUY/SELL/HOLD/WATCH), precio al momento de la señal, precio 7d/30d después, hit de target/stop, outcome win/loss/neutral, y métricas agregadas por símbolo y sector.<br />
          <strong>Backtest</strong>: motor para simular una estrategia (entry/exit rules) sobre un símbolo y rango de fechas, devolviendo equity curve, drawdown, win-rate y métricas de riesgo.
        </InfoSection>
        <InfoSection title="Cómo usarlo">
          Revisar Accuracy periódicamente (semanal/mensual) para validar que el sistema sigue siendo útil. Usar Backtest cuando quieras probar una idea concreta antes de operarla en real, o para entender la performance histórica de una señal específica.
        </InfoSection>
      </TabInfo>
      <div className="p-4">
        <Tabs value={subTab} onValueChange={(v) => setSubTab(v as HistoricoSubTab)} className="w-full">
          <TabsList variant="line" className="mb-4">
            <TabsTrigger value="accuracy">Accuracy</TabsTrigger>
            <TabsTrigger value="backtest">Backtest</TabsTrigger>
          </TabsList>

          <TabsContent value="accuracy" className="mt-0">
            <AccuracyDashboard />
          </TabsContent>
          <TabsContent value="backtest" className="mt-0">
            <BacktestPage />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
