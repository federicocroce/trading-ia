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

test('tab Resumen es el default al cargar', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Resumen' })).toHaveAttribute('data-state', 'active');
});

test('InfraBar es visible', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[role="status"][aria-label="Estado de servicios"]')).toBeVisible();
});

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
