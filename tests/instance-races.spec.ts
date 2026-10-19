import { randomUUID } from 'node:crypto';
import { test, expect, type BrowserContext, type Page, type Route } from '@playwright/test';

interface Account {
  email: string;
  password: string;
  name: string;
  community: { id: string; name: string; channels: { id: string; name: string }[] };
}

interface StoredMessage { id: string; content: string; channelId: string }

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

function origin(baseURL: string | undefined): string {
  if (!baseURL) throw new Error('The instance regression suite requires a configured baseURL.');
  return new URL(baseURL).origin;
}

async function seedAccount(context: BrowserContext, baseURL: string | undefined, label: string): Promise<Account> {
  const id = randomUUID().replaceAll('-', '').slice(0, 12);
  const account = { email: `race.${id}@example.test`, password: `Regression-${randomUUID()}!`, name: `Race ${label} ${id}` };
  const registered = await context.request.post('/api/v1/auth/register', {
    headers: { Origin: origin(baseURL) },
    data: { email: account.email, password: account.password, displayName: account.name, handle: `race_${label}_${id}` }
  });
  expect(registered.status()).toBe(201);
  const created = await context.request.post('/api/v1/communities', {
    headers: { Origin: origin(baseURL) }, data: { name: `Privado ${label} ${id}` }
  });
  expect(created.status()).toBe(201);
  return { ...account, community: (await created.json()).community };
}

async function seedMessage(context: BrowserContext, baseURL: string | undefined, channelId: string, content: string): Promise<StoredMessage> {
  const response = await context.request.post(`/api/v1/channels/${channelId}/messages`, {
    headers: { Origin: origin(baseURL) }, data: { content, clientId: randomUUID() }
  });
  expect(response.status()).toBe(201);
  return (await response.json()).message;
}

async function createChannel(context: BrowserContext, baseURL: string | undefined, communityId: string, name: string) {
  const response = await context.request.post(`/api/v1/communities/${communityId}/channels`, {
    headers: { Origin: origin(baseURL) }, data: { name }
  });
  expect(response.status()).toBe(201);
  return (await response.json()).channel as { id: string; name: string };
}

async function settleClient(page: Page) {
  // Wait for fetch continuations and Svelte's subsequent render, without a fixed sleep.
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function openWorkspace(page: Page, account: Account) {
  await page.goto('/');
  await expect(page.locator('.account-profile')).toContainText(account.name);
  await expect(page.getByRole('heading', { name: 'general', exact: true })).toBeVisible();
  await expect(page.locator('.composer-caption')).toContainText('historial persistente');
  // The initial history and WebSocket resync must finish before arming a targeted race.
  await page.waitForLoadState('networkidle');
}

/** Hold one genuine successful GET response after the server has produced it. */
async function holdNextGet(page: Page, matches: (url: URL) => boolean) {
  const captured = deferred<{ body: string; status: number }>();
  const release = deferred<void>();
  const finished = deferred<void>();
  let intercepted = false;
  let failure: unknown;
  // Cleanup can happen before a test awaits captured, so keep rejected captures handled.
  void captured.promise.catch(() => undefined);
  const handler = async (route: Route) => {
    if (intercepted || route.request().method() !== 'GET') { await route.continue(); return; }
    intercepted = true;
    try {
      const response = await route.fetch();
      const body = await response.text();
      captured.resolve({ body, status: response.status() });
      await release.promise;
      await route.fulfill({ response, body });
    } catch (cause) { failure = cause; captured.reject(cause); }
    finally { finished.resolve(); }
  };
  await page.route(matches, handler);
  return {
    captured: captured.promise,
    async deliver() { release.resolve(); await finished.promise; if (failure) throw failure; await settleClient(page); },
    async dispose() { release.resolve(); await page.unroute(matches, handler); if (intercepted) await finished.promise; }
  };
}

function historyRequest(url: URL, channelId: string, earlier = false): boolean {
  return url.pathname === `/api/v1/channels/${channelId}/messages` && url.searchParams.has('before') === earlier;
}

async function trackConnections(page: Page) {
  await page.addInitScript(() => {
    const sockets = new Set<WebSocket>();
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = new Proxy(NativeWebSocket, {
      construct(target, argumentsList) {
        const connection = Reflect.construct(target, argumentsList) as WebSocket;
        // Leave Vite's development/HMR transport intact; closing it can reload the document.
        if (new URL(connection.url).pathname === '/api/v1/events') {
          sockets.add(connection);
          connection.addEventListener('close', () => sockets.delete(connection));
        }
        return connection;
      }
    });
    (window as Window & { __nuvexRaceSockets?: Set<WebSocket> }).__nuvexRaceSockets = sockets;
  });
}

async function reconnect(page: Page, channelId: string) {
  const opened = page.waitForEvent('websocket', { predicate: (socket) => new URL(socket.url()).pathname === '/api/v1/events' });
  const history = page.waitForResponse((response) => response.request().method() === 'GET' && historyRequest(new URL(response.url()), channelId) && response.ok());
  const closed = await page.evaluate(() => {
    const sockets = (window as Window & { __nuvexRaceSockets?: Set<WebSocket> }).__nuvexRaceSockets;
    let count = 0;
    for (const socket of sockets ?? []) {
      if (socket.readyState === WebSocket.OPEN) { socket.close(1000, 'Regression: reconnect'); count += 1; }
    }
    return count;
  });
  expect(closed).toBeGreaterThan(0);
  await Promise.all([opened, history]);
  await expect(page.locator('.composer-caption')).toContainText('historial persistente');
  await settleClient(page);
}

test('a delayed real history response cannot resurrect a message deleted through realtime', async ({ page, context, baseURL }) => {
  const account = await seedAccount(context, baseURL, 'delete');
  const general = account.community.channels[0];
  const other = await createChannel(context, baseURL, account.community.id, 'otro-canal');
  const deleted = await seedMessage(context, baseURL, general.id, `Borrar durante carga ${randomUUID()}`);
  await openWorkspace(page, account);
  await expect(page.getByText(deleted.content, { exact: true })).toBeVisible();
  const held = await holdNextGet(page, (url) => historyRequest(url, general.id));
  try {
    await page.locator('.channel-sidebar').getByRole('button', { name: other.name, exact: true }).click();
    await expect(page.getByRole('heading', { name: other.name, exact: true })).toBeVisible();
    await page.locator('.channel-sidebar').getByRole('button', { name: general.name, exact: true }).click();
    const response = await held.captured;
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body).messages.some((item: StoredMessage) => item.id === deleted.id)).toBe(true);
    const removed = await context.request.delete(`/api/v1/channels/${general.id}/messages/${deleted.id}`, { headers: { Origin: origin(baseURL) } });
    expect(removed.status()).toBe(204);
    await expect(page.getByText(deleted.content, { exact: true })).toHaveCount(0);
    await held.deliver();
    await expect(page.getByText(deleted.content, { exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: general.name, exact: true })).toBeVisible();
  } finally { await held.dispose(); }
});

test('a delayed private workspace response cannot replace a later authenticated account', async ({ page, context, browser, baseURL }) => {
  const first = await seedAccount(context, baseURL, 'first');
  const secondContext = await browser.newContext({ baseURL });
  let held: Awaited<ReturnType<typeof holdNextGet>> | undefined;
  try {
    const second = await seedAccount(secondContext, baseURL, 'second');
    const secret = await seedMessage(context, baseURL, first.community.channels[0].id, `Privado de primera cuenta ${randomUUID()}`);
    const secondMessage = await seedMessage(secondContext, baseURL, second.community.channels[0].id, `Solo segunda cuenta ${randomUUID()}`);
    await openWorkspace(page, first);
    held = await holdNextGet(page, (url) => url.pathname === '/api/v1/bootstrap');
    await createChannel(context, baseURL, first.community.id, 'provocar-refresh');
    const response = await held.captured;
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body).communities.some((community: { id: string }) => community.id === first.community.id)).toBe(true);
    await page.getByRole('button', { name: 'Abrir ajustes', exact: true }).click();
    await page.getByRole('button', { name: /Cerrar sesión y cambiar/ }).click();
    await expect(page.getByRole('heading', { name: 'De vuelta con tu equipo.' })).toBeVisible();
    await page.getByLabel('Correo electrónico', { exact: true }).fill(second.email);
    await page.getByLabel('Contraseña', { exact: true }).fill(second.password);
    await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
    await expect(page.locator('.account-profile')).toContainText(second.name);
    await expect(page.getByText(secondMessage.content, { exact: true })).toBeVisible();
    await held.deliver();
    await expect(page.locator('.account-profile')).toContainText(second.name);
    await expect(page.locator('.community-heading')).toContainText(second.community.name);
    await expect(page.getByText(secondMessage.content, { exact: true })).toBeVisible();
    await expect(page.getByText(secret.content, { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: `Comunidad ${first.community.name}`, exact: true })).toHaveCount(0);
  } finally { if (held) await held.dispose(); await secondContext.close(); }
});

test('pagination ignores a pre-resync page and remains available after workspace refresh and reconnect', async ({ page, context, baseURL }) => {
  test.setTimeout(90_000);
  const account = await seedAccount(context, baseURL, 'history');
  const channel = account.community.channels[0];
  const prefix = `Historial ${randomUUID()}`;
  const oldest = `${prefix} 000`;
  for (let index = 0; index < 105; index += 1) await seedMessage(context, baseURL, channel.id, `${prefix} ${index.toString().padStart(3, '0')}`);
  await trackConnections(page);
  await openWorkspace(page, account);
  const pagination = page.getByRole('button', { name: 'Cargar mensajes anteriores', exact: true });
  await expect(pagination).toBeVisible();
  await expect(page.getByText(oldest, { exact: true })).toHaveCount(0);
  const held = await holdNextGet(page, (url) => historyRequest(url, channel.id, true));
  try {
    await pagination.click();
    const response = await held.captured;
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body).messages.some((item: StoredMessage) => item.content === oldest)).toBe(true);
    await reconnect(page, channel.id);
    await held.deliver();
    await expect(page.getByText(oldest, { exact: true })).toHaveCount(0);
    await expect(pagination).toBeEnabled();
  } finally { await held.dispose(); }
  await pagination.click();
  await expect(page.getByText(oldest, { exact: true })).toBeVisible();
  await expect(pagination).toHaveCount(0);
  const refreshedHistory = page.waitForResponse((response) => response.request().method() === 'GET' && historyRequest(new URL(response.url()), channel.id) && response.ok());
  await createChannel(context, baseURL, account.community.id, 'refresh-sin-perder-historia');
  await refreshedHistory;
  await settleClient(page);
  await expect(page.getByText(oldest, { exact: true })).toBeVisible();
  await reconnect(page, channel.id);
  await expect(page.getByText(oldest, { exact: true })).toHaveCount(0);
  await expect(pagination).toBeVisible();
  await pagination.click();
  await expect(page.getByText(oldest, { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('.account-profile')).toContainText(account.name);
  await expect(page.locator('.composer-caption')).toContainText('historial persistente');
  await page.waitForLoadState('networkidle');
  await expect(pagination).toBeVisible();
  await pagination.click();
  await expect(page.getByText(oldest, { exact: true })).toBeVisible();
});

test('a failed reconnect resync retries and converges a missed deletion without reloading', async ({ page, context, baseURL }) => {
  const account = await seedAccount(context, baseURL, 'retry');
  const channel = account.community.channels[0];
  const deleted = await seedMessage(context, baseURL, channel.id, `Borrado mientras desconectado ${randomUUID()}`);
  let connections = 0;
  let navigations = 0;
  const receivedMessages: string[] = [];
  const exceptions: string[] = [];
  page.on('pageerror', (error) => exceptions.push(error.message));
  page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) navigations += 1; });
  page.on('websocket', (socket) => {
    if (new URL(socket.url()).pathname !== '/api/v1/events') return;
    connections += 1;
    socket.on('framereceived', ({ payload }) => {
      try {
        const event = JSON.parse(typeof payload === 'string' ? payload : payload.toString('utf8'));
        if (event.type === 'message.created' && typeof event.message?.content === 'string') receivedMessages.push(event.message.content);
      } catch { /* Only application JSON text frames are relevant to this assertion. */ }
    });
  });
  await trackConnections(page);
  const firstSocket = page.waitForEvent('websocket', { predicate: (socket) => new URL(socket.url()).pathname === '/api/v1/events' });
  await openWorkspace(page, account);
  const originalSocket = await firstSocket;
  const initialNavigations = navigations;
  await expect(page.getByText(deleted.content, { exact: true })).toBeVisible();

  const deletionCommitted = deferred<void>();
  let delayedTicket = false;
  const ticketRoute = (url: URL) => url.pathname === '/api/v1/events/ticket';
  const holdTicket = async (route: Route) => {
    if (!delayedTicket && route.request().method() === 'POST') {
      delayedTicket = true;
      // Even on a slow runner, reconnection cannot precede the real deletion.
      await deletionCommitted.promise;
    }
    await route.continue();
  };
  const failedResync = deferred<void>();
  let abortedBootstraps = 0;
  const bootstrapRoute = (url: URL) => url.pathname === '/api/v1/bootstrap';
  const failOneBootstrap = async (route: Route) => {
    if (route.request().method() === 'GET' && abortedBootstraps === 0) {
      abortedBootstraps += 1;
      await route.abort('failed');
      failedResync.resolve();
    } else await route.continue();
  };
  await page.route(ticketRoute, holdTicket);
  await page.route(bootstrapRoute, failOneBootstrap);
  try {
    const disconnected = originalSocket.waitForEvent('close');
    const closed = await page.evaluate(() => {
      let count = 0;
      const sockets = (window as Window & { __nuvexRaceSockets?: Set<WebSocket> }).__nuvexRaceSockets;
      for (const socket of sockets ?? []) {
        if (socket.readyState === WebSocket.OPEN) { socket.close(1000, 'Regression: miss a deletion'); count += 1; }
      }
      return count;
    });
    expect(closed).toBeGreaterThan(0);
    await disconnected;
    const removed = await context.request.delete(`/api/v1/channels/${channel.id}/messages/${deleted.id}`, { headers: { Origin: origin(baseURL) } });
    expect(removed.status()).toBe(204);
    // The closed stream missed this event: only a successful reconciliation can remove it.
    await expect(page.getByText(deleted.content, { exact: true })).toBeVisible();
    deletionCommitted.resolve();
    await failedResync.promise;
    await expect.poll(() => connections).toBeGreaterThanOrEqual(3);
    await expect(page.getByText(deleted.content, { exact: true })).toHaveCount(0);
    await expect(page.locator('.composer-caption')).toContainText('historial persistente');
    expect(abortedBootstraps).toBe(1);

    const sent = `Enviar y recibir tras recuperar ${randomUUID()}`;
    await page.getByRole('textbox', { name: 'Escribir mensaje' }).fill(sent);
    await page.getByRole('button', { name: 'Enviar mensaje', exact: true }).click();
    await expect(page.getByText(sent, { exact: true })).toBeVisible();
    // Verify the committed WebSocket echo as well as the sender's HTTP result.
    await expect.poll(() => receivedMessages).toContain(sent);
    expect(navigations).toBe(initialNavigations);
    expect(exceptions).toEqual([]);
  } finally {
    deletionCommitted.resolve();
    await page.unroute(ticketRoute, holdTicket);
    await page.unroute(bootstrapRoute, failOneBootstrap);
  }
});
