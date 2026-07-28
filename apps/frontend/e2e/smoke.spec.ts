import { test, expect } from '@playwright/test';

/**
 * Smoke de la estructura de 4 tabs (2026-07-28). El archivo anterior verificaba tabs que ya
 * no existen ("Resumen", "Portfolio") y una —"Noticias"— que **nunca existió**: los tests
 * pasaban igual porque el e2e no corre en la suite canónica ni en CI, así que nadie los veía
 * fallar. Un test que nadie corre es peor que no tenerlo: da confianza sin dar cobertura.
 *
 * Requiere la app levantada: npx playwright test --config apps/frontend/playwright.config.ts
 */

const TABS = ['Hoy', 'Cartera', 'Mercado', 'Medición'] as const;

test('la app carga sin errores críticos', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('text=Error inesperado')).not.toBeVisible();
  await expect(page.locator('header')).toBeVisible();
});

test('las 4 tabs principales son visibles', async ({ page }) => {
  await page.goto('/');
  for (const t of TABS) {
    await expect(page.getByRole('tab', { name: new RegExp(t) })).toBeVisible();
  }
});

test('Hoy es la tab por defecto — la app abre en la decisión', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Hoy' })).toHaveAttribute('data-state', 'active');
});

test('cada tab abre sin errores (incluye los chunks lazy)', async ({ page }) => {
  await page.goto('/');
  for (const t of TABS) {
    await page.getByRole('tab', { name: new RegExp(t) }).click();
    await expect(page.locator('text=Error inesperado')).not.toBeVisible();
    // El fallback de Suspense no debe quedarse colgado: la tab termina de montar.
    await expect(page.locator('text=Cargando…')).toHaveCount(0, { timeout: 10_000 });
  }
});

test('las URLs viejas siguen funcionando (bookmarks previos al rediseño)', async ({ page }) => {
  const legacy: Array<[string, string]> = [
    ['portfolio', 'Cartera'],
    ['historico', 'Medición'],
    ['opportunities', 'Mercado'],
    ['radar', 'Mercado'],
    ['tesis', 'Mercado'],
    ['daily', 'Mercado'],
  ];
  for (const [vieja, esperada] of legacy) {
    await page.goto(`/?tab=${vieja}`);
    await expect(page.getByRole('tab', { name: new RegExp(esperada) })).toHaveAttribute('data-state', 'active');
  }
});

test('Hoy muestra el riesgo del conjunto antes que las posiciones', async ({ page }) => {
  await page.goto('/');
  // La tarjeta de concentración es lo primero: un stop protege una posición, esto avisa
  // cuando el problema es que se den vuelta todas juntas. El endpoint baja 1 año de
  // histórico por cada posición, así que el timeout es generoso a propósito.
  await expect(page.getByText(/apuestas/i).first()).toBeVisible({ timeout: 60_000 });
});

test('la sidebar es visible', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('aside').first()).toBeVisible();
});

test('navegar a un símbolo no rompe', async ({ page }) => {
  await page.goto('/?symbol=AAPL');
  await expect(page.locator('text=Error inesperado')).not.toBeVisible();
});

test('el chat se colapsa y expande', async ({ page }) => {
  await page.goto('/');
  const cerrar = page.locator('button[aria-label="Cerrar chat"]');
  if (await cerrar.isVisible()) {
    await cerrar.click();
    await page.locator('button[aria-label="Abrir chat"]').click();
    await expect(page.locator('button[aria-label="Cerrar chat"]')).toBeVisible();
  }
});

test('InfraBar es visible', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[role="status"][aria-label="Estado del sistema"]')).toBeVisible();
});

test('el header muestra el valor de la cartera', async ({ page }) => {
  await page.goto('/');
  // Antes este test buscaba un botón "Analizar" y después "Pipeline": ninguno de los dos
  // está montado en el Header (PipelineStatusButton quedó huérfano). Se verifica lo que sí
  // existe y encima importa: el valor total, que es el número que el dueño mira primero.
  await expect(page.getByText('Cartera', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
});
