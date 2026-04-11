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
