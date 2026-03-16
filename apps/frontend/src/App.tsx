import { useState, useEffect, useCallback, useMemo } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Header } from '@/layout/Header';
import { Sidebar } from '@/layout/Sidebar';
import { PriceTicker } from '@/prices/PriceTicker';
import { PortfolioTable } from '@/portfolio/PortfolioTable';
import { TransactionHistory } from '@/portfolio/TransactionHistory';
import { NewsAndIntelligence } from '@/news/NewsAndIntelligence';
import { ChatPanel } from '@/chat/ChatPanel';
import { SymbolDetailPage } from '@/symbol/SymbolDetailPage';
import { OpportunityDashboard } from '@/opportunities/OpportunityDashboard';
import { NavigationContext } from '@/shared/navigation';

function getSymbolFromURL(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get('symbol');
}

export function App() {
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(getSymbolFromURL);

  const goToSymbol = useCallback((symbol: string) => {
    setSelectedSymbol(symbol);
    window.history.pushState({ symbol }, '', `?symbol=${symbol}`);
  }, []);

  const goHome = useCallback(() => {
    setSelectedSymbol(null);
    window.history.pushState({}, '', '/');
  }, []);

  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      setSelectedSymbol(e.state?.symbol ?? getSymbolFromURL());
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navValue = useMemo(() => ({ goToSymbol, goHome }), [goToSymbol, goHome]);

  return (
    <TooltipProvider>
      <NavigationContext value={navValue}>
        <div className="h-screen flex flex-col">
          <PriceTicker />
          <Header />

          <div className="flex flex-1 overflow-hidden">
            <Sidebar />

            {selectedSymbol ? (
              <div className="flex-1 overflow-y-auto">
                <SymbolDetailPage symbol={selectedSymbol} onBack={goHome} />
              </div>
            ) : (
              <Tabs defaultValue="portfolio" className="flex-1 flex flex-col overflow-hidden gap-0">
                <TabsList variant="line" className="w-full justify-start rounded-none border-b border-border bg-card px-2">
                  <TabsTrigger value="portfolio">Portfolio</TabsTrigger>
                  <TabsTrigger value="transactions">Operaciones</TabsTrigger>
                  <TabsTrigger value="news">Noticias</TabsTrigger>
                  <TabsTrigger value="opportunities">Oportunidades</TabsTrigger>
                </TabsList>

                <TabsContent value="portfolio" className="flex-1 overflow-y-auto">
                  <PortfolioTable />
                </TabsContent>
                <TabsContent value="transactions" className="flex-1 overflow-y-auto">
                  <TransactionHistory />
                </TabsContent>
                <TabsContent value="news" className="flex-1 overflow-y-auto">
                  <NewsAndIntelligence />
                </TabsContent>
                <TabsContent value="opportunities" className="flex-1 overflow-y-auto">
                  <OpportunityDashboard />
                </TabsContent>
              </Tabs>
            )}

            <ChatPanel />
          </div>
        </div>
      </NavigationContext>
    </TooltipProvider>
  );
}
