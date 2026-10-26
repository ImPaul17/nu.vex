import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';

type TrackedWindow = typeof window & {
  __voicePeers: Set<RTCPeerConnection>;
  __voiceStreams: MediaStream[];
  __voiceAudio: HTMLMediaElement[];
};

async function observeMedia(page: Page) {
  await page.addInitScript(() => {
    const scope = window as TrackedWindow;
    scope.__voicePeers = new Set();
    scope.__voiceStreams = [];
    scope.__voiceAudio = [];
    const originalPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (!scope.__voiceAudio.includes(this)) scope.__voiceAudio.push(this);
      return originalPlay.call(this);
    };
    const originalPeer = window.RTCPeerConnection;
    window.RTCPeerConnection = new Proxy(originalPeer, {
      construct(target, args) {
        const peer = Reflect.construct(target, args) as RTCPeerConnection;
        scope.__voicePeers.add(peer);
        return peer;
      }
    });
    const originalCapture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await originalCapture(constraints);
      scope.__voiceStreams.push(stream);
      return stream;
    };
  });
}

async function audioPackets(page: Page): Promise<number> {
  return page.evaluate(async () => {
    let count = 0;
    for (const peer of (window as TrackedWindow).__voicePeers) {
      (await peer.getStats()).forEach((report: RTCInboundRtpStreamStats) => {
        if (report.type === 'inbound-rtp' && report.kind === 'audio') count += report.packetsReceived ?? 0;
      });
    }
    return count;
  });
}

async function liveTracks(page: Page): Promise<number> {
  return page.evaluate(() => (window as TrackedWindow).__voiceStreams.flatMap(stream => stream.getTracks()).filter(track => track.readyState === 'live').length);
}

async function register(context: BrowserContext, origin: string, suffix: string, run: string) {
  const response = await context.request.post('/api/v1/auth/register', {
    headers: { Origin: origin },
    data: { email: `voice.${run}.${suffix}@example.test`, handle: `voice_${run}_${suffix}`, displayName: `Voz ${suffix}`, password: `Voice-${randomUUID()}!` }
  });
  expect(response.status()).toBe(201);
  return (await response.json()).user as { id: string };
}

async function community(context: BrowserContext, origin: string, run: string) {
  const response = await context.request.post('/api/v1/communities', { headers: { Origin: origin }, data: { name: `Voz ${run}` } });
  expect(response.status()).toBe(201);
  return (await response.json()).community as { id: string; channels: { id: string; name: string }[] };
}

test('dos miembros transmiten audio real, controlan su micrófono y abandonan la voz al ser revocados', async ({ browser, page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const run = randomUUID().replaceAll('-', '').slice(0, 12);
  const beta = await browser.newContext({ baseURL, permissions: ['microphone'] });
  const bob = await beta.newPage();
  const exceptions: string[] = [];
  for (const client of [page, bob]) { await observeMedia(client); client.on('pageerror', error => exceptions.push(error.message)); }
  try {
    const aliceUser = await register(context, origin, 'a', run);
    const bobUser = await register(beta, origin, 'b', run);
    const room = await community(context, origin, run);
    const invitation = await context.request.post(`/api/v1/communities/${room.id}/invites`, { headers: { Origin: origin } });
    expect(invitation.status()).toBe(201);
    const joined = await beta.request.post(`/api/v1/invites/${(await invitation.json()).code}/join`, { headers: { Origin: origin } });
    expect(joined.status()).toBe(200);
    const created = await context.request.post(`/api/v1/communities/${room.id}/channels`, { headers: { Origin: origin }, data: { name: 'charla', kind: 'voice' } });
    expect(created.status()).toBe(201);
    const channel = (await created.json()).channel as { id: string; kind: string };
    expect(channel.kind).toBe('voice');
    await mkdir('.cache/voice-acceptance', { recursive: true });
    await writeFile(`.cache/voice-acceptance/${run}.json`, JSON.stringify({ origin, run, userIds: [aliceUser.id, bobUser.id], communityId: room.id, voiceChannelId: channel.id }));
    await Promise.all([page.goto('/'), bob.goto('/')]);
    await expect(page.getByRole('heading', { name: 'general', exact: true })).toBeVisible();
    expect(await liveTracks(page)).toBe(0);
    expect(await liveTracks(bob)).toBe(0);
    const participantIds: string[] = [];
    for (const client of [page, bob]) {
      await client.getByRole('button', { name: 'charla Canal de voz', exact: true }).click();
      const joined = client.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === `/api/v1/channels/${channel.id}/voice/join`);
      await client.getByRole('button', { name: 'Unirme al canal de voz', exact: true }).click();
      participantIds.push((await (await joined).json()).participant.id);
    }
    await expect.poll(() => audioPackets(page), { timeout: 25_000 }).toBeGreaterThan(0);
    await expect.poll(() => audioPackets(bob), { timeout: 25_000 }).toBeGreaterThan(0);
    await expect(page.getByRole('list', { name: 'Participantes de voz' })).toContainText('Voz b');
    await page.screenshot({ path: 'test-results/voz-canal.png', fullPage: true });
    expect(await liveTracks(page)).toBe(1);
    const forged = await beta.request.post(`/api/v1/channels/${channel.id}/voice/state`, { headers: { Origin: origin }, data: { participantId: participantIds[0], muted: true, deafened: true } });
    expect(forged.status()).toBe(403);
    await page.getByLabel('Opciones de audio de Voz b', { exact: true }).click();
    await page.getByRole('button', { name: 'Silenciar a Voz b', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as TrackedWindow).__voiceAudio.length > 0 && (window as TrackedWindow).__voiceAudio.every(audio => audio.muted))).toBe(true);
    await page.getByRole('button', { name: 'Escuchar a Voz b', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as TrackedWindow).__voiceAudio.every(audio => !audio.muted))).toBe(true);
    await page.getByLabel('Opciones de audio de Voz b', { exact: true }).click();
    await page.getByRole('button', { name: 'Silenciar micrófono', exact: true }).first().click();
    await expect.poll(() => page.evaluate(() => (window as TrackedWindow).__voiceStreams.at(-1)?.getAudioTracks()[0]?.enabled)).toBe(false);
    await page.getByRole('button', { name: 'Activar micrófono', exact: true }).first().click();
    await expect.poll(() => page.evaluate(() => (window as TrackedWindow).__voiceStreams.at(-1)?.getAudioTracks()[0]?.enabled)).toBe(true);
    await page.getByRole('button', { name: 'Dejar de escuchar', exact: true }).first().click();
    await expect.poll(() => page.evaluate(() => (window as TrackedWindow).__voiceStreams.at(-1)?.getAudioTracks()[0]?.enabled)).toBe(false);
    await expect.poll(() => page.evaluate(() => (window as TrackedWindow).__voiceAudio.every(audio => audio.muted))).toBe(true);
    await page.getByRole('button', { name: 'Volver a escuchar', exact: true }).first().click();
    await page.getByRole('button', { name: 'general', exact: true }).click();
    await expect(page.locator('.voice-bar')).toBeVisible();
    expect(await liveTracks(page)).toBe(1);
    await page.getByRole('textbox', { name: 'Escribir mensaje', exact: true }).fill(`Texto durante voz ${run}`);
    await page.getByRole('button', { name: 'Enviar mensaje', exact: true }).click();
    await expect(page.getByText(`Texto durante voz ${run}`, { exact: true })).toBeVisible();
    for (const [theme, label] of [['emerald', 'Bosque'], ['midnight', 'Medianoche'], ['light', 'Luz de día']]) {
      await page.getByRole('button', { name: /Un espacio más tuyo/ }).click();
      await page.getByRole('button', { name: new RegExp(label) }).click();
      await page.keyboard.press('Escape');
      await expect(page.locator('.app')).toHaveAttribute('data-theme', theme);
      await expect(page.locator('.voice-bar')).toBeVisible();
      await page.screenshot({ path: `test-results/voz-${theme}.png`, fullPage: true });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('.voice-bar')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: 'test-results/voz-movil.png', fullPage: true });
    await page.setViewportSize({ width: 1440, height: 940 });
    await page.screenshot({ path: 'test-results/voz-escritorio.png', fullPage: true });
    const revoked = await context.request.delete(`/api/v1/communities/${room.id}/members/${bobUser.id}`, { headers: { Origin: origin } });
    expect(revoked.status()).toBe(204);
    await expect.poll(() => liveTracks(bob), { timeout: 10_000 }).toBe(0);
    await expect.poll(() => bob.evaluate(() => [...(window as TrackedWindow).__voicePeers].every(peer => peer.connectionState === 'closed'))).toBe(true);
    await page.getByRole('button', { name: 'Salir del canal de voz', exact: true }).first().click();
    await expect.poll(() => liveTracks(page)).toBe(0);
    await expect.poll(() => page.evaluate(() => [...(window as TrackedWindow).__voicePeers].every(peer => peer.connectionState === 'closed'))).toBe(true);
    expect(exceptions).toEqual([]);
  } finally { await beta.close(); }
});

test('denegar el micrófono conserva el chat y la API impide entrar a personas ajenas', async ({ browser, page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const run = randomUUID().replaceAll('-', '').slice(0, 12);
  const user = await register(context, origin, 'denied', run);
  const room = await community(context, origin, run);
  const created = await context.request.post(`/api/v1/communities/${room.id}/channels`, { headers: { Origin: origin }, data: { name: 'sin-micro', kind: 'voice' } });
  expect(created.status()).toBe(201);
  const voiceChannel = (await created.json()).channel as { id: string };
  const outsider = await browser.newContext({ baseURL });
  let outsiderUser: { id: string };
  try {
    outsiderUser = await register(outsider, origin, 'outside', run);
    const denied = await outsider.request.post(`/api/v1/channels/${voiceChannel.id}/voice/join`, { headers: { Origin: origin }, data: {} });
    expect(denied.status()).toBe(403);
  } finally { await outsider.close(); }
  const textRoom = await context.request.post(`/api/v1/channels/${room.channels[0].id}/voice/join`, { headers: { Origin: origin }, data: {} });
  expect(textRoom.status()).toBe(400);
  await mkdir('.cache/voice-acceptance', { recursive: true });
  await writeFile(`.cache/voice-acceptance/${run}.json`, JSON.stringify({ origin, run, userIds: [user.id, outsiderUser.id], communityId: room.id }));
  await page.addInitScript(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Permiso denegado por la prueba', 'NotAllowedError'); }; });
  let joins = 0;
  page.on('request', request => { if (new URL(request.url()).pathname.endsWith('/voice/join')) joins++; });
  await page.goto('/');
  await page.getByRole('button', { name: 'Crear canal', exact: true }).first().click();
  await page.getByLabel('Tipo de canal', { exact: true }).selectOption('voice');
  await page.getByLabel('Nombre del canal', { exact: true }).fill('por-interfaz');
  const createdInUI = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === `/api/v1/communities/${room.id}/channels`);
  await page.getByRole('dialog').getByRole('button', { name: 'Crear canal', exact: true }).click();
  expect((await (await createdInUI).json()).channel.kind).toBe('voice');
  await expect(page.getByRole('heading', { name: 'por-interfaz', exact: true, level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'sin-micro Canal de voz', exact: true }).click();
  await page.getByRole('button', { name: 'Unirme al canal de voz', exact: true }).click();
  await expect(page.getByText(/permiso.*micrófono|micrófono.*permiso/i).first()).toBeVisible();
  expect(joins).toBe(0);
  await page.getByRole('button', { name: 'general', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Escribir mensaje' })).toBeEnabled();
});
