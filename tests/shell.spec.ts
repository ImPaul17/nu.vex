import { test, expect } from '@playwright/test';

test('local messages stay isolated by channel, render untrusted text safely and reset on reload', async ({ page }) => {
  await page.goto('/demo');
  await expect(page.getByRole('heading', { name: 'general', exact: true })).toBeVisible();
  const composer = page.getByRole('textbox', { name: 'Escribir mensaje' });
  const content = '<img src=x onerror=alert(1)> Hola desde una prueba';
  await composer.fill(content);
  await composer.press('Enter');
  await expect(page.getByText(content, { exact: true })).toBeVisible();
  await expect(page.locator('.message-body img')).toHaveCount(0);
  await page.getByRole('button', { name: 'bienvenida', exact: true }).click();
  await expect(page.getByText(content, { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'general', exact: true }).click();
  await expect(page.getByText(content, { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Buscar mensajes en este canal' }).fill('una prueba');
  await expect(page.locator('.message')).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'general', exact: true })).toBeVisible();
  await expect(page.getByText(content, { exact: true })).toHaveCount(0);
});

test('theme import/export is data only; preferences persist and modal focus returns', async ({ page }) => {
  await page.goto('/demo');
  const trigger = page.getByRole('button', { name: /Un espacio más tuyo/ });
  await trigger.click();
  await page.getByRole('button', { name: /Medianoche/ }).click();
  await expect(page.locator('.app')).toHaveAttribute('data-theme', 'midnight');
  await page.getByLabel('Color de acento', { exact: true }).fill('#000000');
  await expect(page.getByRole('button', { name: 'Exportar', exact: true })).toHaveCSS('color', 'rgb(255, 255, 255)');
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await page.reload();
  await expect(page.locator('.app')).toHaveAttribute('data-theme', 'midnight');
  await trigger.click();
  await page.getByLabel('Importar archivo de tema JSON').setInputFiles({ name: 'unsafe.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ version: 1, theme: 'emerald', accent: 'url(https://example.com)', glass: .5, radius: 12, density: 'comfortable' })) });
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('.app')).toHaveAttribute('data-theme', 'midnight');
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar', exact: true }).click();
  expect((await downloadEvent).suggestedFilename()).toBe('nuvex-theme.json');
});

test('community and channel creation work locally, emoji closes with keyboard, empty replies cannot send', async ({ page }) => {
  await page.goto('/demo');
  await expect(page.locator('.message')).toHaveCount(6);
  const count = await page.locator('.message').count();
  await page.getByRole('button', { name: 'Responder a Elena' }).first().click({ force: true });
  await page.getByRole('textbox', { name: 'Escribir mensaje' }).press('Enter');
  await expect(page.locator('.message')).toHaveCount(count);
  await page.getByRole('button', { name: 'Cancelar respuesta' }).click();
  await page.getByRole('button', { name: 'Elegir emoji' }).click();
  await page.getByRole('button', { name: 'Insertar 💚' }).focus();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Elegir emoji' })).toBeFocused();
  await page.getByRole('button', { name: 'Crear comunidad', exact: true }).click();
  await page.getByLabel('Nombre de la comunidad').fill('Nuestro jardín');
  await page.getByRole('button', { name: 'Crear comunidad local', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Comunidad Nuestro jardín', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Crear canal', exact: true }).click();
  await page.getByLabel('Nombre del canal', { exact: true }).fill('nuevas-ideas');
  await page.getByRole('button', { name: 'Crear canal local', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'nuevas-ideas', exact: true })).toBeVisible();
});

test('desktop shell loads local branding and fonts without runtime exceptions', async ({ page }) => {
  const exceptions: string[] = [];
  page.on('pageerror', (error) => exceptions.push(error.message));
  await page.goto('/demo');
  await expect(page.getByRole('heading', { name: 'Un lugar para decir hola.' })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check('400 16px "Geist"'))).toBeTruthy();
  expect(await page.locator('.app-topbar img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBeTruthy();
  await page.screenshot({ path: 'test-results/desktop.png', fullPage: true });
  expect(exceptions).toEqual([]);
});

test('mobile layout keeps chat visible and channels keyboard accessible without page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/demo');
  await expect(page.getByRole('textbox', { name: 'Escribir mensaje' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Miembros de demostración' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Mostrar canales' }).click();
  await expect(page.locator('.community-heading')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: 'Ajustes de cuenta' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('.community-heading')).toBeFocused();
  await page.getByRole('button', { name: 'bienvenida', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'bienvenida', exact: true })).toBeVisible();
  await expect(page.locator('#conversation')).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
});

test('concentración, categorías y los tres temas mantienen el chat utilizable', async ({ page }) => {
  await page.goto('/demo');
  await page.getByRole('button', { name: 'COMUNIDAD', exact: true }).click();
  await expect(page.getByRole('button', { name: 'bienvenida', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'COMUNIDAD', exact: true }).click();
  await expect(page.getByRole('button', { name: 'bienvenida', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Modo concentración', exact: true }).click();
  await expect(page.locator('.channel-sidebar')).toBeHidden();
  await page.getByRole('textbox', { name: 'Escribir mensaje' }).fill('Hola sin distracciones');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Hola sin distracciones', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Mostrar navegación', exact: true }).click();
  await expect(page.locator('.channel-sidebar')).toBeVisible();
  for (const [theme, label] of [['emerald', 'Bosque'], ['midnight', 'Medianoche'], ['light', 'Luz de día']]) {
    await page.getByRole('button', { name: /Un espacio más tuyo/ }).click();
    await page.getByRole('button', { name: new RegExp(label) }).click();
    await page.keyboard.press('Escape');
    await expect(page.locator('.app')).toHaveAttribute('data-theme', theme);
    await expect(page.getByRole('textbox', { name: 'Escribir mensaje' })).toBeVisible();
    await page.screenshot({ path: `test-results/tema-${theme}.png`, fullPage: true });
  }
});
