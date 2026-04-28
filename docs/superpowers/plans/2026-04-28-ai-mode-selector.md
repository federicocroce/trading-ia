# AI Mode Selector — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a modal to every pipeline/analysis CTA that lets the user choose cloud LLMs or local LM Studio before each run.

**Architecture:** The frontend intercepts every CTA with a Promise-based modal; the selected mode is passed as `aiMode` through tRPC, set as a module-level variable in `ai-router.ts` at the start of each run, and read by all `callAI*` calls to skip the cloud chain when `'local'`.

**Tech Stack:** React (shadcn Dialog, useRef for Promise resolution), tRPC (Zod), TypeScript (module-level variable in ai-router)

---

## File Map

**Create:**
- `apps/frontend/src/shared/AiModeModal.tsx` — hook + modal component

**Modify:**
- `apps/backend/src/shared/ai-router.ts` — add `setRunAiMode` export + local shortcut in `getProviderChain`
- `apps/backend/src/intelligence/intelligence.router.ts` — add `lmStudioStatus` query, `aiMode` to `generateMarketReport` and `rerunStage`
- `apps/backend/src/opportunities/opportunities.schema.ts` — add `aiMode` to `scanInput`
- `apps/backend/src/opportunities/opportunities.router.ts` — pass `aiMode` to `refreshOpportunities`
- `apps/backend/src/intelligence/pipeline.service.ts` — add `aiMode` param to public functions, call `setRunAiMode`
- `apps/backend/src/opportunities/opportunities.service.ts` — add `aiMode` to `refreshOpportunities`, call `setRunAiMode`
- `apps/frontend/src/pipeline/usePipeline.ts` — add `aiMode` to `run()` and `rerunStage()`
- `apps/frontend/src/layout/Header.tsx` — await `selectMode()` before `run()`
- `apps/frontend/src/pipeline/PipelineStatusButton.tsx` — `useAiModeModal`, async callbacks
- `apps/frontend/src/pipeline/PipelineHistoryModal.tsx` — update prop types to accept async callbacks
- `apps/frontend/src/daily/DailySummary.tsx` — await `selectMode()` before `run()`
- `apps/frontend/src/daily/MarketReportView.tsx` — await `selectMode()` before `run()`
- `apps/frontend/src/opportunities/OpportunityDashboard.tsx` — await `selectMode()` before `refresh.mutate()`

---

## Task 1: ai-router — expose `setRunAiMode`

**Files:**
- Modify: `apps/backend/src/shared/ai-router.ts`

- [ ] **Step 1: Add module variable and setter**

  Open `apps/backend/src/shared/ai-router.ts`. After the imports (before `export type AITask`), add:

  ```typescript
  let _runAiMode: 'cloud' | 'local' = 'cloud';

  export function setRunAiMode(mode: 'cloud' | 'local'): void {
    _runAiMode = mode;
  }
  ```

- [ ] **Step 2: Short-circuit `getProviderChain` for local mode**

  In `getProviderChain`, add this block immediately after the `qwen` provider definition (before the `const geminiAvailable` line):

  ```typescript
  if (_runAiMode === 'local') {
    return [qwen];
  }
  ```

  The `qwen` provider is already defined just above this point:
  ```typescript
  const qwen = {
    name: 'Qwen 3.5 9B (local)',
    fn: () => askLMStudio(userMessage, systemPrompt, Math.min(maxTokens, 4096)),
  };

  if (_runAiMode === 'local') {
    return [qwen];
  }

  const geminiAvailable = isGeminiAvailable();
  ```

- [ ] **Step 3: Type-check**

  ```bash
  npx tsc --noEmit -p apps/backend/tsconfig.json
  ```
  Expected: no errors.

- [ ] **Step 4: Commit**

  ```bash
  git add apps/backend/src/shared/ai-router.ts
  git commit -m "feat(ai-router): expose setRunAiMode for local/cloud routing"
  ```

---

## Task 2: Intelligence router — `lmStudioStatus` query + `aiMode` inputs

**Files:**
- Modify: `apps/backend/src/intelligence/intelligence.router.ts`

- [ ] **Step 1: Import `isLMStudioAvailable`**

  Find the existing imports at the top of `intelligence.router.ts` and add:

  ```typescript
  import { isLMStudioAvailable } from '../shared/lmstudio.js';
  ```

- [ ] **Step 2: Add `lmStudioStatus` query**

  Inside the router object (alongside other procedures), add:

  ```typescript
  lmStudioStatus: publicProcedure.query(async () => {
    return { available: await isLMStudioAvailable() };
  }),
  ```

- [ ] **Step 3: Add `aiMode` to `generateMarketReport`**

  Replace the existing `generateMarketReport` input schema:

  ```typescript
  // Before:
  generateMarketReport: publicProcedure
    .input(z.object({
      force: z.boolean().optional(),
      sectors: z.array(z.string()).optional(),
    }).optional())
    .mutation(async ({ input }) => {
      return checkOrRunPipeline(input?.force ?? false, input?.sectors as OpportunitySector[] | undefined);
    }),

  // After:
  generateMarketReport: publicProcedure
    .input(z.object({
      force: z.boolean().optional(),
      sectors: z.array(z.string()).optional(),
      aiMode: z.enum(['cloud', 'local']).default('cloud'),
    }).optional())
    .mutation(async ({ input }) => {
      return checkOrRunPipeline(
        input?.force ?? false,
        input?.sectors as OpportunitySector[] | undefined,
        input?.aiMode ?? 'cloud',
      );
    }),
  ```

- [ ] **Step 4: Add `aiMode` to `rerunStage`**

  Replace the existing `rerunStage` input schema:

  ```typescript
  // Before:
  rerunStage: publicProcedure
    .input(z.object({ stage: z.enum(['webSearch', 'news', 'fundamentals', 'analysis', 'report']) }))
    .mutation(async ({ input }) => {
      return rerunPipelineStage(input.stage);
    }),

  // After:
  rerunStage: publicProcedure
    .input(z.object({
      stage: z.enum(['webSearch', 'news', 'fundamentals', 'analysis', 'report']),
      aiMode: z.enum(['cloud', 'local']).default('cloud'),
    }))
    .mutation(async ({ input }) => {
      return rerunPipelineStage(input.stage, input.aiMode);
    }),
  ```

- [ ] **Step 5: Type-check**

  ```bash
  npx tsc --noEmit -p apps/backend/tsconfig.json
  ```
  Expected: errors about `checkOrRunPipeline` and `rerunPipelineStage` not accepting `aiMode` yet — that's expected, fixed in Task 4.

- [ ] **Step 6: Commit**

  ```bash
  git add apps/backend/src/intelligence/intelligence.router.ts
  git commit -m "feat(router): lmStudioStatus query + aiMode on pipeline mutations"
  ```

---

## Task 3: Opportunities schema + router — add `aiMode`

**Files:**
- Modify: `apps/backend/src/opportunities/opportunities.schema.ts`
- Modify: `apps/backend/src/opportunities/opportunities.router.ts`

- [ ] **Step 1: Add `aiMode` to `scanInput`**

  In `opportunities.schema.ts`, update `scanInput`:

  ```typescript
  // Before:
  export const scanInput = z.object({
    sectors: z.array(z.enum([
      'argentina-energy',
      'argentina-finance',
      'us-energy',
      'us-tech',
      'crypto',
    ])).optional(),
  }).optional();

  // After:
  export const scanInput = z.object({
    sectors: z.array(z.enum([
      'argentina-energy',
      'argentina-finance',
      'us-energy',
      'us-tech',
      'crypto',
    ])).optional(),
    aiMode: z.enum(['cloud', 'local']).optional().default('cloud'),
  }).optional();
  ```

- [ ] **Step 2: Pass `aiMode` in `opportunities.router.ts`**

  Replace the `refresh` mutation handler:

  ```typescript
  // Before:
  refresh: publicProcedure
    .input(scanInput)
    .mutation(async ({ input }) => {
      return refreshOpportunities(input?.sectors);
    }),

  // After:
  refresh: publicProcedure
    .input(scanInput)
    .mutation(async ({ input }) => {
      return refreshOpportunities(input?.sectors, input?.aiMode ?? 'cloud');
    }),
  ```

- [ ] **Step 3: Type-check**

  ```bash
  npx tsc --noEmit -p apps/backend/tsconfig.json
  ```
  Expected: error about `refreshOpportunities` not accepting `aiMode` yet — fixed in Task 5.

- [ ] **Step 4: Commit**

  ```bash
  git add apps/backend/src/opportunities/opportunities.schema.ts apps/backend/src/opportunities/opportunities.router.ts
  git commit -m "feat(opportunities): add aiMode to scan schema and refresh router"
  ```

---

## Task 4: pipeline.service — accept and set `aiMode`

**Files:**
- Modify: `apps/backend/src/intelligence/pipeline.service.ts`

- [ ] **Step 1: Import `setRunAiMode`**

  Find the imports at the top of `pipeline.service.ts` and add:

  ```typescript
  import { setRunAiMode } from '../shared/ai-router.js';
  ```

- [ ] **Step 2: Add `aiMode` to `checkOrRunPipeline`**

  Find the `checkOrRunPipeline` function signature and update it:

  ```typescript
  // Before:
  export async function checkOrRunPipeline(force = false, sectors?: OpportunitySector[]): Promise<PipelineRun>

  // After:
  export async function checkOrRunPipeline(force = false, sectors?: OpportunitySector[], aiMode: 'cloud' | 'local' = 'cloud'): Promise<PipelineRun>
  ```

  Add `setRunAiMode(aiMode);` as the first statement inside the function body (before any existing logic).

- [ ] **Step 3: Add `aiMode` to `rerunPipelineStage`**

  Find the `rerunPipelineStage` function signature and update it:

  ```typescript
  // Before:
  export async function rerunPipelineStage(
    stage: 'webSearch' | 'news' | 'fundamentals' | 'analysis' | 'report'
  ): Promise<PipelineRun>

  // After:
  export async function rerunPipelineStage(
    stage: 'webSearch' | 'news' | 'fundamentals' | 'analysis' | 'report',
    aiMode: 'cloud' | 'local' = 'cloud',
  ): Promise<PipelineRun>
  ```

  Add `setRunAiMode(aiMode);` as the first statement inside the function body.

- [ ] **Step 4: Type-check**

  ```bash
  npx tsc --noEmit -p apps/backend/tsconfig.json
  ```
  Expected: error about `refreshOpportunities` not accepting `aiMode` (fixed in Task 5), but pipeline.service itself should be clean.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/backend/src/intelligence/pipeline.service.ts
  git commit -m "feat(pipeline): thread aiMode through checkOrRunPipeline and rerunPipelineStage"
  ```

---

## Task 5: opportunities.service — accept and set `aiMode`

**Files:**
- Modify: `apps/backend/src/opportunities/opportunities.service.ts`

- [ ] **Step 1: Import `setRunAiMode`**

  Find the existing imports and add:

  ```typescript
  import { setRunAiMode } from '../shared/ai-router.js';
  ```

- [ ] **Step 2: Add `aiMode` to `refreshOpportunities`**

  The current signature (line ~856):
  ```typescript
  export async function refreshOpportunities(sectors?: OpportunitySector[]): Promise<OpportunityScanResult>
  ```

  Update to:
  ```typescript
  export async function refreshOpportunities(sectors?: OpportunitySector[], aiMode: 'cloud' | 'local' = 'cloud'): Promise<OpportunityScanResult>
  ```

  Add `setRunAiMode(aiMode);` immediately before the `runLiveScan(sectors)` call (the background fire-and-forget call, around line 878). The updated block looks like:

  ```typescript
  setRunAiMode(aiMode);
  runLiveScan(sectors)
    .then(result => { cachedResult = result; dbCacheInvalidated = false; })
    .catch(err => console.error('[opportunities] Refresh scan failed:', err))
    .finally(() => {
      scanProgress.isScanning = false;
      scanProgress.percentComplete = 100;
      scanProgress.currentStep = 'Completado';
      dbCacheInvalidated = false;
    });
  ```

- [ ] **Step 3: Full backend type-check (all errors should be resolved now)**

  ```bash
  npx tsc --noEmit -p apps/backend/tsconfig.json
  ```
  Expected: no errors.

- [ ] **Step 4: Commit**

  ```bash
  git add apps/backend/src/opportunities/opportunities.service.ts
  git commit -m "feat(opportunities): add aiMode to refreshOpportunities, set before scan"
  ```

---

## Task 6: Frontend — `AiModeModal` component + `useAiModeModal` hook

**Files:**
- Create: `apps/frontend/src/shared/AiModeModal.tsx`

- [ ] **Step 1: Create the file**

  ```typescript
  // apps/frontend/src/shared/AiModeModal.tsx
  import { useRef, useState, useCallback } from 'react';
  import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
  import { trpc } from '@/shared/trpc';

  export type AiMode = 'cloud' | 'local';

  interface ModalProps {
    open: boolean;
    lmAvailable: boolean;
    lmChecking: boolean;
    onSelect: (mode: AiMode) => void;
  }

  function AiModeModalUI({ open, lmAvailable, lmChecking, onSelect }: ModalProps) {
    return (
      <Dialog open={open} onOpenChange={() => {}}>
        <DialogContent
          className="sm:max-w-sm"
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">¿Dónde ejecutar el análisis?</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 mt-2">
            <button
              onClick={() => onSelect('cloud')}
              className="flex flex-col items-center gap-2 rounded-lg border border-border p-4 hover:bg-accent transition-colors text-left"
            >
              <span className="text-2xl">☁️</span>
              <span className="text-sm font-medium">Nube</span>
              <span className="text-[10px] text-muted-foreground">Gemini · DeepSeek · Groq</span>
            </button>
            <button
              onClick={() => onSelect('local')}
              disabled={!lmAvailable && !lmChecking}
              className="flex flex-col items-center gap-2 rounded-lg border border-border p-4 hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span className="text-2xl">🖥️</span>
              <span className="text-sm font-medium">Local</span>
              <span className="text-[10px] text-muted-foreground">LM Studio · Qwen 9B</span>
              {lmChecking ? (
                <span className="text-[9px] text-muted-foreground animate-pulse">Verificando...</span>
              ) : (
                <span className={`text-[9px] ${lmAvailable ? 'text-green-400' : 'text-red-400'}`}>
                  {lmAvailable ? '● Online' : '● Offline'}
                </span>
              )}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  export function useAiModeModal() {
    const [open, setOpen] = useState(false);
    const resolveRef = useRef<((mode: AiMode) => void) | null>(null);

    const lmStatus = trpc.intelligence.lmStudioStatus.useQuery(undefined, {
      enabled: open,
      staleTime: 0,
      retry: false,
    });

    const selectMode = useCallback((): Promise<AiMode> => {
      return new Promise((resolve) => {
        resolveRef.current = resolve;
        setOpen(true);
      });
    }, []);

    const handleSelect = useCallback((mode: AiMode) => {
      setOpen(false);
      resolveRef.current?.(mode);
      resolveRef.current = null;
    }, []);

    const modal = (
      <AiModeModalUI
        open={open}
        lmAvailable={lmStatus.data?.available ?? false}
        lmChecking={lmStatus.isLoading && open}
        onSelect={handleSelect}
      />
    );

    return { selectMode, modal };
  }
  ```

- [ ] **Step 2: Type-check frontend**

  ```bash
  npx tsc --noEmit -p apps/frontend/tsconfig.json
  ```
  Expected: no errors.

- [ ] **Step 3: Commit**

  ```bash
  git add apps/frontend/src/shared/AiModeModal.tsx
  git commit -m "feat(ui): AiModeModal component + useAiModeModal hook"
  ```

---

## Task 7: `usePipeline` — add `aiMode` to `run()` and `rerunStage()`

**Files:**
- Modify: `apps/frontend/src/pipeline/usePipeline.ts`

- [ ] **Step 1: Update `run` and `rerunStage` signatures**

  In `usePipeline.ts`, update lines 56–57:

  ```typescript
  // Before:
  run: (force = false, sectors?: string[]) => runMutation.mutate({ force, sectors }),
  rerunStage: (stage: 'webSearch' | 'news' | 'fundamentals' | 'analysis' | 'report') => rerunMutation.mutate({ stage }),

  // After:
  run: (force = false, sectors?: string[], aiMode: 'cloud' | 'local' = 'cloud') =>
    runMutation.mutate({ force, sectors, aiMode }),
  rerunStage: (stage: 'webSearch' | 'news' | 'fundamentals' | 'analysis' | 'report', aiMode: 'cloud' | 'local' = 'cloud') =>
    rerunMutation.mutate({ stage, aiMode }),
  ```

- [ ] **Step 2: Type-check frontend**

  ```bash
  npx tsc --noEmit -p apps/frontend/tsconfig.json
  ```
  Expected: no errors (existing callers default to `'cloud'` via the default param).

- [ ] **Step 3: Commit**

  ```bash
  git add apps/frontend/src/pipeline/usePipeline.ts
  git commit -m "feat(usePipeline): add aiMode param to run() and rerunStage()"
  ```

---

## Task 8: CTAs — wire `useAiModeModal` to all 6 buttons

**Files:**
- Modify: `apps/frontend/src/layout/Header.tsx`
- Modify: `apps/frontend/src/pipeline/PipelineHistoryModal.tsx`
- Modify: `apps/frontend/src/pipeline/PipelineStatusButton.tsx`
- Modify: `apps/frontend/src/daily/DailySummary.tsx`
- Modify: `apps/frontend/src/daily/MarketReportView.tsx`
- Modify: `apps/frontend/src/opportunities/OpportunityDashboard.tsx`

- [ ] **Step 1: Update `PipelineHistoryModal.tsx` prop types**

  `onRerunAll` and `onRerunStage` callbacks will be async. TypeScript accepts `() => Promise<void>` where `() => void` is expected (return value unused), but update the Props interface to be explicit:

  ```typescript
  // In the Props interface (around line 119-122), update:
  onRerunAll: () => void | Promise<void>;
  onRerunStage: (stage: 'webSearch' | 'news' | 'fundamentals' | 'analysis' | 'report') => void | Promise<void>;
  ```

- [ ] **Step 2: Update `PipelineStatusButton.tsx`**

  Add `useAiModeModal` import and use it. Current relevant code (line 34 and 59-60):

  ```typescript
  // Add import at top:
  import { useAiModeModal } from '@/shared/AiModeModal';

  // Inside the component, after existing hooks:
  const { selectMode, modal } = useAiModeModal();

  // Replace the onRerunAll and onRerunStage props (lines 59-60):
  // Before:
  onRerunStage={rerunStage}
  onRerunAll={() => run(false)}

  // After:
  onRerunStage={async (stage) => {
    const mode = await selectMode();
    rerunStage(stage, mode);
  }}
  onRerunAll={async () => {
    const mode = await selectMode();
    run(false, undefined, mode);
  }}

  // Add modal to the component's JSX return (alongside the existing PipelineHistoryModal):
  {modal}
  ```

- [ ] **Step 3: Update `Header.tsx`**

  Add `useAiModeModal` import and update the Noticias button onClick:

  ```typescript
  // Add import:
  import { useAiModeModal } from '@/shared/AiModeModal';

  // Inside the component, after existing hooks:
  const { selectMode, modal } = useAiModeModal();

  // Replace the button onClick (currently line 65):
  // Before:
  onClick={() => run(true, selectedPreset.sectors)}

  // After:
  onClick={async () => {
    const mode = await selectMode();
    run(true, selectedPreset.sectors, mode);
  }}

  // Add modal to JSX return:
  {modal}
  ```

- [ ] **Step 4: Update `DailySummary.tsx`**

  The "Regenerar" button is inside the `MarketDigestPanel` component in this file. Find where `run` and `isRunning` come from (they come from `usePipeline`) and add `useAiModeModal`:

  ```typescript
  // Add import:
  import { useAiModeModal } from '@/shared/AiModeModal';

  // Inside the component that has the Regenerar button, after existing hooks:
  const { selectMode, modal } = useAiModeModal();

  // Replace onClick (currently: onClick={() => run()}):
  onClick={async () => {
    const mode = await selectMode();
    run(false, undefined, mode);
  }}

  // Add modal to that component's JSX return:
  {modal}
  ```

- [ ] **Step 5: Update `MarketReportView.tsx`**

  Find the "Generar reporte" button and apply the same pattern:

  ```typescript
  // Add import:
  import { useAiModeModal } from '@/shared/AiModeModal';

  // Inside the component, after existing hooks:
  const { selectMode, modal } = useAiModeModal();

  // Replace onClick (currently: onClick={() => run()}):
  onClick={async () => {
    const mode = await selectMode();
    run(false, undefined, mode);
  }}

  // Add modal to JSX:
  {modal}
  ```

- [ ] **Step 6: Update `OpportunityDashboard.tsx`**

  Find the `refresh.mutate({})` call and apply the same pattern:

  ```typescript
  // Add import:
  import { useAiModeModal } from '@/shared/AiModeModal';

  // Inside the component, after existing hooks:
  const { selectMode, modal } = useAiModeModal();

  // Replace onClick (currently: onClick={() => refresh.mutate({})}):
  onClick={async () => {
    const mode = await selectMode();
    refresh.mutate({ aiMode: mode });
  }}

  // Add modal to JSX:
  {modal}
  ```

- [ ] **Step 7: Full type-check**

  ```bash
  npx tsc --noEmit -p apps/frontend/tsconfig.json && npx tsc --noEmit -p apps/backend/tsconfig.json
  ```
  Expected: no errors.

- [ ] **Step 8: Start dev server and verify manually**

  ```bash
  npm run dev
  ```

  Verify:
  1. Click "Noticias" in header → modal appears with ☁️ Nube and 🖥️ Local cards
  2. Local card shows "Verificando..." briefly, then "● Online" (green) or "● Offline" (red)
  3. If Offline: Local button is disabled
  4. Click Nube → modal closes, pipeline starts with cloud models
  5. Click any other CTA ("Re-correr todo", "Re-correr ▶", "Regenerar", "Generar reporte", "Recalcular") → same modal appears each time
  6. Click outside modal or press Escape → modal stays open (must choose)

- [ ] **Step 9: Commit**

  ```bash
  git add apps/frontend/src/layout/Header.tsx \
          apps/frontend/src/pipeline/PipelineStatusButton.tsx \
          apps/frontend/src/pipeline/PipelineHistoryModal.tsx \
          apps/frontend/src/daily/DailySummary.tsx \
          apps/frontend/src/daily/MarketReportView.tsx \
          apps/frontend/src/opportunities/OpportunityDashboard.tsx
  git commit -m "feat(ui): wire AiModeModal to all pipeline/analysis CTAs"
  ```
