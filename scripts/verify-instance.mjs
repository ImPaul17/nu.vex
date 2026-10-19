// Exercises a real compiled server and PostgreSQL. Creates only uniquely prefixed test data.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(import.meta.dirname, '..');
const runId = randomUUID();
const prefix = `verify_${runId.replaceAll('-', '').slice(0, 12)}`;
const port = Number(process.env.NUVEX_VERIFY_PORT ?? 3301);
const composeProject = process.env.NUVEX_VERIFY_COMPOSE_PROJECT;
const base = process.env.NUVEX_VERIFY_BASE_URL ?? `http://127.0.0.1:${port}`;
const origin = composeProject ? new URL(base).origin : 'http://127.0.0.1:5173';
const binary = resolve(process.env.NUVEX_SERVER_BIN ?? `${root}/apps/server/target/debug/nuvex-server${process.platform === 'win32' ? '.exe' : ''}`);
const outputDir = resolve(root, '.cache/verify-instance', runId);
const secrets = new Set();
const checks = [];
const resources = { prefix, users: [], communities: [], channels: [] };
const sockets = new Set();
let child;
let backendLog;

function remember(value) { if (value) secrets.add(value); return value; }
function redact(value) {
  let text = String(value);
  for (const secret of secrets) text = text.replaceAll(secret, '[redacted]');
  return text.replace(/postgres(?:ql)?:\/\/[^\s]+/g, '[database URL redacted]');
}
function passed(name) { checks.push(name); console.log(`PASS ${name}`); }
function options() {
  return {
    cwd: root,
    windowsHide: true,
    env: {
      ...process.env,
      NUVEX_BIND: `127.0.0.1:${port}`,
      NUVEX_INSECURE_DEV: 'true',
      NUVEX_ALLOWED_ORIGIN: origin,
      NUVEX_REGISTRATION_OPEN: 'true',
      NUVEX_MIGRATE_ON_START: 'true',
      RUST_LOG: 'nuvex_server=info',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  };
}
function capture(process) {
  process.stdout.on('data', (data) => backendLog.write(data));
  process.stderr.on('data', (data) => backendLog.write(data));
  return process;
}
async function stop() {
  const ownChild = child;
  child = undefined;
  if (!ownChild || ownChild.exitCode !== null || ownChild.signalCode !== null) return;
  const exited = once(ownChild, 'exit');
  ownChild.kill('SIGTERM');
  const timer = setTimeout(() => ownChild.kill('SIGKILL'), 5000);
  try { await exited; } finally { clearTimeout(timer); }
}
async function assertPortFree() {
  const listener = createServer();
  await new Promise((resolvePromise, reject) => {
    listener.once('error', reject);
    listener.listen(port, '127.0.0.1', resolvePromise);
  });
  await new Promise((resolvePromise, reject) => listener.close((error) => error ? reject(error) : resolvePromise()));
}
async function migrate() {
  if (composeProject) {
    await runCompose(['run', '--rm', '--no-deps', '-T', 'migrate']);
    return;
  }
  const migration = capture(spawn(binary, ['--migrate'], options()));
  const timer = setTimeout(() => migration.kill('SIGTERM'), 30000);
  try {
    const [code] = await once(migration, 'exit');
    assert.equal(code, 0, 'Migration process failed; inspect private server.log');
  } finally { clearTimeout(timer); }
}
async function start() {
  let spawnError;
  if (!composeProject) {
    await assertPortFree();
    child = capture(spawn(binary, [], options()));
    child.once('error', (error) => { spawnError = error; });
  }
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    if (child) assert.equal(child.exitCode, null, 'Server exited before becoming ready; inspect private server.log');
    try {
      const ready = await fetch(`${base}/health/ready`, { signal: AbortSignal.timeout(1000) });
      if (ready.status === 200) return;
    } catch { /* The owned process is still starting. */ }
    await delay(150);
  }
  throw new Error('Server readiness timed out; inspect private server.log');
}
async function runCompose(args) {
  const command = capture(spawn('docker', ['compose', '--project-name', composeProject, ...args], {
    cwd: root, windowsHide: true, env: process.env, stdio: ['ignore', 'pipe', 'pipe'],
  }));
  const timer = setTimeout(() => command.kill('SIGTERM'), 90000);
  try {
    const [code] = await once(command, 'exit');
    assert.equal(code, 0, 'Isolated Compose operation failed; inspect private server.log');
  } finally { clearTimeout(timer); }
}
async function restart() {
  if (composeProject) {
    await runCompose(['restart', 'server', 'web']);
    await start();
  } else {
    await stop();
    await start();
  }
}
async function request(path, { method = 'GET', auth, body, requestOrigin = origin, status = 200, contentType = 'application/json', rawBody } = {}) {
  const headers = new Headers();
  if (requestOrigin !== null) headers.set('Origin', requestOrigin);
  if (auth?.bearer) headers.set('Authorization', `Bearer ${auth.bearer}`);
  if (auth?.cookie) headers.set('Cookie', auth.cookie);
  if (body !== undefined || rawBody !== undefined) headers.set('Content-Type', contentType);
  const response = await fetch(`${base}/api/v1${path}`, {
    method, headers, body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)), signal: AbortSignal.timeout(10000),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : undefined;
  assert.equal(response.status, status, `${method} request expected ${status}; got ${response.status} (${data?.error?.code ?? 'no error code'})`);
  return { data, response };
}
async function register(suffix, transport, requestOrigin = origin) {
  const password = remember(`Verify-${randomBytes(24).toString('base64url')}`);
  const email = `${prefix}_${suffix}@example.test`;
  const { data, response } = await request('/auth/register', {
    method: 'POST', status: 201, requestOrigin, body: { email, password, handle: `${prefix}_${suffix}`, displayName: `${prefix} ${suffix}`, transport },
  });
  assert.ok(data.user.id && data.user.email === email, 'Registration must return the created account');
  resources.users.push(data.user.id);
  let auth;
  if (transport === 'bearer') {
    assert.ok(typeof data.accessToken === 'string' && /^[a-f0-9]{64}$/.test(data.accessToken), 'Expected an opaque bearer token');
    assert.equal(response.headers.get('set-cookie'), null, 'Bearer registration must not set a browser session');
    auth = { bearer: remember(data.accessToken) };
  } else {
    const setCookie = response.headers.get('set-cookie') ?? '';
    assert.ok(setCookie.includes('HttpOnly') && setCookie.includes('SameSite=Lax') && setCookie.includes('Path=/'), 'Expected protected browser cookie attributes');
    assert.equal(data.accessToken, undefined, 'Browser authentication must not expose its token in JSON');
    auth = { cookie: remember(setCookie.split(';')[0]) };
  }
  return { auth, user: data.user, email, password };
}
async function login(account, transport = 'cookie', requestOrigin = origin) {
  const { data, response } = await request('/auth/login', { method: 'POST', requestOrigin, body: { email: account.email, password: account.password, transport } });
  if (transport === 'bearer') {
    assert.match(data.accessToken, /^[a-f0-9]{64}$/, 'Login must issue an opaque bearer');
    assert.equal(response.headers.get('set-cookie'), null, 'Bearer login must not set a cookie');
    return { bearer: remember(data.accessToken) };
  }
  return { cookie: remember((response.headers.get('set-cookie') ?? '').split(';')[0]) };
}

// Raw HTTP allows negative WebSocket handshakes with real duplicate/missing headers.
// Positive native sockets below use Node's real WebSocket implementation without Origin.
async function rejectWebSocket({ ticket, requestOrigin = null, auth, status = 403 } = {}) {
  const url = new URL('/api/v1/events', base);
  if (ticket) url.searchParams.set('ticket', ticket);
  const headers = {
    Connection: 'Upgrade', Upgrade: 'websocket',
    'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
  };
  if (requestOrigin !== null) headers.Origin = requestOrigin;
  if (auth?.bearer) headers.Authorization = `Bearer ${auth.bearer}`;
  if (auth?.cookie !== undefined) headers.Cookie = auth.cookie;
  const actualStatus = await new Promise((resolvePromise, reject) => {
    const raw = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, { headers }, (response) => {
      response.resume();
      response.once('end', () => resolvePromise(response.statusCode));
    });
    raw.once('upgrade', (response, socket) => {
      socket.on('error', () => {});
      socket.destroy();
      resolvePromise(response.statusCode);
    });
    raw.once('error', () => reject(new Error('WebSocket rejection probe failed before an HTTP response')));
    raw.setTimeout(5000, () => raw.destroy());
    raw.end();
  });
  assert.equal(actualStatus, status, 'Unexpected status for a rejected WebSocket handshake');
}

async function nativeEvents(ticket) {
  const url = new URL('/api/v1/events', base);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('ticket', ticket);
  const socket = new WebSocket(url);
  sockets.add(socket);
  const frames = [];
  let closed = false;
  let failed = false;
  socket.addEventListener('message', (event) => frames.push(JSON.parse(String(event.data))));
  socket.addEventListener('error', () => { failed = true; });
  socket.addEventListener('close', () => { closed = true; sockets.delete(socket); });
  async function waitFor(predicate, description) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (predicate()) return;
      assert.ok(!failed, `Native WebSocket failed while ${description}`);
      await delay(25);
    }
    assert.fail(`Native WebSocket timed out while ${description}`);
  }
  await waitFor(() => frames.some((frame) => frame.type === 'ready'), 'waiting for ready');
  return {
    frames,
    waitMessage: (id) => waitFor(() => frames.some((frame) => frame.type === 'message.created' && frame.message?.id === id), 'waiting for the committed message'),
    waitClosed: () => waitFor(() => closed, 'waiting for session revocation'),
  };
}

try {
  if (composeProject) {
    assert.ok(/^nuvex-ci-[a-z0-9-]{8,}$/.test(composeProject), 'Compose verification requires a uniquely named nuvex-ci-* project');
    assert.equal(process.env.COMPOSE_PROJECT_NAME, composeProject, 'Compose project must match the explicitly prepared CI project');
    assert.ok(process.env.COMPOSE_ENV_FILES, 'An explicit disposable Compose environment file is required');
    await access(process.env.COMPOSE_ENV_FILES);
    assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname), 'Compose verification is restricted to loopback');
  } else {
    assert.ok(process.env.NUVEX_DATABASE_URL, 'Load NUVEX_DATABASE_URL first; on this Windows workspace dot-source scripts/dev-tools/enter.ps1');
    remember(process.env.NUVEX_DATABASE_URL);
    assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535, 'Invalid verification port');
    await access(binary);
  }
  await mkdir(outputDir, { recursive: true });
  backendLog = createWriteStream(resolve(outputDir, 'server.log'), { flags: 'a' });
  await migrate();
  await migrate();
  await start();
  passed('migrations can be reapplied and the instance becomes ready');

  await request('/auth/me', { status: 401 });
  await request('/bootstrap', { status: 401 });
  const owner = await register('owner', 'bearer');
  const member = await register('member', 'cookie');
  const outsider = await register('outsider', 'bearer', null);
  await request('/auth/me', { auth: owner.auth });
  await request('/auth/me', { auth: member.auth });
  passed('real accounts support opaque bearer tokens and HttpOnly browser sessions');

  await request('/communities', { method: 'POST', auth: member.auth, body: { name: prefix }, requestOrigin: null, status: 403 });
  await request('/communities', { method: 'POST', auth: { ...owner.auth, ...member.auth }, body: { name: prefix }, requestOrigin: null, status: 403 });
  for (const requestOrigin of ['https://untrusted.example', 'null', '', `${origin}, ${origin}`]) {
    await request('/communities', { method: 'POST', auth: owner.auth, body: { name: prefix }, requestOrigin, status: 403 });
    await request('/auth/me', { auth: owner.auth, requestOrigin, status: 403 });
  }
  await request('/auth/me', { auth: member.auth, requestOrigin: null });
  const emptyBootstrap = await request('/bootstrap', { auth: owner.auth });
  assert.equal(emptyBootstrap.data.communities.length, 0, 'Forbidden requests must not create communities');
  passed('browser cookies still require an exact origin for mutations and cannot mix into originless bearer requests');

  const nativeLoginBody = { email: outsider.email, password: outsider.password, transport: 'bearer' };
  const nativeRegisterBody = { email: `${prefix}_blocked@example.test`, password: outsider.password, displayName: prefix, handle: `${prefix}_blocked`, transport: 'bearer' };
  for (const [path, body] of [['/auth/login', nativeLoginBody], ['/auth/register', nativeRegisterBody]]) {
    await request(path, { method: 'POST', body: { ...body, transport: undefined }, requestOrigin: null, status: 403 });
    await request(path, { method: 'POST', body: { ...body, transport: 'cookie' }, requestOrigin: null, status: 403 });
    await request(path, { method: 'POST', auth: { ...owner.auth, ...member.auth }, body, requestOrigin: null, status: 403 });
    await request(path, { method: 'POST', body, requestOrigin: 'null', status: 403 });
    await request(path, { method: 'POST', rawBody: JSON.stringify(body), contentType: 'text/plain', requestOrigin: null, status: 400 });
    await request(path, { method: 'POST', rawBody: 'transport=bearer', contentType: 'application/x-www-form-urlencoded', requestOrigin: null, status: 400 });
  }
  const nativeSession = await login(outsider, 'bearer', null);
  await request('/auth/me', { auth: nativeSession, requestOrigin: null });
  await request('/auth/me', { auth: { bearer: 'a'.repeat(64) }, requestOrigin: null, status: 401 });
  await request('/communities', { method: 'POST', auth: { bearer: 'a'.repeat(64) }, body: { name: prefix }, requestOrigin: null, status: 401 });
  await request('/auth/me', { auth: { bearer: 'invalid', ...member.auth }, status: 401 });
  passed('originless registration and login require explicit JSON bearer transport without creating browser cookies');

  const created = await request('/communities', { method: 'POST', auth: owner.auth, requestOrigin: null, body: { name: prefix }, status: 201 });
  const community = created.data.community;
  const channelId = community.channels[0].id;
  resources.communities.push(community.id);
  resources.channels.push(channelId);
  await request(`/channels/${channelId}/messages`, { auth: member.auth, status: 403 });
  await request(`/communities/${community.id}/channels`, { method: 'POST', auth: member.auth, body: { name: 'unauthorized' }, status: 403 });
  const extra = await request(`/communities/${community.id}/channels`, { method: 'POST', auth: owner.auth, body: { name: 'Verification Extra' }, status: 201 });
  resources.channels.push(extra.data.channel.id);
  assert.equal(extra.data.channel.name, 'verification-extra');
  await request(`/communities/${community.id}/channels`, { method: 'POST', auth: owner.auth, body: { name: 'Verification Extra' }, status: 409 });
  const invite = await request(`/communities/${community.id}/invites`, { method: 'POST', auth: owner.auth, status: 201 });
  const code = remember(invite.data.code);
  await request(`/invites/${code}/join`, { method: 'POST', auth: member.auth });
  await request(`/invites/${code}/join`, { method: 'POST', auth: member.auth });
  await request(`/communities/${community.id}/invites`, { method: 'POST', auth: member.auth, status: 403 });
  await request(`/communities/${community.id}/members/${owner.user.id}`, { method: 'DELETE', auth: owner.auth, status: 400 });
  await request(`/communities/${community.id}/members/${member.user.id}`, { method: 'DELETE', auth: outsider.auth, status: 403 });
  passed('invitation membership is idempotent and owner actions enforce permissions');

  const clientId = randomUUID();
  const firstInput = { content: `${prefix} persistent message`, clientId };
  const first = await request(`/channels/${channelId}/messages`, { method: 'POST', auth: owner.auth, body: firstInput, status: 201 });
  const retried = await request(`/channels/${channelId}/messages`, { method: 'POST', auth: owner.auth, body: firstInput });
  assert.equal(first.data.message.id, retried.data.message.id, 'Retry must return the original message');
  await request(`/channels/${channelId}/messages`, { method: 'POST', auth: owner.auth, body: { ...firstInput, content: 'changed' }, status: 409 });
  await request(`/channels/${extra.data.channel.id}/messages`, { method: 'POST', auth: owner.auth, body: firstInput, status: 409 });
  const expectedIds = new Set([first.data.message.id]);
  for (let index = 0; index < 40; index++) {
    const sent = await request(`/channels/${channelId}/messages`, { method: 'POST', auth: index % 2 ? member.auth : owner.auth, body: { content: `${prefix} page ${index}`, clientId: randomUUID() }, status: 201 });
    expectedIds.add(sent.data.message.id);
  }
  const deletedInput = { content: `${prefix} erase content`, clientId: randomUUID() };
  const deleted = await request(`/channels/${channelId}/messages`, { method: 'POST', auth: member.auth, body: deletedInput, status: 201 });
  const deletePath = `/channels/${channelId}/messages/${deleted.data.message.id}`;
  await request(deletePath, { method: 'DELETE', auth: owner.auth, status: 403 });
  await request(deletePath, { method: 'DELETE', auth: member.auth, status: 204 });
  await request(deletePath, { method: 'DELETE', auth: member.auth, status: 204 });
  await request(`/channels/${channelId}/messages`, { method: 'POST', auth: member.auth, body: deletedInput, status: 410 });
  passed('message retries preserve identity and deleted messages cannot be resurrected');

  const seen = new Set();
  let before;
  for (;;) {
    const page = await request(`/channels/${channelId}/messages?limit=17${before ? `&before=${before}` : ''}`, { auth: member.auth });
    for (const message of page.data.messages) {
      assert.ok(!seen.has(message.id), 'Pagination must not repeat messages');
      seen.add(message.id);
    }
    if (page.data.messages.length < 17) break;
    before = page.data.messages[0].id;
  }
  assert.deepEqual([...seen].sort(), [...expectedIds].sort(), 'Pagination must preserve all 41 persistent messages');
  for (const limit of [0, 101]) await request(`/channels/${channelId}/messages?limit=${limit}`, { auth: owner.auth, status: 400 });
  for (const content of ['', 'a'.repeat(4001), '\0']) await request(`/channels/${channelId}/messages`, { method: 'POST', auth: owner.auth, body: { content, clientId: randomUUID() }, status: 400 });
  passed('cursor pagination preserves 41 messages and message/history bounds are enforced');

  const browserLogout = await request('/auth/logout', { method: 'POST', auth: member.auth, status: 204 });
  assert.ok(browserLogout.response.headers.get('set-cookie')?.includes('Max-Age=0'), 'Cookie logout must clear its browser session');
  await request('/auth/me', { auth: member.auth, status: 401 });
  await request('/events/ticket', { method: 'POST', auth: member.auth, status: 401 });
  const bearerSession = await login(member, 'bearer');
  const bearerLogout = await request('/auth/logout', { method: 'POST', auth: bearerSession, requestOrigin: null, status: 204 });
  assert.equal(bearerLogout.response.headers.get('set-cookie'), null, 'Bearer logout must not set or clear ambient cookies');
  await request('/auth/me', { auth: bearerSession, status: 401 });
  const activeMember = await login(member);
  passed('logout revokes browser and bearer sessions in PostgreSQL');

  await restart();
  await request('/auth/me', { auth: owner.auth });
  await request('/auth/me', { auth: activeMember });
  await request('/auth/me', { auth: member.auth, status: 401 });
  await request('/auth/me', { auth: bearerSession, status: 401 });
  const restored = await request(`/channels/${channelId}/messages?limit=100`, { auth: owner.auth });
  assert.deepEqual(restored.data.messages.map((message) => message.id).sort(), [...expectedIds].sort());
  const memberBootstrap = await request('/bootstrap', { auth: activeMember });
  assert.ok(memberBootstrap.data.communities.some((entry) => entry.id === community.id));
  assert.ok(memberBootstrap.data.members.every((entry) => entry.email === undefined), 'Member listings must not disclose account email addresses');
  passed('process restart preserves accounts, permissions, revocations, and message history');

  await request(`/communities/${community.id}/members/${member.user.id}`, { method: 'DELETE', auth: owner.auth, status: 204 });
  await request('/auth/me', { auth: activeMember });
  await request(`/channels/${channelId}/messages`, { auth: activeMember, status: 403 });
  await request(`/channels/${channelId}/messages`, { method: 'POST', auth: activeMember, body: { content: 'revoked', clientId: randomUUID() }, status: 403 });
  const revokedBootstrap = await request('/bootstrap', { auth: activeMember });
  assert.ok(!revokedBootstrap.data.communities.some((entry) => entry.id === community.id));
  passed('membership revocation immediately blocks reads and writes without ending the account session');

  const browserTicket = remember((await request('/events/ticket', { method: 'POST', auth: owner.auth })).data.ticket);
  await rejectWebSocket({ ticket: browserTicket });
  const wrongAudienceTicket = remember((await request('/events/ticket', { method: 'POST', auth: nativeSession, requestOrigin: null })).data.ticket);
  await rejectWebSocket({ ticket: wrongAudienceTicket, requestOrigin: origin });
  await rejectWebSocket({ ticket: wrongAudienceTicket, status: 401 });
  await request('/events/ticket', { method: 'POST', auth: activeMember, requestOrigin: null, status: 403 });
  await request('/events/ticket', { method: 'POST', auth: { ...nativeSession, ...activeMember }, requestOrigin: null, status: 403 });
  await rejectWebSocket({ auth: activeMember });
  await rejectWebSocket({ auth: nativeSession });
  const nativeTicket = remember((await request('/events/ticket', { method: 'POST', auth: nativeSession, requestOrigin: null })).data.ticket);
  for (const requestOrigin of ['null', '', 'https://untrusted.example', [origin, origin]]) {
    await rejectWebSocket({ ticket: nativeTicket, requestOrigin });
  }
  await rejectWebSocket({ ticket: nativeTicket, auth: activeMember });
  await rejectWebSocket({ ticket: nativeTicket, auth: { cookie: '' } });
  await rejectWebSocket({ ticket: nativeTicket, auth: nativeSession });
  const realtime = await nativeEvents(nativeTicket);
  await rejectWebSocket({ ticket: nativeTicket, status: 401 });
  passed('real native WebSocket tickets are single use and cannot substitute for browser origin or cookie checks');

  await request(`/invites/${code}/join`, { method: 'POST', auth: nativeSession, requestOrigin: null });
  const nativeControl = (await request('/communities', { method: 'POST', auth: owner.auth, body: { name: `${prefix} native control` }, status: 201 })).data.community;
  const controlChannel = nativeControl.channels[0].id;
  resources.communities.push(nativeControl.id);
  resources.channels.push(controlChannel);
  const controlCode = remember((await request(`/communities/${nativeControl.id}/invites`, { method: 'POST', auth: owner.auth, status: 201 })).data.code);
  await request(`/invites/${controlCode}/join`, { method: 'POST', auth: nativeSession, requestOrigin: null });
  const nativeMessage = (await request(`/channels/${channelId}/messages`, { method: 'POST', auth: nativeSession, requestOrigin: null, body: { content: `${prefix} native realtime`, clientId: randomUUID() }, status: 201 })).data.message;
  await realtime.waitMessage(nativeMessage.id);
  await request(`/communities/${community.id}/members/${outsider.user.id}`, { method: 'DELETE', auth: owner.auth, status: 204 });
  const secret = (await request(`/channels/${channelId}/messages`, { method: 'POST', auth: owner.auth, body: { content: `${prefix} native revoked secret`, clientId: randomUUID() }, status: 201 })).data.message;
  const control = (await request(`/channels/${controlChannel}/messages`, { method: 'POST', auth: owner.auth, body: { content: `${prefix} native membership barrier`, clientId: randomUUID() }, status: 201 })).data.message;
  await realtime.waitMessage(control.id);
  assert.ok(!realtime.frames.some((frame) => frame.message?.id === secret.id), 'A revoked native member must not receive private content before the ordered control barrier');
  await request(`/channels/${channelId}/messages`, { auth: nativeSession, requestOrigin: null, status: 403 });
  await request(`/channels/${channelId}/messages`, { method: 'POST', auth: nativeSession, requestOrigin: null, body: { content: 'native revoked write', clientId: randomUUID() }, status: 403 });
  const pendingNativeTicket = remember((await request('/events/ticket', { method: 'POST', auth: nativeSession, requestOrigin: null })).data.ticket);
  const nativeLogout = await request('/auth/logout', { method: 'POST', auth: nativeSession, requestOrigin: null, status: 204 });
  assert.equal(nativeLogout.response.headers.get('set-cookie'), null, 'Native logout must have no cookie side effects');
  const afterLogout = (await request(`/channels/${controlChannel}/messages`, { method: 'POST', auth: owner.auth, body: { content: `${prefix} native session revoked secret`, clientId: randomUUID() }, status: 201 })).data.message;
  await realtime.waitClosed();
  assert.ok(!realtime.frames.some((frame) => frame.message?.id === afterLogout.id), 'A revoked native session must close without receiving another message');
  await rejectWebSocket({ ticket: pendingNativeTicket, status: 401 });
  await request('/auth/me', { auth: nativeSession, requestOrigin: null, status: 401 });
  passed('native realtime enforces current membership and logout revokes both open sockets and pending tickets');

  for (let index = 0; index < 8; index++) {
    const ticket = await request('/events/ticket', { method: 'POST', auth: owner.auth });
    remember(ticket.data.ticket);
  }
  await request('/events/ticket', { method: 'POST', auth: owner.auth, status: 429 });
  await request('/auth/logout', { method: 'POST', auth: owner.auth, status: 204 });
  await request('/auth/me', { auth: owner.auth, status: 401 });
  passed('unconsumed realtime tickets are bounded per user');

  let limited = false;
  for (let index = 0; index < 40; index++) {
    const response = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(5000) });
    await response.arrayBuffer();
    if (response.status === 429) { limited = true; break; }
    assert.equal(response.status, 400, 'Invalid auth payload should fail validation before hashing');
  }
  assert.ok(limited, 'Authentication attempts must be rate bounded');
  passed('authentication request rate is bounded');
  await writeFile(resolve(outputDir, 'result.json'), JSON.stringify({ ok: true, runId, checks, resources }, null, 2));
  console.log(`Verified ${checks.length} acceptance groups; uniquely prefixed test records retained: ${prefix}`);
  console.log(`Report: ${resolve(outputDir, 'result.json')}`);
} catch (error) {
  process.exitCode = 1;
  const failure = redact(error?.stack ?? error);
  console.error(failure);
  if (backendLog) await writeFile(resolve(outputDir, 'result.json'), JSON.stringify({ ok: false, runId, checks, resources, error: failure }, null, 2));
} finally {
  for (const socket of sockets) socket.close();
  await stop();
  if (backendLog) await new Promise((resolvePromise) => backendLog.end(resolvePromise));
}
