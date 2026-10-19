// Production-policy Rust transport against a real instance and private TLS fixtures.
// Certificate trust is prepared separately on disposable CI runners, never here.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { constants, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { access, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { isAbsolute, relative, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createSecureContext } from 'node:tls';

process.umask(0o077);
const root = resolve(import.meta.dirname, '..');
const runId = randomUUID();
const output = resolve(root, '.cache/verify-native-tls', runId);
const secrets = new Set([process.env.NUVEX_TLS_DATABASE_URL].filter(Boolean));
const children = new Set();
const streams = [];
const servers = [];
const sockets = new Set();
const agent = new http.Agent({ keepAlive: true, maxSockets: 8 });
const history = [];
const negotiated = new Set();
let state;
let contexts;
let pairs;
let frontend;
let activeCertificate = 'valid';
let apiPort;
let sinkOrigins;
let expired = false;
let certificateDigest;
const watchdog = setTimeout(() => {
  expired = true;
  for (const child of children) child.kill('SIGTERM');
  for (const socket of sockets) socket.destroy();
}, 240_000);
watchdog.unref();

function remember(value) { secrets.add(value); return value; }
function redact(value) {
  let result = String(value);
  for (const secret of secrets) result = result.replaceAll(secret, '[redacted]');
  return result.replace(/postgres(?:ql)?:\/\/[^\s]+/g, '[database URL redacted]')
    .replace(/\b[a-f0-9]{64}\b/gi, '[opaque value redacted]');
}
function counters() {
  return { ticketSuccesses: 0, newTlsConnections: 0, tlsFailures: 0, proxyRequests: 0,
    upgradeRequests: 0, upstreamUpgradeRequests: 0, sinkRequests: 0, sinkConnections: 0, upstreamRequests: 0 };
}
function snapshot() { return state ? { ...state, ...state.stats, stats: undefined } : null; }
function track(socket) { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); }
async function listen(server) {
  servers.push(server);
  await new Promise((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes); });
  return server.address().port;
}
async function freePort(port) {
  const server = net.createServer();
  await new Promise((yes, no) => { server.once('error', no); server.listen(port, '127.0.0.1', yes); });
  await new Promise((yes, no) => server.close((error) => error ? no(error) : yes()));
}
function owned(binary, args, env, name) {
  const log = createWriteStream(resolve(output, `${name}.log`), { mode: 0o600 });
  streams.push(log);
  const child = spawn(binary, args, { cwd: root, env: { ...process.env, ...env }, windowsHide: true,
    shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  child.nuvexLog = log;
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  child.on('error', (error) => { child.nuvexSpawnError = error; });
  child.on('exit', () => children.delete(child));
  return child;
}
async function stop(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  const ended = once(child, 'exit'); child.kill('SIGTERM');
  const force = setTimeout(() => child.kill('SIGKILL'), 5000);
  try { await ended; } finally { clearTimeout(force); }
}
async function completed(child, label, timeout) {
  const timer = setTimeout(() => child.kill('SIGTERM'), timeout);
  try {
    const [code] = await once(child, 'close');
    await new Promise((yes) => child.nuvexLog.end(yes));
    assert.equal(code, 0, `${label} failed; inspect redacted result and private process log.`);
  }
  finally { clearTimeout(timer); }
}
async function ready(child) {
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline && !expired) {
    if (child.nuvexSpawnError) throw new Error('The owned instance could not be started.');
    assert.equal(child.exitCode, null, 'Owned instance exited before readiness.');
    try { if ((await fetch(`http://127.0.0.1:${apiPort}/health/ready`, { signal: AbortSignal.timeout(1000) })).ok) return; }
    catch { /* Retry the same owned process while it initializes. */ }
    await delay(150);
  }
  throw new Error('Owned production-config instance readiness timed out.');
}
function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}
function activate(name) {
  activeCertificate = name;
  frontend.setSecureContext(pairs[name]);
  frontend.setTicketKeys(randomBytes(48));
}
function redirectLocation(request, websocket) {
  const origin = sinkOrigins[state.target];
  const url = new URL('/capture', origin);
  if (websocket) {
    url.protocol = state.target === 'https' ? 'wss:' : 'ws:';
    url.search = new URL(request.url, 'https://localhost').search;
  }
  return url.href;
}
function proxy(request, response) {
  state.stats.proxyRequests++;
  const path = new URL(request.url, 'https://localhost').pathname;
  if (state.mode === 'http-redirect' && path === state.path) {
    response.writeHead(state.status, { Location: redirectLocation(request, false), 'Content-Length': '0' });
    request.resume(); response.end(); return;
  }
  state.stats.upstreamRequests++;
  const upstream = http.request({ host: '127.0.0.1', port: apiPort, path: request.url,
    method: request.method, headers: request.rawHeaders, agent }, (incoming) => {
    if (path === '/api/v1/events/ticket' && incoming.statusCode === 200) {
      state.stats.ticketSuccesses++;
      const changed = { 'ws-untrusted': 'untrusted', 'ws-expired': 'expired', 'ws-hostname': 'wrongSan' }[state.mode];
      if (changed) activate(changed);
    }
    response.writeHead(incoming.statusCode, incoming.rawHeaders);
    incoming.pipe(response);
  });
  upstream.on('error', () => { if (!response.headersSent) json(response, 502, { error: 'owned upstream unavailable' }); else response.destroy(); });
  request.on('aborted', () => upstream.destroy());
  request.pipe(upstream);
}
function upgrade(request, socket, head) {
  state.stats.proxyRequests++; state.stats.upgradeRequests++;
  if (state.mode === 'ws-redirect') {
    socket.end(`HTTP/1.1 ${state.status} Redirect\r\nLocation: ${redirectLocation(request, true)}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`);
    return;
  }
  state.stats.upstreamRequests++; state.stats.upstreamUpgradeRequests++;
  const upstream = net.connect({ host: '127.0.0.1', port: apiPort }, () => {
    const lines = [`${request.method} ${request.url} HTTP/${request.httpVersion}`];
    for (let index = 0; index < request.rawHeaders.length; index += 2) lines.push(`${request.rawHeaders[index]}: ${request.rawHeaders[index + 1]}`);
    upstream.write(lines.join('\r\n') + '\r\n\r\n');
    if (head.length) upstream.write(head);
    socket.pipe(upstream); upstream.pipe(socket);
  });
  track(upstream);
  upstream.on('error', () => socket.destroy()); socket.on('error', () => upstream.destroy());
  socket.once('close', () => upstream.destroy()); upstream.once('close', () => socket.destroy());
}
function tlsServer(certificate, dynamic = false) {
  const server = https.createServer({ ...pairs[certificate], minVersion: 'TLSv1.2',
    secureOptions: constants.SSL_OP_NO_TICKET,
    SNICallback(_name, done) { done(null, contexts[dynamic ? activeCertificate : certificate]); } }, proxy);
  server.on('connection', (socket) => { track(socket); state.stats.newTlsConnections++; });
  server.on('secureConnection', (socket) => negotiated.add(socket.getProtocol()));
  server.on('tlsClientError', () => { state.stats.tlsFailures++; });
  server.on('clientError', (_error, socket) => socket.destroy());
  server.on('upgrade', upgrade);
  return server;
}
function authorize(request, token) {
  const supplied = request.headers['x-nuvex-test-control'];
  if (typeof supplied !== 'string' || request.headers.origin || request.headers.cookie || request.headers.authorization) return false;
  const bytes = Buffer.from(supplied); const expected = Buffer.from(token);
  return bytes.length === expected.length && timingSafeEqual(bytes, expected);
}
async function control(request, response, token) {
  if (!authorize(request, token)) return json(response, 403, { error: 'control denied' });
  if (request.method === 'GET' && request.url === '/state') return json(response, 200, snapshot());
  if (request.method !== 'POST' || request.url !== '/configure') return json(response, 404, { error: 'unknown control route' });
  try {
    const chunks = []; let size = 0;
    for await (const chunk of request) { size += chunk.length; if (size > 4096) return json(response, 413, { error: 'bounded control body required' }); chunks.push(chunk); }
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const keys = Object.keys(value);
    assert.ok(keys.every((key) => ['caseId', 'mode', 'status', 'target', 'path'].includes(key)));
    assert.match(value.caseId, /^[a-z0-9_-]{1,80}$/i);
    assert.ok(['pass', 'ws-untrusted', 'ws-expired', 'ws-hostname', 'http-redirect', 'ws-redirect'].includes(value.mode));
    if (value.mode.endsWith('redirect')) {
      assert.ok([307, 308].includes(value.status)); assert.ok(['http', 'https'].includes(value.target));
      if (value.mode === 'http-redirect') assert.ok(['/api/v1/auth/login', '/api/v1/bootstrap'].includes(value.path));
    }
    if (state?.caseId !== 'initial') history.push(snapshot());
    state = { ...value, stats: counters() }; activate('valid');
    return json(response, 200, { ok: true });
  } catch { return json(response, 400, { error: 'invalid control configuration' }); }
}

try {
  await mkdir(output, { recursive: true, mode: 0o700 });
  assert.ok(['linux', 'win32'].includes(process.platform), 'TLS acceptance currently supports Windows and Linux.');
  const database = process.env.NUVEX_TLS_DATABASE_URL;
  assert.ok(database, 'Provide an explicit isolated NUVEX_TLS_DATABASE_URL.');
  let databaseUrl;
  try { databaseUrl = new URL(database); } catch { throw new Error('The isolated TLS-test database URL is invalid.'); }
  assert.ok(['postgres:', 'postgresql:'].includes(databaseUrl.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(databaseUrl.hostname), 'TLS acceptance requires an isolated loopback PostgreSQL database.');
  const certificateFile = process.env.NUVEX_TLS_CERTIFICATES;
  assert.ok(certificateFile && isAbsolute(certificateFile), 'Provide an absolute NUVEX_TLS_CERTIFICATES fixture path.');
  const fixture = JSON.parse(await readFile(certificateFile, 'utf8'));
  assert.equal(fixture.version, 1, 'Unknown certificate fixture format.');
  const fixtureRoot = await realpath(fixture.root);
  pairs = {}; contexts = {};
  for (const name of ['valid', 'untrusted', 'expired', 'wrongSan']) {
    pairs[name] = {};
    for (const field of ['key', 'cert']) {
      const file = await realpath(fixture[name][field]); const inside = relative(fixtureRoot, file);
      assert.ok(inside && !inside.startsWith('..') && !isAbsolute(inside), 'Certificate material must stay in its dedicated fixture directory.');
      pairs[name][field] = await readFile(file);
    }
    contexts[name] = createSecureContext(pairs[name]);
  }
  certificateDigest = fixture.ca.sha256;
  state = { caseId: 'initial', mode: 'pass', stats: counters() };
  frontend = tlsServer('valid', true);
  const validOrigin = `https://localhost:${await listen(frontend)}`;
  const invalidOrigins = {};
  for (const [label, certificate] of [['untrusted', 'untrusted'], ['expired', 'expired'], ['hostname', 'wrongSan']]) {
    invalidOrigins[label] = `https://localhost:${await listen(tlsServer(certificate))}`;
  }
  sinkOrigins = {};
  for (const scheme of ['http', 'https']) {
    const received = (request, response) => { state.stats.sinkRequests++; request.resume(); json(response, 200, { unexpectedRedirect: true }); };
    const server = scheme === 'https' ? https.createServer(pairs.valid, received) : http.createServer(received);
    server.on('connection', (socket) => { track(socket); state.stats.sinkConnections++; });
    server.on('tlsClientError', () => {});
    server.on('upgrade', (_request, socket) => { state.stats.sinkRequests++; socket.end('HTTP/1.1 400 Unexpected redirect\r\nContent-Length: 0\r\n\r\n'); });
    sinkOrigins[scheme] = `${scheme}://localhost:${await listen(server)}`;
  }
  const controlToken = remember(randomBytes(32).toString('hex'));
  const controlServer = http.createServer((request, response) => { void control(request, response, controlToken).catch(() => response.destroy()); });
  controlServer.on('connection', track);
  const controlOrigin = `http://127.0.0.1:${await listen(controlServer)}`;
  apiPort = Number(process.env.NUVEX_TLS_API_PORT ?? 3101);
  assert.ok(Number.isInteger(apiPort) && apiPort >= 1024 && apiPort <= 65535, 'Invalid owned TLS-test API port.');
  await freePort(apiPort);
  const serverBinary = resolve(process.env.NUVEX_SERVER_BIN ?? `apps/server/target/debug/nuvex-server${process.platform === 'win32' ? '.exe' : ''}`);
  await access(serverBinary);
  const env = { NUVEX_DATABASE_URL: database, NUVEX_BIND: `127.0.0.1:${apiPort}`,
    NUVEX_ALLOWED_ORIGIN: validOrigin, NUVEX_INSECURE_DEV: 'false', NUVEX_REGISTRATION_OPEN: 'true',
    NUVEX_MIGRATE_ON_START: 'false', NUVEX_TRUSTED_PROXIES: '', NUVEX_INSTANCE_NAME: 'TLS acceptance instance', RUST_LOG: 'nuvex_server=info' };
  await completed(owned(serverBinary, ['--migrate'], env, 'migration'), 'Owned TLS-test migration', 30_000);
  const instance = owned(serverBinary, [], env, 'server'); await ready(instance);
  const account = { email: `tls.${runId}@example.test`, handle: `tls_${runId.replaceAll('-', '').slice(0, 12)}`,
    displayName: 'TLS acceptance', password: remember(`Tls-${randomBytes(24).toString('base64url')}`) };
  const runtimeFile = resolve(fixtureRoot, `runtime-${runId}.json`);
  await writeFile(runtimeFile, JSON.stringify({ version: 1, runId, validOrigin, invalidOrigins, controlOrigin, controlToken, account }), { mode: 0o600, flag: 'wx' });
  const cargo = process.env.NUVEX_CARGO_BIN ?? 'cargo';
  const probe = owned(cargo, ['test', '--manifest-path', 'apps/desktop/transport/Cargo.toml', '--locked', '--offline', '--test', 'tls', '--', '--ignored', '--test-threads=1', '--nocapture'],
    { NUVEX_TLS_FIXTURE_FILE: runtimeFile }, 'rust-tls');
  await completed(probe, 'Real Rust production-policy TLS acceptance', 150_000);
  if (state?.caseId !== 'initial') history.push(snapshot());
  const expectedCases = ['valid_https_wss_reconnect', 'final_authenticated_logout',
    ...['untrusted', 'expired', 'hostname'].flatMap((kind) => [`https_${kind}`, `wss_${kind}`]),
    ...[307, 308].flatMap((status) => [`https_redirect_${status}_password`, `https_redirect_${status}_bearer`, `wss_redirect_${status}`])];
  assert.equal(history.length, expectedCases.length, 'The Rust probe did not execute the complete TLS/redirect case matrix.');
  assert.deepEqual(history.map((item) => item.caseId).sort(), expectedCases.sort(), 'The Rust probe omitted or duplicated a required TLS case.');
  await writeFile(resolve(output, 'result.json'), JSON.stringify({ ok: true, runId, platform: process.platform,
    productionTransportPolicy: true, apiInsecureDev: false, mockedTls: false, certificateCaSha256: certificateDigest,
    negotiatedTlsVersions: [...negotiated].sort(), cases: history }, null, 2), { mode: 0o600 });
  console.log(`Verified ${history.length} real TLS/redirect cases with production transport policy and an actual PostgreSQL-backed instance.`);
} catch (error) {
  process.exitCode = 1;
  const failure = redact(error?.stack ?? error);
  console.error(failure);
  await mkdir(output, { recursive: true, mode: 0o700 });
  let probeDiagnostic;
  try { probeDiagnostic = redact((await readFile(resolve(output, 'rust-tls.log'), 'utf8')).slice(-4000)); }
  catch { /* A failure before the probe has no Rust diagnostic. */ }
  await writeFile(resolve(output, 'result.json'), JSON.stringify({ ok: false, runId, platform: process.platform,
    error: failure, probeDiagnostic, cases: [...history, snapshot()].filter(Boolean) }, null, 2), { mode: 0o600 });
} finally {
  clearTimeout(watchdog);
  agent.destroy();
  for (const socket of sockets) socket.destroy();
  await Promise.allSettled(servers.map((server) => new Promise((yes) => server.close(yes))));
  await Promise.allSettled([...children].map(stop));
  await Promise.allSettled(streams.filter((stream) => !stream.writableFinished).map((stream) => new Promise((yes) => stream.end(yes))));
}
