import { randomUUID } from 'node:crypto';
import { test, expect, type BrowserContext, type WebSocket as ObservedSocket } from '@playwright/test';

interface Community { id: string; name: string; channels: { id: string; name: string }[] }
interface User { id: string; name: string }
interface StoredMessage { id: string; channelId: string; content: string }

function mutationHeaders(baseURL: string | undefined) {
  if (!baseURL) throw new Error('The instance security suite requires a configured baseURL.');
  return { Origin: new URL(baseURL).origin };
}

async function register(context: BrowserContext, baseURL: string | undefined, label: string): Promise<User> {
  const id = randomUUID().replaceAll('-', '').slice(0, 12);
  const response = await context.request.post('/api/v1/auth/register', {
    headers: mutationHeaders(baseURL),
    data: { email: `security.${id}@example.test`, password: `Security-${randomUUID()}!`, displayName: `Security ${label} ${id}`, handle: `sec_${label}_${id}` }
  });
  expect(response.status()).toBe(201);
  return (await response.json()).user;
}

async function createCommunity(context: BrowserContext, baseURL: string | undefined, name: string): Promise<Community> {
  const response = await context.request.post('/api/v1/communities', { headers: mutationHeaders(baseURL), data: { name } });
  expect(response.status()).toBe(201);
  return (await response.json()).community;
}

async function shareCommunity(owner: BrowserContext, member: BrowserContext, baseURL: string | undefined, community: Community) {
  const invitation = await owner.request.post(`/api/v1/communities/${community.id}/invites`, { headers: mutationHeaders(baseURL) });
  expect(invitation.status()).toBe(201);
  const { code } = await invitation.json() as { code: string };
  const joined = await member.request.post(`/api/v1/invites/${code}/join`, { headers: mutationHeaders(baseURL) });
  expect(joined.status()).toBe(200);
}

async function send(context: BrowserContext, baseURL: string | undefined, channelId: string, content: string): Promise<StoredMessage> {
  const response = await context.request.post(`/api/v1/channels/${channelId}/messages`, {
    headers: mutationHeaders(baseURL), data: { content, clientId: randomUUID() }
  });
  expect(response.status()).toBe(201);
  return (await response.json()).message;
}

function createdMessageId(payload: string): string | undefined {
  try {
    const event = JSON.parse(payload);
    return event.type === 'message.created' && typeof event.message?.id === 'string' ? event.message.id : undefined;
  } catch { return undefined; }
}

test('revoked members and logged-out sessions receive no private WebSocket content', async ({ browser, page, context, baseURL }) => {
  const ownerContext = await browser.newContext({ baseURL });
  const received: { socket: ObservedSocket; payload: string }[] = [];
  const exceptions: string[] = [];
  page.on('pageerror', (error) => exceptions.push(error.message));
  page.on('websocket', (socket) => {
    if (new URL(socket.url()).pathname !== '/api/v1/events') return;
    socket.on('framereceived', ({ payload }) => received.push({ socket, payload: typeof payload === 'string' ? payload : payload.toString('utf8') }));
  });

  try {
    await register(ownerContext, baseURL, 'owner');
    const member = await register(context, baseURL, 'member');
    const run = randomUUID().slice(0, 8);
    const privateCommunity = await createCommunity(ownerContext, baseURL, `Privado ${run}`);
    const controlCommunity = await createCommunity(ownerContext, baseURL, `Control ${run}`);
    await shareCommunity(ownerContext, context, baseURL, privateCommunity);
    await shareCommunity(ownerContext, context, baseURL, controlCommunity);
    const privateChannel = privateCommunity.channels[0].id;
    const controlChannel = controlCommunity.channels[0].id;
    const before = await context.request.get('/api/v1/bootstrap');
    expect(before.status()).toBe(200);
    expect((await before.json()).communities.map((community: Community) => community.id)).toEqual(expect.arrayContaining([privateCommunity.id, controlCommunity.id]));

    const connected = page.waitForEvent('websocket', { predicate: (socket) => new URL(socket.url()).pathname === '/api/v1/events' });
    await page.goto('/');
    const memberSocket = await connected;
    await expect(page.locator('.account-profile')).toContainText(member.name);
    await expect(page.locator('.composer-caption')).toContainText('historial persistente');
    await page.waitForLoadState('networkidle');
    expect(memberSocket.isClosed()).toBe(false);

    const revoked = await ownerContext.request.delete(`/api/v1/communities/${privateCommunity.id}/members/${member.id}`, { headers: mutationHeaders(baseURL) });
    expect(revoked.status()).toBe(204);
    const secretContent = `PRIVATE_AFTER_REVOCATION_${randomUUID()}`;
    const secret = await send(ownerContext, baseURL, privateChannel, secretContent);
    // Sequential committed sends give the positive control a strict position after the secret.
    const control = await send(ownerContext, baseURL, controlChannel, `VISIBLE_CONTROL_BARRIER_${randomUUID()}`);
    await expect.poll(() => received.some((frame) => frame.socket === memberSocket && createdMessageId(frame.payload) === control.id)).toBe(true);
    // Check the actual wire frames, even if client-side filtering would hide leaked content.
    expect(received.some((frame) => createdMessageId(frame.payload) === secret.id || frame.payload.includes(secretContent))).toBe(false);
    expect(memberSocket.isClosed()).toBe(false);

    const deniedRead = await context.request.get(`/api/v1/channels/${privateChannel}/messages`);
    expect(deniedRead.status()).toBe(403);
    const deniedWrite = await context.request.post(`/api/v1/channels/${privateChannel}/messages`, {
      headers: mutationHeaders(baseURL), data: { content: `DENIED_${randomUUID()}`, clientId: randomUUID() }
    });
    expect(deniedWrite.status()).toBe(403);
    const allowedRead = await context.request.get(`/api/v1/channels/${controlChannel}/messages`);
    expect(allowedRead.status()).toBe(200);
    await expect(page.getByRole('button', { name: `Comunidad ${privateCommunity.name}`, exact: true })).toHaveCount(0);
    await expect(page.getByText(control.content, { exact: true })).toBeVisible();

    // Revoke through REST rather than the UI so the existing stream must enforce session expiry itself.
    const disconnected = memberSocket.waitForEvent('close');
    const loggedOut = await context.request.post('/api/v1/auth/logout', { headers: mutationHeaders(baseURL) });
    expect(loggedOut.status()).toBe(204);
    const afterLogoutContent = `CONTROL_AFTER_LOGOUT_${randomUUID()}`;
    const afterLogout = await send(ownerContext, baseURL, controlChannel, afterLogoutContent);
    await disconnected;
    expect(received.some((frame) => createdMessageId(frame.payload) === afterLogout.id || frame.payload.includes(afterLogoutContent))).toBe(false);
    expect(received.some((frame) => createdMessageId(frame.payload) === secret.id || frame.payload.includes(secretContent))).toBe(false);
    await expect(page.getByRole('heading', { name: 'De vuelta con tu equipo.' })).toBeVisible();
    await expect(page.locator('.account-profile')).toHaveCount(0);
    const unauthenticated = await context.request.get('/api/v1/auth/me');
    expect(unauthenticated.status()).toBe(401);
    expect(exceptions).toEqual([]);
  } finally { await ownerContext.close(); }
});
