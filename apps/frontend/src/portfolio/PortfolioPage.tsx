import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TabInfo, InfoSection } from '@/shared/TabInfo';
import { PortfolioTable } from './PortfolioTable';
import { TransactionHistory } from './TransactionHistory';

type PortfolioSubTab = 'holdings' | 'transactions';

export function PortfolioPage() {
  const [subTab, setSubTab] = useState<PortfolioSubTab>('holdings');

  return (
    <>
      <TabInfo>
        <InfoSection title="Qué muestra">
          Tu portfolio real (posiciones abiertas) más las watchlists organizadas por tipo de instrumento (Acciones, ETFs, Crypto). Incluye también el histórico de operaciones para llevar registro contable de compras y ventas.
        </InfoSection>
        <InfoSection title="Sub-secciones">
          <strong>Holdings & Watchlist</strong>: posiciones actuales con P&L, recomendación del sistema (BUY/SELL/HOLD/WATCH) y conviction tier. Tabs internas separan portfolio real de watchlists por tipo. Click en un símbolo abre el detalle completo.<br />
          <strong>Operaciones</strong>: histórico completo de transacciones (compras, ventas, dividendos). Permite editar, eliminar, agregar nuevas operaciones manualmente.
        </InfoSection>
        <InfoSection title="Cómo usarlo">
          Holdings para chequear el estado del portfolio en tiempo real y ver qué tickers del watchlist tienen señal hoy. Operaciones para auditar movimientos pasados o registrar trades nuevos no capturados automáticamente.
        </InfoSection>
      </TabInfo>
      <div className="p-4">
        <Tabs value={subTab} onValueChange={(v) => setSubTab(v as PortfolioSubTab)} className="w-full">
          <TabsList variant="line" className="mb-4">
            <TabsTrigger value="holdings">Holdings & Watchlist</TabsTrigger>
            <TabsTrigger value="transactions">Operaciones</TabsTrigger>
          </TabsList>

          <TabsContent value="holdings" className="mt-0 space-y-4">
            <PortfolioTable />
          </TabsContent>
          <TabsContent value="transactions" className="mt-0">
            <TransactionHistory />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
