import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { OpportunityDashboard } from '@/opportunities/OpportunityDashboard';
import { CycleRadarPage } from '@/radar/CycleRadarPage';
import { ThesesPage } from '@/theses/ThesesPage';
import { DailySummary } from '@/daily/DailySummary';

/**
 * Mercado: todo lo que es CONTEXTO, no decisión.
 *
 * Reagrupado el 2026-07-28. Antes eran 4 tabs de primer nivel (Oportunidades, Radar, Tesis,
 * Resumen) compitiendo en la barra con las que sí exigen acción. Ninguna de las cuatro te
 * pide hacer nada: explican por qué el motor dijo lo que dijo, en qué fase están los
 * sectores, qué opina el LLM y qué pasó en el día. Juntarlas deja la barra principal con
 * solo lo accionable y hace obvio dónde buscar el "por qué".
 *
 * El orden va de lo más consultado a lo menos: el drilldown del scan primero.
 */
export function MercadoPage() {
  const [sub, setSub] = useState('scan');

  return (
    <div className="p-4 space-y-3">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground">🔍 Mercado</h2>
        <p className="text-[11px] text-muted-foreground mt-1">
          Contexto y explicación — nada de acá te pide actuar. Las decisiones viven en <strong>Hoy</strong>.
        </p>
      </div>

      <Tabs value={sub} onValueChange={setSub}>
        <TabsList variant="line" className="w-full justify-start">
          <TabsTrigger value="scan">Scan (drilldown)</TabsTrigger>
          <TabsTrigger value="radar">Radar de ciclos</TabsTrigger>
          <TabsTrigger value="tesis">Tesis</TabsTrigger>
          <TabsTrigger value="resumen">Resumen del día</TabsTrigger>
        </TabsList>
        <TabsContent value="scan"><OpportunityDashboard /></TabsContent>
        <TabsContent value="radar"><CycleRadarPage /></TabsContent>
        <TabsContent value="tesis"><ThesesPage /></TabsContent>
        <TabsContent value="resumen"><DailySummary /></TabsContent>
      </Tabs>
    </div>
  );
}
