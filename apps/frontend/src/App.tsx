import { useState, useEffect, useCallback, useMemo } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { Header } from '@/layout/Header';
import { Sidebar } from '@/layout/Sidebar';
import { PriceTicker } from '@/prices/PriceTicker';
import { InfraBar } from '@/layout/InfraBar';
import { PortfolioTable } from '@/portfolio/PortfolioTable';
import { TransactionHistory } from '@/portfolio/TransactionHistory';
import { NewsAndIntelligence } from '@/news/NewsAndIntelligence';
import { ChatPanel } from '@/chat/ChatPanel';
import { ChatToggle } from '@/layout/ChatToggle';
import { SymbolDetailPage } from '@/symbol/SymbolDetailPage';
import { OpportunityDashboard } from '@/opportunities/OpportunityDashboard';
import { DailySummary } from '@/daily/DailySummary';
import { NavigationContext } from '@/shared/navigation';

function getSymbolFromURL(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get('symbol');
}

export function App() {
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(getSymbolFromURL);
  const [sidebarOpen, setSidebarOpen] = useState(false);

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
          {/* Skip to content for accessibility */}
          <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-100 focus:bg-primary focus:text-primary-foreground focus:px-4 focus:py-2 focus:rounded">
            Ir al contenido principal
          </a>
          <InfraBar />
          <PriceTicker />
          <div className="flex items-center">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden ml-2 h-9 w-9"
              aria-label="Abrir menu"
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/></svg>
            </Button>
            <div className="flex-1">
              <Header />
            </div>
          </div>

          <div className="flex flex-1 overflow-hidden">
            <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

            {selectedSymbol ? (
              <div id="main-content" className="flex-1 overflow-y-auto">
                <SymbolDetailPage symbol={selectedSymbol} onBack={goHome} />
              </div>
            ) : (
              <Tabs defaultValue="portfolio" className="flex-1 flex flex-col overflow-hidden gap-0">
                <TabsList variant="line" className="w-full justify-start rounded-none border-b border-border bg-card px-2">
                  <TabsTrigger value="daily">Resumen</TabsTrigger>
                  <TabsTrigger value="portfolio">Portfolio</TabsTrigger>
                  <TabsTrigger value="transactions">Operaciones</TabsTrigger>
                  <TabsTrigger value="news">Noticias</TabsTrigger>
                  <TabsTrigger value="opportunities">Oportunidades</TabsTrigger>
                </TabsList>

                <TabsContent value="daily" className="flex-1 overflow-y-auto">
                  <DailySummary />
                </TabsContent>
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

            <ChatToggle>
              <ChatPanel />
            </ChatToggle>
          </div>
        </div>
      </NavigationContext>
    </TooltipProvider>
  );
}
