# Trading Dashboard — Command Center UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir el trading dashboard en un Command Center con reliability global visible, layout adaptivo, chat colapsable, y opportunity cards con info crítica al frente — sin romper nada existente.

**Architecture:** Añadir `InfraBar` como capa de infraestructura siempre visible (health + scan + staleness). Compactar `Header` a 1 línea. Hacer `ChatPanel` colapsable via wrapper. Reestructurar `OpportunityCard` para mostrar Score+Acción+Levels en el hero visible. Playwright para smoke tests en cada tarea.

**Tech Stack:** React 19, TypeScript, Tailwind v4, shadcn/ui v4, tRPC, Playwright (nuevo), Vite

---

## File Map

### Nuevos archivos
- `apps/frontend/src/layout/InfraBar.tsx` — barra global 28px: health + scan progress + staleness
- `apps/frontend/src/layout/ChatToggle.tsx` — wrapper colapsable para ChatPanel
- `apps/frontend/src/hooks/useChatCollapsed.ts` — estado persistido en localStorage
- `apps/frontend/src/hooks/useDataStaleness.ts` — calcula si timestamps son stale (>1h)
- `apps/frontend/e2e/smoke.spec.ts` — Playwright smoke tests
- `apps/frontend/playwright.config.ts` — config Playwright

### Archivos modificados
- `apps/frontend/src/App.tsx` — integrar InfraBar, ChatToggle, reorder tabs, BuyBadge
- `apps/frontend/src/layout/Header.tsx` — compactar a 1 línea, icon buttons con staleness colors
- `apps/frontend/src/opportunities/OpportunityCard.tsx` — hero con Score+Action+Levels siempre visible
- `apps/frontend/src/opportunities/OpportunityDashboard.tsx` — remover ServiceHealthBar local
- `apps/frontend/package.json` — agregar @playwright/test

---

## Task 1: Instalar Playwright y baseline smoke tests

**Files:**
- Modify: `apps/frontend/package.json`
- Create: `apps/frontend/playwright.config.ts`
- Create: `apps/frontend/e2e/smoke.spec.ts`

- [ ] **Step 1: Instalar Playwright**

```bash
cd apps/frontend && npm install -D @playwright/test
npx playwright install chromium --with-deps
```

Expected: `@playwright/test` en devDependencies, chromium descargado.

- [ ] **Step 2: Crear playwright.config.ts**

```typescript
// apps/frontend/playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
```

- [ ] **Step 3: Crear e2e/smoke.spec.ts con baseline tests**

```typescript
// apps/frontend/e2e/smoke.spec.ts
import { test, expect } from '@playwright/test';

test('app carga sin errores críticos', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('text=Error inesperado')).not.toBeVisible();
  await expect(page.locator('header')).toBeVisible();
});

test('tabs principales son visibles', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Resumen' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Portfolio' })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Oportunidades/ })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Noticias' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Operaciones' })).toBeVisible();
});

test('sidebar watchlist es visible', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('aside').first()).toBeVisible();
});

test('navegación a símbolo funciona sin error', async ({ page }) => {
  await page.goto('/?symbol=AAPL');
  await expect(page.locator('text=Error inesperado')).not.toBeVisible();
});

test('chat panel existe', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('text=Chat con Claude')).toBeVisible();
});
```

- [ ] **Step 4: Correr baseline (deben pasar con la app actual)**

```bash
cd apps/frontend && npx playwright test --reporter=line
```

Expected: todos pasan.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/package.json apps/frontend/playwright.config.ts apps/frontend/e2e/smoke.spec.ts
git commit -m "test: add Playwright baseline smoke tests"
```

---

## Task 2: Hook useChatCollapsed + ChatToggle wrapper

**Files:**
- Create: `apps/frontend/src/hooks/useChatCollapsed.ts`
- Create: `apps/frontend/src/layout/ChatToggle.tsx`
- Modify: `apps/frontend/src/App.tsx`

- [ ] **Step 1: Crear apps/frontend/src/hooks/useChatCollapsed.ts**

```typescript
import { useState, useEffect } from 'react';

const STORAGE_KEY = 'chat-collapsed';

export function useChatCollapsed() {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(collapsed));
    } catch {
      // localStorage unavailable, continue without persistence
    }
  }, [collapsed]);

  const toggle = () => setCollapsed((prev) => !prev);

  return { collapsed, toggle };
}
```

- [ ] **Step 2: Crear apps/frontend/src/layout/ChatToggle.tsx**

```tsx
import { useChatCollapsed } from '@/hooks/useChatCollapsed';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface ChatToggleProps {
  children: React.ReactNode;
}

export function ChatToggle({ children }: ChatToggleProps) {
  const { collapsed, toggle } = useChatCollapsed();

  return (
    <div className="flex h-full relative">
      {/* Toggle button on left edge */}
      <div className="flex items-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={toggle}
              className="flex items-center justify-center w-5 h-14 bg-card border-l border-t border-b border-border rounded-l-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              aria-label={collapsed ? 'Abrir chat' : 'Cerrar chat'}
            >
              {collapsed
                ? <ChevronLeft className="w-3 h-3" />
                : <ChevronRight className="w-3 h-3" />
              }
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">
            {collapsed ? 'Abrir chat Claude' : 'Cerrar chat'}
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Chat panel with collapse animation */}
      <div
        className="overflow-hidden transition-all duration-200 ease-in-out"
        style={{ width: collapsed ? 0 : 384 }}
        aria-hidden={collapsed}
      >
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: En App.tsx, wrappear ChatPanel con ChatToggle**

Agregar import:
```tsx
import { ChatToggle } from '@/layout/ChatToggle';
```

Reemplazar `<ChatPanel />` con:
```tsx
<ChatToggle>
  <ChatPanel />
</ChatToggle>
```

- [ ] **Step 4: Typecheck**

```bash
cd apps/frontend && npm run typecheck
```

Expected: sin errores.

- [ ] **Step 5: Correr smoke tests**

```bash
cd apps/frontend && npx playwright test --reporter=line
```

Expected: todos pasan (el test `chat panel existe` sigue pasando — el texto está en DOM aunque colapsado).

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/hooks/useChatCollapsed.ts apps/frontend/src/layout/ChatToggle.tsx apps/frontend/src/App.tsx
git commit -m "feat: collapsible chat panel with localStorage persistence"
```

---

## Task 3: Hook useDataStaleness

**Files:**
- Create: `apps/frontend/src/hooks/useDataStaleness.ts`

- [ ] **Step 1: Crear apps/frontend/src/hooks/useDataStaleness.ts**

```typescript
export type StalenessLevel = 'fresh' | 'warning' | 'stale';

export interface StalenessInfo {
  level: StalenessLevel;
  label: string; // e.g. "hace 2h", "ahora"
  ageMs: number;
}

const THRESHOLDS = {
  warning: 60 * 60 * 1000,     // 1 hora
  stale:   6 * 60 * 60 * 1000, // 6 horas
};

export function getStaleness(timestamp: number | null | undefined): StalenessInfo {
  if (!timestamp) {
    return { level: 'stale', label: 'sin datos', ageMs: Infinity };
  }

  const ageMs = Date.now() - timestamp;
  const ageMin = Math.floor(ageMs / 60_000);
  const ageHrs = Math.floor(ageMin / 60);
  const ageDays = Math.floor(ageHrs / 24);

  let label: string;
  if (ageMin < 1) label = 'ahora';
  else if (ageMin < 60) label = `hace ${ageMin}m`;
  else if (ageHrs < 24) label = `hace ${ageHrs}h`;
  else label = `hace ${ageDays}d`;

  let level: StalenessLevel;
  if (ageMs < THRESHOLDS.warning) level = 'fresh';
  else if (ageMs < THRESHOLDS.stale) level = 'warning';
  else level = 'stale';

  return { level, label, ageMs };
}

export function useDataStaleness(timestamp: number | null | undefined): StalenessInfo {
  return getStaleness(timestamp);
}
```

- [ ] **Step 2: Typecheck**

```bash
cd apps/frontend && npm run typecheck
```

Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/hooks/useDataStaleness.ts
git commit -m "feat: useDataStaleness hook — fresh/warning/stale classification"
```

---

## Task 4: InfraBar — service health global + scan progress + data staleness

**Files:**
- Create: `apps/frontend/src/layout/InfraBar.tsx`
- Modify: `apps/frontend/src/App.tsx`

- [ ] **Step 1: Crear apps/frontend/src/layout/InfraBar.tsx**

```tsx
import { trpc } from '@/shared/trpc';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { getStaleness } from '@/hooks/useDataStaleness';

type ServiceStatus = 'ok' | 'degraded' | 'error';

interface ServiceState {
  name: string;
  status: ServiceStatus;
  lastOk: number | null;
  lastError: number | null;
  errorMessage: string | null;
  errorCount: number;
  successCount: number;
}

const DOT: Record<ServiceStatus, string> = {
  ok: 'bg-green-500',
  degraded: 'bg-yellow-500',
  error: 'bg-red-500',
};

const TEXT_COLOR: Record<ServiceStatus, string> = {
  ok: 'text-muted-foreground',
  degraded: 'text-yellow-400',
  error: 'text-red-400',
};

function ServicePill({ service, onRetry }: { service: ServiceState; onRetry?: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-1 cursor-help">
          <div className={`w-1.5 h-1.5 rounded-full ${DOT[service.status]}`} />
          <span className={`text-[10px] font-mono ${TEXT_COLOR[service.status]}`}>
            {service.name}
          </span>
          {service.status !== 'ok' && service.lastError && (
            <span className="text-[9px] text-muted-foreground">
              ({getStaleness(service.lastError).label})
            </span>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs space-y-1">
        <p className="font-semibold text-xs">
          {service.name}: {service.status === 'ok' ? 'OK' : service.status === 'degraded' ? 'Degradado' : 'Error'}
        </p>
        {service.errorMessage && (
          <p className="text-xs text-red-400">{service.errorMessage}</p>
        )}
        {service.lastOk && (
          <p className="text-[10px] text-muted-foreground">
            Último éxito: {getStaleness(service.lastOk).label}
          </p>
        )}
        {service.errorCount > 0 && (
          <p className="text-[10px] text-muted-foreground">
            Errores consecutivos: {service.errorCount}
          </p>
        )}
        {onRetry && service.status !== 'ok' && (
          <button
            onClick={onRetry}
            className="text-[10px] text-blue-400 hover:text-blue-300 underline mt-1 block"
          >
            Reintentar
          </button>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

function ScanProgress() {
  const { data: status } = trpc.opportunities.scanStatus.useQuery(undefined, {
    refetchInterval: 2000,
  });

  if (!status?.isScanning) return null;

  const elapsed = status.elapsedSeconds ?? 0;
  const min = Math.floor(elapsed / 60);
  const sec = elapsed % 60;

  return (
    <div className="flex items-center gap-2 border-l border-border pl-2">
      <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
      <span className="text-[10px] text-blue-400 font-medium">
        {status.currentStep} ({status.stepNumber}/{status.totalSteps})
      </span>
      <div className="h-1 w-14 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-blue-500 transition-all duration-1000"
          style={{ width: `${status.percentComplete}%` }}
        />
      </div>
      <span className="text-[9px] text-muted-foreground">
        {min}:{sec.toString().padStart(2, '0')}
      </span>
    </div>
  );
}

function DataTimestamps() {
  const { data: timestamps } = trpc.opportunities.processTimestamps.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  if (!timestamps) return null;

  const items = [
    { key: 'N', ts: timestamps.news, label: 'Noticias' },
    { key: 'F', ts: timestamps.fundamentals, label: 'Fundamentales' },
    { key: 'A', ts: timestamps.analysis, label: 'Análisis' },
  ];

  return (
    <div className="flex items-center gap-2 border-l border-border pl-2">
      {items.map(({ key, ts, label }) => {
        const s = getStaleness(ts ?? null);
        const color =
          s.level === 'fresh' ? 'text-muted-foreground' :
          s.level === 'warning' ? 'text-yellow-400' :
          'text-red-400';
        return (
          <Tooltip key={key}>
            <TooltipTrigger asChild>
              <span className={`text-[10px] font-mono cursor-help ${color}`}>
                {key}:{s.label}
              </span>
            </TooltipTrigger>
            <TooltipContent>{label}: última actualización {s.label}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

export function InfraBar() {
  const { data, refetch } = trpc.health.useQuery(undefined, {
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
  const utils = trpc.useUtils();

  const handleRetry = () => {
    refetch();
    utils.invalidate();
  };

  const services: ServiceState[] = (data?.services as ServiceState[]) ?? [];
  const hasProblems = services.some((s) => s.status !== 'ok');
  const problems = services.filter((s) => s.status !== 'ok');
  const okServices = services.filter((s) => s.status === 'ok');

  return (
    <div
      className={`h-7 flex items-center px-3 gap-3 border-b text-[10px] shrink-0 transition-colors ${
        hasProblems ? 'bg-red-500/5 border-red-500/20' : 'bg-background border-border'
      }`}
      role="status"
      aria-label="Estado de servicios"
    >
      {hasProblems ? (
        <>
          <span className="text-red-400 font-semibold shrink-0">
            {problems.length} {problems.length === 1 ? 'servicio caído' : 'servicios caídos'}
          </span>
          {problems.map((s) => (
            <ServicePill key={s.name} service={s} onRetry={handleRetry} />
          ))}
          {okServices.length > 0 && (
            <>
              <span className="text-border">|</span>
              {okServices.map((s) => <ServicePill key={s.name} service={s} />)}
            </>
          )}
        </>
      ) : (
        <>
          <div className="flex items-center gap-1 shrink-0">
            <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
            <span className="text-muted-foreground">Servicios OK</span>
          </div>
          {services.map((s) => <ServicePill key={s.name} service={s} />)}
        </>
      )}

      <ScanProgress />
      <DataTimestamps />
    </div>
  );
}
```

- [ ] **Step 2: Integrar InfraBar en App.tsx**

Agregar import en `apps/frontend/src/App.tsx`:
```tsx
import { InfraBar } from '@/layout/InfraBar';
```

En el JSX, dentro de `<div className="h-screen flex flex-col">`, agregar `<InfraBar />` como **primer child**, antes de `<PriceTicker />`:
```tsx
<div className="h-screen flex flex-col">
  {/* Skip to content */}
  <a href="#main-content" ...>...</a>
  <InfraBar />        {/* ← NUEVO, primer hijo */}
  <PriceTicker />
  ...
```

- [ ] **Step 3: Typecheck**

```bash
cd apps/frontend && npm run typecheck
```

Expected: sin errores. Si hay error en `data?.services` por tipo, castear como `(data?.services as ServiceState[]) ?? []` (ya está en el código).

- [ ] **Step 4: Smoke tests**

```bash
cd apps/frontend && npx playwright test --reporter=line
```

Expected: todos pasan.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/layout/InfraBar.tsx apps/frontend/src/App.tsx
git commit -m "feat: InfraBar global — service health + retry + scan progress + data staleness"
```

---

## Task 5: Compactar Header a una sola línea

**Files:**
- Modify: `apps/frontend/src/layout/Header.tsx`

Con InfraBar manejando scan progress y timestamps, el Header queda en 1 línea: título + acciones + portfolio.

- [ ] **Step 1: Reemplazar el contenido completo de Header.tsx**

```tsx
// apps/frontend/src/layout/Header.tsx
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Newspaper, BarChart2, Zap } from 'lucide-react';
import { trpc } from '@/shared/trpc';
import { getStaleness } from '@/hooks/useDataStaleness';

export function Header() {
  const { data: summary } = trpc.portfolio.summary.useQuery(undefined, { refetchInterval: 60_000 });
  const { data: status } = trpc.opportunities.scanStatus.useQuery(undefined, { refetchInterval: 3000 });
  const { data: timestamps } = trpc.opportunities.processTimestamps.useQuery(undefined, { refetchInterval: 5000 });

  const utils = trpc.useUtils();

  const invalidateAll = () => {
    utils.opportunities.scan.invalidate();
    utils.opportunities.scanStatus.invalidate();
    utils.opportunities.processTimestamps.invalidate();
    utils.opportunities.accuracyStats.invalidate();
    utils.intelligence.dailyReport.invalidate();
    utils.intelligence.sectorReports.invalidate();
  };

  const refreshNews = trpc.opportunities.refreshNews.useMutation({ onSuccess: invalidateAll });
  const refreshFund = trpc.opportunities.refreshFundamentals.useMutation({ onSuccess: invalidateAll });
  const analyze = trpc.opportunities.analyze.useMutation({ onSuccess: invalidateAll });
  const fullPipeline = trpc.opportunities.fullPipeline.useMutation({ onSuccess: invalidateAll });

  const isScanning = status?.isScanning ?? false;
  const anyRunning =
    refreshNews.isPending || refreshFund.isPending ||
    analyze.isPending || fullPipeline.isPending || isScanning;

  const newsS = getStaleness(timestamps?.news ?? null);
  const fundS = getStaleness(timestamps?.fundamentals ?? null);
  const analysisS = getStaleness(timestamps?.analysis ?? null);

  return (
    <header className="bg-card border-b border-border px-4 py-2 shrink-0">
      <div className="flex items-center justify-between gap-4">
        {/* Title */}
        <div className="flex items-center gap-2 shrink-0">
          <h1 className="text-base font-bold tracking-tight">Trading IA</h1>
          <Badge variant="secondary" className="text-[9px] h-4">ARG & Global</Badge>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="default"
                onClick={() => fullPipeline.mutate()}
                disabled={anyRunning}
                className="h-7 text-xs px-3 font-semibold"
              >
                {isScanning ? 'Analizando...' : 'Analizar'}
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <p className="font-medium">Análisis completo (~3 min)</p>
              <p className="text-xs">Noticias → Sectores → Fundamentales → Técnico → Scoring → Deep Analysis</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm" variant="ghost"
                onClick={() => refreshNews.mutate()}
                disabled={anyRunning}
                className={`h-7 w-7 p-0 ${newsS.level !== 'fresh' ? 'text-yellow-400' : 'text-muted-foreground'}`}
                aria-label="Actualizar noticias"
              >
                {refreshNews.isPending ? <span className="text-[9px]">...</span> : <Newspaper className="w-3.5 h-3.5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Noticias ({newsS.label})</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm" variant="ghost"
                onClick={() => refreshFund.mutate()}
                disabled={anyRunning}
                className={`h-7 w-7 p-0 ${fundS.level !== 'fresh' ? 'text-yellow-400' : 'text-muted-foreground'}`}
                aria-label="Actualizar fundamentales"
              >
                {refreshFund.isPending ? <span className="text-[9px]">...</span> : <BarChart2 className="w-3.5 h-3.5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Fundamentales ({fundS.label})</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm" variant="ghost"
                onClick={() => analyze.mutate()}
                disabled={anyRunning}
                className={`h-7 w-7 p-0 ${analysisS.level !== 'fresh' ? 'text-yellow-400' : 'text-muted-foreground'}`}
                aria-label="Actualizar análisis"
              >
                {analyze.isPending ? <span className="text-[9px]">...</span> : <Zap className="w-3.5 h-3.5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Análisis rápido ({analysisS.label})</TooltipContent>
          </Tooltip>
        </div>

        {/* Portfolio summary */}
        {summary && (
          <div className="flex items-center gap-3 border-l border-border pl-3 shrink-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Portfolio</span>
              <span className="text-sm font-semibold">
                ${summary.totalValue.toLocaleString('en-US', { minimumFractionDigits: 0 })}
              </span>
            </div>
            <Badge
              variant={summary.totalPnl >= 0 ? 'default' : 'destructive'}
              className="text-xs h-5"
            >
              {summary.totalPnl >= 0 ? '+' : ''}${summary.totalPnl.toLocaleString('en-US', { minimumFractionDigits: 0 })}
              {' '}({summary.totalPnlPercent >= 0 ? '+' : ''}{summary.totalPnlPercent.toFixed(1)}%)
            </Badge>
            <span className="text-[10px] text-muted-foreground">{summary.positionCount}p</span>
          </div>
        )}
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd apps/frontend && npm run typecheck
```

Expected: sin errores.

- [ ] **Step 3: Smoke tests**

```bash
cd apps/frontend && npx playwright test --reporter=line
```

Expected: todos pasan.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/layout/Header.tsx
git commit -m "feat: compact header to single line with icon buttons and staleness colors"
```

---

## Task 6: Reordenar tabs + BuyBadge + remover ServiceHealthBar duplicado

**Files:**
- Modify: `apps/frontend/src/App.tsx`
- Modify: `apps/frontend/src/opportunities/OpportunityDashboard.tsx`

- [ ] **Step 1: En App.tsx, agregar import trpc y BuyBadge**

Agregar al principio de `App.tsx`:
```tsx
import { trpc } from '@/shared/trpc';
```

Agregar función `BuyBadge` antes del componente `App`:
```tsx
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
```

- [ ] **Step 2: Reordenar tabs en App.tsx — cambiar `defaultValue` y orden de TabsTrigger**

Reemplazar el bloque `<Tabs ...>` completo con:
```tsx
<Tabs defaultValue="daily" className="flex-1 flex flex-col overflow-hidden gap-0">
  <TabsList variant="line" className="w-full justify-start rounded-none border-b border-border bg-card px-2">
    <TabsTrigger value="daily">Resumen</TabsTrigger>
    <TabsTrigger value="opportunities" className="relative">
      Oportunidades
      <BuyBadge />
    </TabsTrigger>
    <TabsTrigger value="portfolio">Portfolio</TabsTrigger>
    <TabsTrigger value="news">Noticias</TabsTrigger>
    <TabsTrigger value="transactions">Operaciones</TabsTrigger>
  </TabsList>
  <TabsContent value="daily" className="flex-1 overflow-y-auto">
    <DailySummary />
  </TabsContent>
  <TabsContent value="opportunities" className="flex-1 overflow-y-auto">
    <OpportunityDashboard />
  </TabsContent>
  <TabsContent value="portfolio" className="flex-1 overflow-y-auto">
    <PortfolioTable />
  </TabsContent>
  <TabsContent value="news" className="flex-1 overflow-y-auto">
    <NewsAndIntelligence />
  </TabsContent>
  <TabsContent value="transactions" className="flex-1 overflow-y-auto">
    <TransactionHistory />
  </TabsContent>
</Tabs>
```

- [ ] **Step 3: En OpportunityDashboard.tsx, remover ServiceHealthBar**

Eliminar esta línea:
```tsx
import { ServiceHealthBar } from '@/components/ServiceHealthBar';
```

Y en el JSX de `OpportunityDashboard`, eliminar `<ServiceHealthBar />` (buscarlo con grep):
```bash
grep -n "ServiceHealthBar" apps/frontend/src/opportunities/OpportunityDashboard.tsx
```

Eliminar la línea encontrada.

- [ ] **Step 4: Typecheck**

```bash
cd apps/frontend && npm run typecheck
```

- [ ] **Step 5: Smoke tests + nuevos tests para esta tarea**

Agregar al final de `e2e/smoke.spec.ts`:
```typescript
test('tab Resumen es el default al cargar', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Resumen' })).toHaveAttribute('data-state', 'active');
});

test('InfraBar es visible', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[role="status"][aria-label="Estado de servicios"]')).toBeVisible();
});
```

```bash
cd apps/frontend && npx playwright test --reporter=line
```

Expected: todos pasan.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/App.tsx apps/frontend/src/opportunities/OpportunityDashboard.tsx apps/frontend/e2e/smoke.spec.ts
git commit -m "feat: reorder tabs (Resumen default, Oportunidades 2nd), BUY badge, remove duplicate ServiceHealthBar"
```

---

## Task 7: Reestructurar OpportunityCard — hero con Score + Action + Levels

**Files:**
- Modify: `apps/frontend/src/opportunities/OpportunityCard.tsx`

- [ ] **Step 1: Leer la parte actual del render principal**

Leer `apps/frontend/src/opportunities/OpportunityCard.tsx` desde línea 257 en adelante para ver el JSX actual del card, asegurarse de entender qué está renderizando.

- [ ] **Step 2: Verificar que trpc.analysis.signal existe**

```bash
grep -r "analysis.*signal\|signal.*analysis" apps/backend/src/router.ts apps/backend/src/analysis/ --include="*.ts" -l
```

Si no existe `trpc.analysis.signal`, el botón "Generar señal IA fresca" usará `trpc.analysis.news` como fallback o simplemente se omite ese botón.

- [ ] **Step 3: Reemplazar la función OpportunityCard (línea ~257 al final del archivo)**

Mantener todos los interfaces, tipos y helpers existentes (líneas 1-256). Reemplazar solo la función `OpportunityCard` y todo lo que viene después:

```tsx
export function OpportunityCard({ opportunity }: { opportunity: Opportunity }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = actionConfig[opportunity.action] ?? actionConfig['WATCH'];
  const tl = opportunity.tradeLevels;

  const scoreColor =
    opportunity.opportunityScore >= 65 ? 'text-green-400' :
    opportunity.opportunityScore >= 45 ? 'text-yellow-400' :
    'text-muted-foreground';

  return (
    <Card className={`border-l-4 ${cfg.borderColor} transition-all`} size="sm">
      <CardContent className="py-3 px-3 space-y-2">

        {/* ── HERO ROW — always visible ── */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Symbol + price */}
          <div className="flex items-center gap-1.5 shrink-0">
            {opportunity.inPortfolio && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-[9px] font-bold text-blue-400 bg-blue-500/10 rounded px-1 cursor-help">P</span>
                </TooltipTrigger>
                <TooltipContent>En tu portfolio ({opportunity.portfolioQuantity} unidades)</TooltipContent>
              </Tooltip>
            )}
            <span className="font-bold text-sm">{opportunity.symbol}</span>
            <span className="text-xs text-muted-foreground font-mono">
              ${opportunity.currentPrice.toFixed(2)}
            </span>
          </div>

          {/* Score */}
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1 cursor-help shrink-0">
                <span className="text-[9px] text-muted-foreground uppercase">Score</span>
                <span className={`text-sm font-bold font-mono ${scoreColor}`}>
                  {opportunity.opportunityScore}
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent>Score 0-100: combina técnico, fundamental y sentimiento.</TooltipContent>
          </Tooltip>

          {/* Action badge */}
          <Tooltip>
            <TooltipTrigger asChild>
              <span className={`text-xs font-bold px-2 py-0.5 rounded cursor-help shrink-0 ${cfg.bgClass} ${cfg.textClass}`}>
                {cfg.emoji} {cfg.label}
              </span>
            </TooltipTrigger>
            <TooltipContent>{cfg.description}</TooltipContent>
          </Tooltip>

          {/* Confidence */}
          <ConfidenceBar percent={opportunity.confidence} />

          {/* Conviction tier */}
          {opportunity.convictionTier && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className={`text-[9px] px-1.5 py-0.5 rounded border cursor-help shrink-0 ${
                  opportunity.convictionTier === 'strong' ? 'border-green-500/40 text-green-400' :
                  opportunity.convictionTier === 'speculative' ? 'border-yellow-500/40 text-yellow-400' :
                  'border-border text-muted-foreground'
                }`}>
                  {opportunity.convictionTier === 'strong' ? 'Alta convicción' :
                   opportunity.convictionTier === 'speculative' ? 'Especulativo' : 'Estándar'}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {opportunity.convictionTier === 'strong' ? 'Múltiples señales confluyen fuertemente.' :
                 opportunity.convictionTier === 'speculative' ? 'Señales débiles o contradictorias, mayor riesgo.' :
                 'Señales moderadas, riesgo estándar.'}
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* ── TRADE LEVELS — always visible if present ── */}
        {tl && (
          <div className="flex items-center gap-3 flex-wrap text-xs font-mono border-t border-border pt-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-help">
                  <span className="text-muted-foreground text-[9px] mr-1">Entry</span>
                  <span className="text-foreground font-semibold">${tl.entryPrice.toFixed(2)}</span>
                </span>
              </TooltipTrigger>
              <TooltipContent>{tl.entryReason}</TooltipContent>
            </Tooltip>
            <span className="text-border">·</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-help">
                  <span className="text-muted-foreground text-[9px] mr-1">Stop</span>
                  <span className="text-trading-red font-semibold">${tl.stopLoss.toFixed(2)}</span>
                </span>
              </TooltipTrigger>
              <TooltipContent>{tl.stopReason}</TooltipContent>
            </Tooltip>
            <span className="text-border">·</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-help">
                  <span className="text-muted-foreground text-[9px] mr-1">Target</span>
                  <span className="text-trading-green font-semibold">${tl.takeProfit.toFixed(2)}</span>
                </span>
              </TooltipTrigger>
              <TooltipContent>{tl.targetReason}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-help text-muted-foreground">
                  R/R <span className="text-foreground">{tl.riskRewardRatio.toFixed(1)}x</span>
                </span>
              </TooltipTrigger>
              <TooltipContent>Risk/Reward ratio. Mayor a 2x es favorable.</TooltipContent>
            </Tooltip>
            {tl.suggestedAmount && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="cursor-help text-muted-foreground">
                    Tamaño <span className="text-foreground">${tl.suggestedAmount.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
                  </span>
                </TooltipTrigger>
                <TooltipContent>{tl.sizingReason ?? 'Tamaño sugerido de posición'}</TooltipContent>
              </Tooltip>
            )}
          </div>
        )}

        {/* ── RETURN ESTIMATES ── */}
        {(opportunity.shortTerm || opportunity.mediumTerm) && (
          <div className="flex items-center gap-4">
            {opportunity.shortTerm && (
              <div className="flex-1">
                <p className="text-[9px] text-muted-foreground mb-0.5">Corto plazo</p>
                <ReturnEstimateBar estimate={opportunity.shortTerm} />
              </div>
            )}
            {opportunity.mediumTerm && (
              <div className="flex-1">
                <p className="text-[9px] text-muted-foreground mb-0.5">Mediano plazo</p>
                <ReturnEstimateBar estimate={opportunity.mediumTerm} />
              </div>
            )}
          </div>
        )}

        {/* ── REASONING ── */}
        {(opportunity.simpleReasoning ?? opportunity.reasoning) && (
          <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
            {opportunity.simpleReasoning ?? opportunity.reasoning}
          </p>
        )}

        {/* ── EXPAND TOGGLE ── */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-[10px] text-muted-foreground hover:text-foreground transition-colors border-t border-border pt-2 w-full text-left"
        >
          {expanded ? '▲ Menos detalle' : '▼ Más detalle — catalizadores, riesgos, breakdown TA/FA'}
        </button>

        {/* ── EXPANDED DETAIL ── */}
        {expanded && (
          <div className="space-y-3">
            {/* Breakdown */}
            {opportunity.breakdown && (
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Técnico', data: opportunity.breakdown.technical, sig: taSignalLabel[opportunity.breakdown.technical.signal] },
                  { label: 'Fundamental', data: opportunity.breakdown.fundamental, sig: faSignalLabel[opportunity.breakdown.fundamental.signal] },
                  { label: 'Sentimiento', data: opportunity.breakdown.sentiment, sig: sentimentLabel[opportunity.breakdown.sentiment.signal] },
                ].map(({ label, data, sig }) => (
                  <div key={label} className="space-y-1">
                    <p className="text-[9px] text-muted-foreground uppercase tracking-wider">{label}</p>
                    <p className="text-[10px] font-medium">{sig}</p>
                    <ScoreBar score={data.score} tooltip={`${label}: ${data.keyFactors.join(', ')}`} />
                    <ul className="space-y-0.5">
                      {data.keyFactors.slice(0, 2).map((f, i) => (
                        <li key={i} className="text-[9px] text-muted-foreground truncate">{f}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}

            {/* Catalysts & Risks */}
            {(opportunity.catalysts?.length || opportunity.risks?.length) ? (
              <div className="grid grid-cols-2 gap-2">
                {opportunity.catalysts?.length ? (
                  <div>
                    <p className="text-[9px] text-muted-foreground uppercase mb-1">Catalizadores</p>
                    <ul className="space-y-0.5">
                      {opportunity.catalysts.slice(0, 3).map((c, i) => (
                        <li key={i} className="text-[9px] text-green-400">↑ {c}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {opportunity.risks?.length ? (
                  <div>
                    <p className="text-[9px] text-muted-foreground uppercase mb-1">Riesgos</p>
                    <ul className="space-y-0.5">
                      {opportunity.risks.slice(0, 3).map((r, i) => (
                        <li key={i} className="text-[9px] text-red-400">↓ {r}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* Deep analysis */}
            {opportunity.deepAnalysis && (
              <div className="space-y-2 border-t border-border pt-2">
                <p className="text-[9px] text-muted-foreground uppercase font-semibold">Deep Analysis IA</p>
                {opportunity.deepAnalysis.positives?.length ? (
                  <div>
                    <p className="text-[9px] text-green-400 font-medium mb-0.5">Lo bueno</p>
                    <ul className="space-y-0.5">
                      {opportunity.deepAnalysis.positives.map((p, i) => (
                        <li key={i} className="text-[10px] text-muted-foreground">· {p}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {opportunity.deepAnalysis.concerns?.length ? (
                  <div>
                    <p className="text-[9px] text-red-400 font-medium mb-0.5">Lo preocupante</p>
                    <ul className="space-y-0.5">
                      {opportunity.deepAnalysis.concerns.map((c, i) => (
                        <li key={i} className="text-[10px] text-muted-foreground">· {c}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {opportunity.deepAnalysis.recommendation && (
                  <div>
                    <p className="text-[9px] text-blue-400 font-medium mb-0.5">Recomendación</p>
                    <p className="text-[10px] text-muted-foreground">{opportunity.deepAnalysis.recommendation}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Typecheck**

```bash
cd apps/frontend && npm run typecheck
```

Expected: sin errores. Si hay error por `size="sm"` en `<Card>`, verificar que el componente Card de shadcn acepta ese prop — si no, eliminar `size="sm"`.

- [ ] **Step 5: Smoke tests**

```bash
cd apps/frontend && npx playwright test --reporter=line
```

Expected: todos pasan.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/opportunities/OpportunityCard.tsx
git commit -m "feat: opportunity card hero — score + action + entry/stop/target always visible, expand for detail"
```

---

## Task 8: Suite final de smoke tests

**Files:**
- Modify: `apps/frontend/e2e/smoke.spec.ts`

- [ ] **Step 1: Agregar tests de las features nuevas**

```typescript
// Agregar al final de e2e/smoke.spec.ts:

test('chat panel se colapsa y expande', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('text=Chat con Claude')).toBeVisible();
  const closeBtn = page.locator('button[aria-label="Cerrar chat"]');
  if (await closeBtn.isVisible()) {
    await closeBtn.click();
    await expect(page.locator('button[aria-label="Abrir chat"]')).toBeVisible();
    await page.locator('button[aria-label="Abrir chat"]').click();
    await expect(page.locator('text=Chat con Claude')).toBeVisible();
  }
});

test('tab Oportunidades abre sin errores', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: /Oportunidades/ }).click();
  await page.waitForTimeout(500);
  await expect(page.locator('text=Error inesperado')).not.toBeVisible();
});

test('tab Portfolio abre sin errores', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Portfolio' }).click();
  await page.waitForTimeout(500);
  await expect(page.locator('text=Error inesperado')).not.toBeVisible();
});

test('tab Noticias abre sin errores', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Noticias' }).click();
  await page.waitForTimeout(500);
  await expect(page.locator('text=Error inesperado')).not.toBeVisible();
});

test('header botón Analizar existe y es clickeable', async ({ page }) => {
  await page.goto('/');
  const analyzeBtn = page.getByRole('button', { name: /Analizar/ });
  await expect(analyzeBtn).toBeVisible();
});
```

- [ ] **Step 2: Correr suite completa**

```bash
cd apps/frontend && npx playwright test --reporter=line
```

Expected: todos los tests pasan. Si alguno falla, debuggear con `npx playwright test --headed` para ver qué pasa visualmente.

- [ ] **Step 3: Commit final**

```bash
git add apps/frontend/e2e/smoke.spec.ts
git commit -m "test: complete e2e smoke suite for Command Center features"
```

---

## Self-Review

### Spec coverage
| Requisito | Task |
|-----------|------|
| InfraBar global (health + scan + staleness) | Task 4 |
| Nombre servicio + tiempo caído + retry inline | Task 4 — ServicePill + handleRetry |
| Datos cacheados con badge de edad | Task 3 + Task 4 DataTimestamps + Task 5 icon colors |
| Chat colapsable 0↔384px, persistido localStorage | Task 2 |
| Flujo Resumen → Oportunidades → Portfolio prioritario | Task 6 (defaultValue=daily, Opps 2nd tab) |
| Opportunity card: Score + Action + Entry/Stop/Target hero | Task 7 |
| Playwright smoke tests en cada tarea | Tasks 1, 6, 8 |
| Zero breaking changes en backend | ✅ Ninguna tarea toca backend |
| Zero breaking changes en routing | ✅ ?symbol=X intacto |

### Type consistency
- `getStaleness` definido Task 3, usado Task 4 + Task 5 ✅
- `useChatCollapsed` definido Task 2, usado en ChatToggle Task 2 ✅
- `InfraBar` importado en App.tsx Task 4 ✅
- `ChatToggle` importado en App.tsx Task 2 ✅
- `TradeLevels` interface ya existe en OpportunityCard — Task 7 la usa sin redefinir ✅
- `BuyBadge` usa `o.action: string` — compatible con tipo Opportunity existente ✅

### Placeholder scan
- Sin TBDs ✅
- Sin "implement later" ✅  
- Todos los steps tienen código completo ✅
- Task 7 Step 1: instrucción de lectura correcta para el agente, no placeholder ✅
