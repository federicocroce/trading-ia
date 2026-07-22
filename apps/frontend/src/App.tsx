import { useState, useEffect, useCallback, useMemo } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { Header } from '@/layout/Header';
import { Sidebar } from '@/layout/Sidebar';
import { PriceTicker } from '@/prices/PriceTicker';
import { InfraBar } from '@/layout/InfraBar';
import { PortfolioPage } from '@/portfolio/PortfolioPage';
import { CarteraPage } from '@/portfolio/CarteraPage';
import { ChatPanel } from '@/chat/ChatPanel';
import { ChatToggle } from '@/layout/ChatToggle';
import { SymbolDetailPage } from '@/symbol/SymbolDetailPage';
import { OpportunityDashboard } from '@/opportunities/OpportunityDashboard';
import { TodayPage } from '@/today/TodayPage';
import { DailySummary } from '@/daily/DailySummary';
import { HistoricoPage } from '@/historico/HistoricoPage';
import { CycleRadarPage } from '@/radar/CycleRadarPage';
import { ThesesPage } from '@/theses/ThesesPage';
import { NavigationContext } from '@/shared/navigation';
import { trpc } from '@/shared/trpc';
import { usePipeline } from '@/pipeline/usePipeline';
import { WebSearchBlockedModal } from '@/pipeline/WebSearchBlockedModal';

const VALID_TABS = ['hoy', 'daily', 'opportunities', 'portfolio', 'cartera', 'historico', 'radar', 'tesis'] as const;
type TabValue = typeof VALID_TABS[number];
const DEFAULT_TAB: TabValue = 'hoy';

function getSymbolFromURL(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get('symbol');
}

function getTabFromURL(): TabValue {
  const params = new URLSearchParams(window.location.search);
  const tab = params.get('tab');
  if (tab && VALID_TABS.includes(tab as TabValue)) return tab as TabValue;
  return DEFAULT_TAB;
}

function buildURL(tab: TabValue, symbol: string | null): string {
  const params = new URLSearchParams();
  if (tab !== DEFAULT_TAB) params.set('tab', tab);
  if (symbol) params.set('symbol', symbol);
  const qs = params.toString();
  return qs ? `?${qs}` : '/';
}

function BuyBadge() {
  const { data } = trpc.opportunities.scan.useQuery(undefined, { staleTime: 5 * 60_000 });
  const buyCount = data?.opportunities?.filter((o: { action: string }) => o.action === 'BUY').length ?? 0;
  if (buyCount === 0) return null;
  return (
    <span className="absolute -top-0.5 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-green-500 text-[8px] font-bold text-white">
      {buyCount > 9 ? '9+' : buyCount}
    </span>
  );
}

export function App() {
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(getSymbolFromURL);
  const [activeTab, setActiveTab] = useState<TabValue>(getTabFromURL);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { isWaitingUser, resolveWebSearch } = usePipeline();

  const goToSymbol = useCallback((symbol: string) => {
    setSelectedSymbol(symbol);
    const url = buildURL(activeTab, symbol);
    window.history.pushState({ symbol, tab: activeTab }, '', url);
  }, [activeTab]);

  const goHome = useCallback(() => {
    setSelectedSymbol(null);
    const url = buildURL(activeTab, null);
    window.history.pushState({ tab: activeTab }, '', url);
  }, [activeTab]);

  const handleTabChange = useCallback((tab: string) => {
    const next = tab as TabValue;
    setActiveTab(next);
    setSelectedSymbol(null);
    const url = buildURL(next, null);
    window.history.pushState({ tab: next }, '', url);
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      setSelectedSymbol(getSymbolFromURL());
      setActiveTab(getTabFromURL());
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navValue = useMemo(() => ({ goToSymbol, goHome }), [goToSymbol, goHome]);

  return (
    <TooltipProvider>
      <NavigationContext value={navValue}>
        <div className="h-screen flex flex-col">
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

            <Tabs value={activeTab} onValueChange={handleTabChange} className="flex-1 flex flex-col overflow-hidden gap-0">
              <TabsList variant="line" className="w-full justify-start rounded-none border-b border-border bg-card px-2">
                <TabsTrigger value="hoy">Hoy</TabsTrigger>
                <TabsTrigger value="daily">Resumen</TabsTrigger>
                <TabsTrigger value="opportunities" className="relative">
                  Oportunidades
                  <BuyBadge />
                </TabsTrigger>
                <TabsTrigger value="portfolio">Portfolio</TabsTrigger>
                <TabsTrigger value="cartera">Cartera</TabsTrigger>
                <TabsTrigger value="historico">Histórico</TabsTrigger>
                <TabsTrigger value="radar">Radar</TabsTrigger>
                <TabsTrigger value="tesis">Tesis</TabsTrigger>
              </TabsList>

              {selectedSymbol ? (
                <div id="main-content" className="flex-1 overflow-y-auto">
                  <SymbolDetailPage symbol={selectedSymbol} onBack={goHome} />
                </div>
              ) : (
                <>
                  <TabsContent value="hoy" className="flex-1 overflow-y-auto">
                    <TodayPage />
                  </TabsContent>
                  <TabsContent value="daily" className="flex-1 overflow-y-auto">
                    <DailySummary />
                  </TabsContent>
                  <TabsContent value="opportunities" className="flex-1 overflow-y-auto">
                    <OpportunityDashboard />
                  </TabsContent>
                  <TabsContent value="portfolio" className="flex-1 overflow-y-auto">
                    <PortfolioPage />
                  </TabsContent>
                  <TabsContent value="cartera" className="flex-1 overflow-y-auto">
                    <CarteraPage />
                  </TabsContent>
                  <TabsContent value="historico" className="flex-1 overflow-y-auto">
                    <HistoricoPage />
                  </TabsContent>
                  <TabsContent value="radar" className="flex-1 overflow-y-auto">
                    <CycleRadarPage />
                  </TabsContent>
                  <TabsContent value="tesis" className="flex-1 overflow-y-auto">
                    <ThesesPage />
                  </TabsContent>
                </>
              )}
            </Tabs>

            <ChatToggle>
              <ChatPanel />
            </ChatToggle>
          </div>
        </div>
      </NavigationContext>
      <WebSearchBlockedModal
        open={isWaitingUser}
        onRetry={() => resolveWebSearch('retry')}
        onSkip={() => resolveWebSearch('skip')}
        onCancel={() => resolveWebSearch('cancel')}
      />
    </TooltipProvider>
  );
}
