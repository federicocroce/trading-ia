# AI Mode Selector — Design Spec
Date: 2026-04-28

## Problem
Every LLM call consumes cloud tokens (Gemini/OpenRouter/Groq). During iteration/testing the user wants to run the full pipeline against LM Studio (local Qwen 9B) without touching cloud quotas.

## Solution
A modal that intercepts every analysis/pipeline CTA and asks the user to choose cloud or local before the call fires. The choice is passed as `aiMode: 'cloud' | 'local'` through the tRPC layer and threaded to `callAIWithModel` in the ai-router.

---

## Frontend

### `useAiModeModal` hook
- Exposes `selectMode(): Promise<'cloud' | 'local'>` and a `<AiModeModal />` component to mount.
- Internally manages open state and resolves the promise when the user clicks a card.
- No dismiss via overlay click or Escape — user must pick one option.

### `AiModeModal` component
- Two large cards: **☁️ Nube** (Gemini + DeepSeek + Groq) and **🖥️ Local** (LM Studio Qwen 9B).
- On open: fires `trpc.intelligence.lmStudioStatus` query with 2s timeout.
  - If available: Local card enabled with green badge "● Online".
  - If unavailable: Local card disabled with tooltip "LM Studio no responde en localhost:1234".
- No close button. No click-outside-to-close.
- Rendered at the app root level (via portal) so it works from any CTA.

### CTAs updated (6 total)
| File | CTA |
|------|-----|
| `Header.tsx` | "Noticias" button |
| `PipelineHistoryModal.tsx` | "Re-correr todo" |
| `PipelineHistoryModal.tsx` | "Re-correr ▶" (per-stage) |
| `DailySummary.tsx` | "Regenerar" |
| `MarketReportView.tsx` | Refresh button |
| `OpportunityDashboard.tsx` | Refresh button |

Pattern for each CTA:
```tsx
const { selectMode, AiModeModal } = useAiModeModal();

const handleClick = async () => {
  const mode = await selectMode();
  mutation({ ...existingParams, aiMode: mode });
};
```

---

## Backend — tRPC layer

### New query: `intelligence.lmStudioStatus`
- Calls `isLMStudioAvailable()` from `lmstudio.ts`.
- Returns `{ available: boolean }`.
- No caching — called fresh each time the modal opens.

### Updated mutation inputs
- `intelligence.generateMarketReport`: add `aiMode: z.enum(['cloud', 'local'])`
- `intelligence.rerunStage`: add `aiMode: z.enum(['cloud', 'local'])`
- `opportunities.refresh`: add `aiMode: z.enum(['cloud', 'local'])`

---

## Backend — Pipeline threading

### `pipeline.service.ts`
- Module-level variable: `let _currentRunAiMode: 'cloud' | 'local' = 'cloud'`
- `checkOrRunPipeline(force, sectors, aiMode)` sets `_currentRunAiMode = aiMode` at start.
- `rerunPipelineStage(stage, aiMode)` same.
- All private stage runners (`runAnalysisStage`, `runReportStage`, `runMacroIntelligenceStage`, etc.) read `_currentRunAiMode` and pass it to `callAIWithModel` / `callAI` / `callAIText`.
- Safe because pipeline runs are sequential (single user, no concurrency).

### `opportunities.service.ts`
- `runOpportunityAnalysis(aiMode)` passes `aiMode` down to all `callAIWithModel` calls.

---

## Backend — AI Router

### `ai-router.ts`
Add optional `aiMode?: 'cloud' | 'local'` param to:
- `callAI(task, userMessage, systemPrompt, maxTokens, aiMode?)`
- `callAIWithModel(task, userMessage, systemPrompt, maxTokens, aiMode?)`
- `callAIText(task, userMessage, systemPrompt, maxTokens, aiMode?)`

Logic:
```
if aiMode === 'local':
  → skip cloud chain entirely
  → call askLMStudio directly
  → throw if LM Studio unavailable (no silent fallback to cloud)

else (cloud or undefined):
  → existing behavior: Gemini → OpenRouter → Groq → LMStudio fallback
```

When `aiMode === 'local'`, if LM Studio fails mid-pipeline the error propagates normally as a `criticalError` on that stage — no special handling needed.

---

## Data Flow

```
click CTA
  → selectMode()                         # modal opens
  → user picks 'cloud' | 'local'
  → modal resolves
  → mutation({ ...params, aiMode })
  → router (z.enum validation)
  → checkOrRunPipeline(force, sectors, aiMode)
  → _currentRunAiMode = aiMode
  → runAnalysisStage() → callAIWithModel(task, ..., _currentRunAiMode)
  → runReportStage()  → callAIWithModel(task, ..., _currentRunAiMode)
  → ai-router: local → askLMStudio
               cloud → Gemini → OpenRouter → Groq → LMStudio fallback
```

---

## Out of scope
- Persisting the last choice (user wants modal always)
- Per-stage mode override (all stages use the same mode per run)
- Any UI changes beyond the modal and status badge
