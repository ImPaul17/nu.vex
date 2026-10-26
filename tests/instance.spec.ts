import { test, expect, type Page } from '@playwright/test';

test('cambiar entre dos instancias conserva sesiones sin mezclar mensajes y cierra solo la cuenta actual', async ({ page, context, baseURL }) => {
  const otherOrigin = process.env.NUVEX_E2E_SECOND_INSTANCE;
  test.skip(!otherOrigin, 'Requiere una segunda instancia con una base PostgreSQL independiente.');
  const id = Date.now().toString(36);
  const accounts = [];
  for (const [index, address] of [baseURL!, otherOrigin!].entries()) {
    const registered = await context.request.post(`${address}/api/v1/auth/register`, {
      headers: { Origin: new URL(baseURL!).origin },
      data: { email: `multi.${id}.${index}@example.test`, handle: `multi_${id}_${index}`, displayName: `Cuenta ${index}`, password: `Test-multi-${id}!`, ...(index ? { transport: 'bearer' } : {}) }
    });
    expect(registered.status()).toBe(201);
    const data = await registered.json();
    const headers = { Origin: new URL(baseURL!).origin, ...(index ? { Authorization: `Bearer ${data.accessToken}` } : {}) };
    const created = await context.request.post(`${address}/api/v1/communities`, { headers, data: { name: `Comunidad ${index}` } });
    expect(created.status()).toBe(201);
    const community = (await created.json()).community;
    const sent = await context.request.post(`${address}/api/v1/channels/${community.channels[0].id}/messages`, {
      headers, data: { clientId: crypto.randomUUID(), content: `Mensaje privado instancia ${index} ${id}` }
    });
    expect(sent.status()).toBe(201);
    accounts.push({ ...data, address });
  }
  await page.goto('/');
  await expect(page.getByText(`Mensaje privado instancia 0 ${id}`, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cambiar de instancia', exact: true }).click();
  await page.getByLabel('Añadir otra instancia').fill(otherOrigin!);
  await page.getByRole('button', { name: 'Conectar', exact: true }).click();
  await page.getByLabel('Correo electrónico', { exact: true }).fill(`multi.${id}.1@example.test`);
  await page.getByLabel('Contraseña', { exact: true }).fill(`Test-multi-${id}!`);
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await expect(page.getByText(`Mensaje privado instancia 1 ${id}`, { exact: true })).toBeVisible();
  await expect(page.getByText(`Mensaje privado instancia 0 ${id}`, { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Cambiar de instancia', exact: true }).click();
  await page.getByRole('button', { name: /Sesión de Cuenta 0/ }).click();
  await expect(page.getByText(`Mensaje privado instancia 0 ${id}`, { exact: true })).toBeVisible();
  await expect(page.getByText(`Mensaje privado instancia 1 ${id}`, { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Cambiar de instancia', exact: true }).click();
  await page.getByRole('button', { name: /Sesión de Cuenta 1/ }).click();
  await expect(page.getByText(`Mensaje privado instancia 1 ${id}`, { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/instancias.png', fullPage: true });
  await page.getByRole('button', { name: 'Abrir ajustes', exact: true }).click();
  await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'De vuelta con tu equipo.' })).toBeVisible();
  await page.getByRole('button', { name: 'Cambiar', exact: true }).click();
  await page.locator('.saved-instance-button').filter({ hasText: new URL(baseURL!).origin }).click();
  await expect(page.getByText(`Mensaje privado instancia 0 ${id}`, { exact: true })).toBeVisible();
  const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  for (const account of accounts) if (account.accessToken) expect(storage).not.toContain(account.accessToken);
});

test('two real accounts exchange durable messages with isolated sessions and realtime delivery', async ({ browser }) => {
  const id = Date.now().toString(36);
  const alpha = await browser.newContext(); const beta = await browser.newContext();
  const alice = await alpha.newPage(); const bob = await beta.newPage();
  const exceptions: string[] = [];
  for (const page of [alice, bob]) page.on('pageerror', (error) => exceptions.push(error.message));
  async function register(page: Page, name: string, suffix: string) {
    await page.goto('/');
    await page.getByRole('button', { name: 'Crear una cuenta', exact: true }).click();
    await page.getByLabel('Nombre visible', { exact: true }).fill(name);
    await page.getByLabel('Nombre de usuario', { exact: true }).fill(`test_${id}_${suffix}`);
    await page.getByLabel('Correo electrónico', { exact: true }).fill(`${id}.${suffix}@example.test`);
    await page.getByLabel('Contraseña', { exact: true }).fill(`Test-${id}-password!`);
    await page.getByRole('button', { name: 'Crear cuenta', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Tu primer espacio.' })).toBeVisible();
  }
  try {
    await register(alice, 'Alice', 'a');
    await alice.getByLabel('Nombre de la comunidad', { exact: true }).fill(`Equipo ${id}`);
    await alice.locator('.entry-form').getByRole('button', { name: 'Crear comunidad', exact: true }).click();
    await expect(alice.getByRole('heading', { name: 'general', exact: true })).toBeVisible();
    await alice.locator('.community-heading').click();
    await alice.getByRole('button', { name: 'Invitar al equipo', exact: true }).click();
    await alice.getByRole('button', { name: 'Generar invitación', exact: true }).click();
    const code = await alice.getByLabel('Código de invitación', { exact: true }).inputValue();
    expect(code.length).toBeGreaterThanOrEqual(32);
    await alice.keyboard.press('Escape');
    await register(bob, 'Bob', 'b');
    await bob.getByRole('button', { name: 'Tengo una invitación', exact: true }).click();
    await bob.getByLabel('Código de invitación', { exact: true }).fill(code);
    await bob.getByRole('button', { name: 'Unirme a la comunidad', exact: true }).click();
    await expect(bob.getByRole('heading', { name: 'general', exact: true })).toBeVisible();
    const first = `Hola Bob ${id} <img src=x onerror=alert(1)>`;
    await alice.getByRole('textbox', { name: 'Escribir mensaje' }).fill(first);
    await alice.getByRole('button', { name: 'Enviar mensaje', exact: true }).click();
    await expect(alice.getByText(first, { exact: true })).toBeVisible();
    await expect(bob.getByText(first, { exact: true })).toBeVisible();
    await expect(bob.locator('.message-body img')).toHaveCount(0);
    const reply = `Hola Alice ${id}`;
    await bob.getByRole('textbox', { name: 'Escribir mensaje' }).fill(reply);
    await bob.getByRole('button', { name: 'Enviar mensaje', exact: true }).click();
    await expect(alice.getByText(reply, { exact: true })).toBeVisible();
    await alice.reload(); await bob.reload();
    await expect(alice.getByText(first, { exact: true })).toBeVisible();
    await expect(bob.getByText(reply, { exact: true })).toBeVisible();
    await expect(alice.getByText(reply, { exact: true })).toBeVisible();
    await alice.screenshot({ path: 'test-results/instance-live.png', fullPage: true });
    await bob.getByRole('textbox', { name: 'Escribir mensaje' }).fill(`Mensaje eliminable ${id}`);
    await bob.getByRole('button', { name: 'Enviar mensaje', exact: true }).click();
    const deletable = bob.locator('.message').filter({ hasText: `Mensaje eliminable ${id}` });
    await expect(deletable).toBeVisible(); await deletable.hover();
    await deletable.getByRole('button', { name: 'Eliminar mensaje', exact: true }).click();
    await expect(alice.getByText(`Mensaje eliminable ${id}`, { exact: true })).toHaveCount(0);
    await bob.getByRole('button', { name: 'Abrir ajustes', exact: true }).click();
    await bob.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
    await expect(bob.getByRole('heading', { name: 'De vuelta con tu equipo.' })).toBeVisible();
    await bob.reload(); await expect(bob.getByRole('heading', { name: 'De vuelta con tu equipo.' })).toBeVisible();
    await expect(alice.getByText(first, { exact: true })).toBeVisible();
    await bob.getByLabel('Correo electrónico', { exact: true }).fill(`${id}.b@example.test`);
    await bob.getByLabel('Contraseña', { exact: true }).fill(`Test-${id}-password!`);
    await bob.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
    await expect(bob.getByText(first, { exact: true })).toBeVisible();
    const afterLogin = `Sesión recuperada ${id}`;
    await bob.getByRole('textbox', { name: 'Escribir mensaje' }).fill(afterLogin);
    await bob.getByRole('button', { name: 'Enviar mensaje', exact: true }).click();
    await expect(alice.getByText(afterLogin, { exact: true })).toBeVisible();
    if (process.env.NUVEX_E2E_REMOTE_URL) {
      await bob.getByRole('button', { name: 'Abrir ajustes', exact: true }).click();
      await bob.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
      await bob.getByRole('button', { name: 'Cambiar', exact: true }).click();
      await bob.getByLabel('Dirección de la instancia', { exact: true }).fill(process.env.NUVEX_E2E_REMOTE_URL);
      await bob.getByRole('button', { name: 'Conectar a la instancia', exact: true }).click();
      await expect(bob.getByRole('heading', { name: 'De vuelta con tu equipo.' })).toBeVisible();
      await bob.getByLabel('Correo electrónico', { exact: true }).fill(`${id}.b@example.test`);
      await bob.getByLabel('Contraseña', { exact: true }).fill(`Test-${id}-password!`);
      const remoteLogin = bob.waitForResponse((response) => response.url() === `${process.env.NUVEX_E2E_REMOTE_URL}/api/v1/auth/login` && response.request().method() === 'POST');
      await bob.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
      const credentials = await (await remoteLogin).json() as { accessToken: string };
      expect(credentials.accessToken.length).toBeGreaterThanOrEqual(32);
      await expect(bob.getByText(first, { exact: true })).toBeVisible();
      const remoteMessage = `Desde otra instancia web ${id}`;
      await bob.getByRole('textbox', { name: 'Escribir mensaje' }).fill(remoteMessage);
      await bob.getByRole('button', { name: 'Enviar mensaje', exact: true }).click();
      await expect(alice.getByText(remoteMessage, { exact: true })).toBeVisible();
      await expect(bob.locator('.composer-caption')).toContainText('historial persistente');
      const remoteReply = `Respuesta al cliente remoto ${id}`;
      await alice.getByRole('textbox', { name: 'Escribir mensaje' }).fill(remoteReply);
      await alice.getByRole('button', { name: 'Enviar mensaje', exact: true }).click();
      await expect(bob.getByText(remoteReply, { exact: true })).toBeVisible();
      const stored = await bob.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
      expect(stored).not.toContain(credentials.accessToken);
      await bob.reload();
      await expect(bob.getByRole('heading', { name: 'De vuelta con tu equipo.' })).toBeVisible();
      await expect(bob.getByRole('textbox', { name: 'Escribir mensaje' })).toHaveCount(0);
      await expect(alice.getByText(remoteMessage, { exact: true })).toBeVisible();
    }
    expect(exceptions).toEqual([]);
  } finally { await alpha.close(); await beta.close(); }
});
