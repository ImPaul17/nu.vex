// Real Linux Tauri/WebKit UI acceptance. Requires compiled binaries and two isolated PostgreSQL databases.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { tsImport } from 'tsx/esm/api';

const { parseTheme } = await tsImport('../packages/core/src/themes.ts', import.meta.url);

process.umask(0o077);
const root = resolve(import.meta.dirname, '..');
const runId = randomUUID();
const prefix = `native_${runId.replaceAll('-', '').slice(0, 12)}`;
const output = resolve(root, '.cache/verify-desktop', runId);
const apiPort = Number(process.env.NUVEX_DESKTOP_API_PORT ?? 3001);
const driverPort = Number(process.env.NUVEX_DESKTOP_DRIVER_PORT ?? 4444);
for (const port of [apiPort, driverPort]) assert.ok(Number.isInteger(port) && port >= 1024 && port < 65535, 'Invalid test port.');
assert.equal(new Set([apiPort, apiPort + 1, driverPort, driverPort + 1]).size, 4, 'Test ports must not overlap.');
const bases = [`http://127.0.0.1:${apiPort}`, `http://127.0.0.1:${apiPort + 1}`];
const databases = [process.env.NUVEX_DESKTOP_DATABASE_URL, process.env.NUVEX_DESKTOP_SECOND_DATABASE_URL];
for (const value of databases) {
  assert.ok(value, 'Provide two explicit isolated NUVEX_DESKTOP_*DATABASE_URL values.');
  const url = new URL(value);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol), 'Expected PostgreSQL test databases.');
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'This acceptance requires loopback test databases.');
}
assert.notEqual(databases[0], databases[1], 'Instance-isolation acceptance requires distinct databases.');
const serverBinary = resolve(process.env.NUVEX_SERVER_BIN ?? `${root}/apps/server/target/debug/nuvex-server`);
const appBinary = resolve(process.env.NUVEX_DESKTOP_BIN ?? `${root}/apps/desktop/src-tauri/target/debug/nuvex-desktop`);
const driverBinary = process.env.NUVEX_TAURI_DRIVER_BIN ?? 'tauri-driver';
const children = new Set();
const logStreams = [];
const secrets = new Set(databases);
const checks = [];
const apis = [null, null];
let driver;
let session;
let peerSocket;
let expired = false;
const watchdog = setTimeout(() => {
  expired = true;
  for (const child of children) child.kill('SIGTERM');
}, 240_000);
watchdog.unref();

function remember(value) { secrets.add(value); return value; }
function redact(value) {
  let result = String(value);
  for (const secret of secrets) result = result.replaceAll(secret, '[redacted]');
  return result.replace(/postgres(?:ql)?:\/\/[^\s]+/g, '[database URL redacted]').replace(/\b[a-f0-9]{64}\b/gi, '[opaque value redacted]');
}
function passed(name) { checks.push(name); console.log(`PASS ${name}`); }
async function waitFor(probe, label, timeout = 25_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline && !expired) {
    const value = await probe();
    if (value) return value;
    await delay(150);
  }
  throw new Error(`${label} timed out.`);
}
async function freePort(port) {
  const listener = createServer();
  await new Promise((yes, no) => { listener.once('error', no); listener.listen(port, '127.0.0.1', yes); });
  await new Promise((yes, no) => listener.close((error) => error ? no(error) : yes()));
}
function startOwned(binary, args, env, name) {
  const log = createWriteStream(resolve(output, `${name}.log`), { flags: 'a', mode: 0o600 });
  logStreams.push(log);
  const child = spawn(binary, args, { cwd: root, env: { ...process.env, ...env }, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  child.on('error', (error) => { child.nuvexSpawnError = error; });
  child.on('exit', () => children.delete(child));
  return child;
}
async function stopOwned(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const force = setTimeout(() => child.kill('SIGKILL'), 5000);
  try { await exited; } finally { clearTimeout(force); children.delete(child); }
}
function serverEnv(index) {
  return { NUVEX_DATABASE_URL: databases[index], NUVEX_BIND: `127.0.0.1:${apiPort + index}`, NUVEX_ALLOWED_ORIGIN: 'http://127.0.0.1:5173', NUVEX_INSECURE_DEV: 'true', NUVEX_REGISTRATION_OPEN: 'true', NUVEX_MIGRATE_ON_START: 'false', NUVEX_INSTANCE_NAME: `native instance ${index + 1}`, RUST_LOG: 'nuvex_server=info' };
}
async function startApi(index, migrate = false) {
  await freePort(apiPort + index);
  if (migrate) {
    const migration = startOwned(serverBinary, ['--migrate'], serverEnv(index), `migration-${index}`);
    const timeout = setTimeout(() => migration.kill('SIGTERM'), 30_000);
    try { const [code] = await once(migration, 'exit'); assert.equal(code, 0, 'Migration failed; inspect private logs.'); }
    finally { clearTimeout(timeout); }
  }
  apis[index] = startOwned(serverBinary, [], serverEnv(index), `server-${index}`);
  await waitFor(async () => {
    if (apis[index].nuvexSpawnError) throw apis[index].nuvexSpawnError;
    assert.equal(apis[index].exitCode, null, 'Owned API exited before readiness.');
    try { return (await fetch(`${bases[index]}/health/ready`, { signal: AbortSignal.timeout(1000) })).ok; }
    catch { return false; }
  }, 'Native test API readiness', 40_000);
}
async function api(index, path, { method = 'GET', token, body, status = 200 } = {}) {
  const headers = new Headers();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  // Native transport deliberately supplies neither Origin nor Cookie.
  const response = await fetch(`${bases[index]}/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(10_000) });
  const payload = response.status === 204 ? {} : await response.json();
  assert.equal(response.status, status, `Native API ${method} expected ${status}; got ${response.status} (${payload.error?.code ?? 'no code'}).`);
  assert.equal(response.headers.get('set-cookie'), null, 'Native API must not create browser cookies.');
  return payload;
}
async function command(path, body, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(`http://127.0.0.1:${driverPort}${path}`, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
  const payload = await response.json();
  if (!response.ok || payload.value?.error) throw new Error(`WebDriver command failed (${payload.value?.error ?? response.status}).`);
  return payload.value;
}
const inSession = (path, body, method) => command(`/session/${session}${path}`, body, method);
const execute = (script, args = []) => inSession('/execute/sync', { script, args });
const executeAsync = (script, args = []) => inSession('/execute/async', { script, args });
async function element(using, value) {
  const found = await waitFor(async () => {
    const items = await inSession('/elements', { using, value });
    return items[0];
  }, `UI element ${value}`);
  return found['element-6066-11e4-a52e-4f735466cecf'];
}
const css = (selector) => element('css selector', selector);
async function clickText(text, contains = false) {
  assert.ok(!text.includes("'"), 'Button selector requires a quote-free literal.');
  const id = await element('xpath', `//button[${contains ? `contains(normalize-space(.),'${text}')` : `normalize-space(.)='${text}'`}]`);
  await clickElement(id);
}
async function clickElement(id) {
  await waitFor(() => inSession(`/element/${id}/enabled`), 'Enabled native UI control');
  await inSession(`/element/${id}/click`, {});
}
async function clickCss(selector) { await clickElement(await css(selector)); }
async function fill(selector, value) {
  const id = await css(selector); await waitFor(() => inSession(`/element/${id}/enabled`), 'Enabled native UI input');
  await inSession(`/element/${id}/clear`, {}); await inSession(`/element/${id}/value`, { text: value });
}
async function textVisible(text, selector = 'body') {
  await waitFor(() => execute('return document.querySelector(arguments[0])?.textContent.includes(arguments[1]) ?? false;', [selector, text]), `UI text ${text}`);
}
async function has(selector) { return execute('return Boolean(document.querySelector(arguments[0]));', [selector]); }
async function safeScreenshot() {
  if (!session || !await has('.account-profile') || await has('dialog[open],[role="dialog"],input[type="password"],#first-invite')) return;
  const visibleText = await execute('return document.body.textContent;');
  if (/\b[a-f0-9]{64}\b/i.test(visibleText) || [...secrets].some((value) => visibleText.includes(value))) return;
  const encoded = await inSession('/screenshot');
  assert.ok(typeof encoded === 'string' && encoded.length < 7_000_000, 'Native screenshot exceeds its artifact bound.');
  const png = Buffer.from(encoded, 'base64');
  assert.ok(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'Native WebDriver screenshot is not PNG.');
  await writeFile(resolve(output, 'native.png'), png, { mode: 0o600 });
}
async function safeDiagnostic() {
  if (!session) return { nativeSession: false };
  try {
    const state = await execute('return {nativeSession:true,nativeIpc:Boolean(window.__TAURI_INTERNALS__?.invoke),url:location.href,heading:document.querySelector(".entry-card h2")?.textContent,alerts:[...document.querySelectorAll("[role=alert],.form-error")].map(node=>node.textContent?.slice(0,300)).slice(0,4)};');
    return JSON.parse(redact(JSON.stringify(state)));
  } catch { return { nativeSession: true, diagnosticUnavailable: true }; }
}
async function openApp() {
  const created = await command('/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: appBinary } } } });
  assert.ok(created.sessionId, 'Driver did not create a native application session.'); session = created.sessionId;
  await inSession('/timeouts', { implicit: 0, script: 15_000, pageLoad: 30_000 });
  const url = await inSession('/url');
  assert.ok(!url.startsWith('http://127.0.0.1:5173') && !url.startsWith('http://localhost:5173'), 'Acceptance must load bundled assets, not Vite.');
  await waitFor(async () => await has('#instance-url') || await has('.instance-chip'), 'Native connection UI', 35_000);
}
async function closeApp() { if (session) { const own = session; session = undefined; await command(`/session/${own}`, undefined, 'DELETE'); } }
async function selectInstance(index) {
  if (!await has('#instance-url')) await clickText('Cambiar');
  await fill('#instance-url', bases[index]); await clickText('Conectar a la instancia');
  await textVisible('De vuelta con tu equipo.', '.entry-card');
}
async function registerUi(index) {
  await clickText('Crear una cuenta');
  await fill('#display-name', `Native ${prefix}`); await fill('#handle', `${prefix}_ui`);
  await fill('#email', `${prefix}@example.test`); await fill('#password', uiPassword);
  await clickText('Crear cuenta'); await textVisible('Tu primer espacio.', '.entry-card');
  assert.equal(await has('.account-profile'), false, `New instance ${index} must not inherit private workspace data.`);
}
async function loginUi() {
  await fill('#email', `${prefix}@example.test`); await fill('#password', uiPassword); await clickText('Iniciar sesión');
  await waitFor(() => has('.account-profile'), 'Authenticated native workspace');
}
async function logoutUi() {
  await clickCss('button[aria-label="Abrir ajustes"]'); await clickText('Cerrar sesión y cambiar de instancia', true);
  await textVisible('De vuelta con tu equipo.', '.entry-card');
  assert.equal(await has('.account-profile'), false, 'Logout must remove the private workspace.');
}
async function sendUi(content) { await fill('textarea[aria-label="Escribir mensaje"]', content); await clickCss('button[aria-label="Enviar mensaje"]'); await textVisible(content, '.messages'); }
async function openPeer(token) {
  const { ticket } = await api(0, '/events/ticket', { method: 'POST', token }); remember(ticket);
  const socket = new WebSocket(`${bases[0].replace('http:', 'ws:')}/api/v1/events?ticket=${encodeURIComponent(ticket)}`);
  const received = [];
  socket.addEventListener('message', ({ data }) => { if (received.length < 128) { try { received.push(JSON.parse(data)); } catch { /* Not a valid event. */ } } });
  await Promise.race([once(socket, 'open'), once(socket, 'error').then(() => { throw new Error('Native peer WebSocket failed.'); }), delay(10_000).then(() => { throw new Error('Native peer WebSocket timed out.'); })]);
  return { socket, received };
}
const uiPassword = remember(`Native-${randomBytes(24).toString('base64url')}`);

try {
  await mkdir(output, { recursive: true, mode: 0o700 });
  await access(serverBinary); await access(appBinary);
  await startApi(0, true); await startApi(1, true);
  await freePort(driverPort); await freePort(driverPort + 1);
  driver = startOwned(driverBinary, ['--port', String(driverPort), '--native-port', String(driverPort + 1)], {}, 'driver');
  await waitFor(async () => {
    if (driver.nuvexSpawnError) throw driver.nuvexSpawnError;
    assert.equal(driver.exitCode, null, 'Native WebDriver exited before readiness.');
    try { return (await fetch(`http://127.0.0.1:${driverPort}/status`, { signal: AbortSignal.timeout(1000) })).ok; } catch { return false; }
  }, 'Native WebDriver readiness');

  const peerPassword = remember(`Peer-${randomBytes(24).toString('base64url')}`);
  const peer = await api(0, '/auth/register', { method: 'POST', status: 201, body: { email: `${prefix}.peer@example.test`, handle: `${prefix}_peer`, displayName: `Peer ${prefix}`, password: peerPassword, transport: 'bearer' } });
  const peerToken = remember(peer.accessToken); assert.match(peerToken, /^[a-f0-9]{64}$/);
  const { community } = await api(0, '/communities', { method: 'POST', token: peerToken, status: 201, body: { name: `Native acceptance ${prefix}` } });
  const channelId = community.channels[0].id;
  const { code } = await api(0, `/communities/${community.id}/invites`, { method: 'POST', token: peerToken, status: 201 }); remember(code);

  await openApp(); await selectInstance(0); await registerUi(0);
  await clickText('Tengo una invitación'); await fill('#first-invite', code); await clickText('Unirme a la comunidad');
  await textVisible('general', '.channel-header'); await textVisible('CONECTADO', '.preview-badge');
  passed('bundled native UI connects, registers, and joins a real PostgreSQL-backed instance');

  await api(0, '/instance');
  const directFetch = await executeAsync(`const done=arguments[arguments.length-1]; const target=arguments[0]+"/api/v1/instance";
    let rejected=false,violation=false,settled=false,finished=false;
    const finish=()=>{if(finished)return;finished=true;clearTimeout(timer);document.removeEventListener('securitypolicyviolation',onViolation);done({rejected,violation});};
    const onViolation=(event)=>{if(event.effectiveDirective!=='connect-src')return;let matches=false;
      try{const requested=new URL(target);const blocked=new URL(event.blockedURI);matches=blocked.href===requested.href||blocked.href===requested.origin+'/';}catch{}
      if(matches){violation=true;if(settled)finish();}};
    document.addEventListener('securitypolicyviolation',onViolation);
    const timer=setTimeout(finish,1000);
    fetch(target,{mode:'no-cors',credentials:'omit',cache:'no-store'}).then(()=>{settled=true;if(violation)finish();},()=>{rejected=true;settled=true;if(violation)finish();});`, [bases[0]]);
  await api(0, '/instance');
  assert.deepEqual(directFetch, { rejected: true, violation: true }, 'Direct no-cors webview fetch must be rejected by a connect-src CSP violation for the available instance endpoint.');
  passed('direct webview fetch is blocked by observed connect-src CSP while the same endpoint remains reachable from Node');

  await clickCss('.personalize-card'); await clickText('Ver JSON');
  await css('#theme-json');
  const exportedTheme = await execute('const field=document.querySelector("#theme-json");return {value:field.value,readOnly:field.readOnly};');
  assert.equal(exportedTheme.readOnly, true, 'Native theme export must expose a read-only copyable JSON view.');
  const parsedTheme = parseTheme(exportedTheme.value);
  assert.deepEqual(parsedTheme, JSON.parse(exportedTheme.value), 'Native theme JSON must satisfy the shared data-only theme validator without extra fields.');
  assert.ok(![...secrets].some((value) => exportedTheme.value.includes(value)), 'Native theme export must not include session or account credentials.');
  await clickCss('button[aria-label="Cerrar diálogo"]');
  assert.equal(await has('dialog[open]'), false, 'Native appearance dialog must close through its actual control.');
  passed('native appearance exposes validated data-only theme JSON for manual copying without credentials or downloads');

  peerSocket = await openPeer(peerToken);
  const outbound = `${prefix} from the native window`;
  await sendUi(outbound);
  await waitFor(() => peerSocket.received.some((event) => event.type === 'message.created' && event.message?.content === outbound), 'HTTP peer receives native send through real WebSocket');
  const incoming = `${prefix} from the independent account`;
  await api(0, `/channels/${channelId}/messages`, { method: 'POST', token: peerToken, status: 201, body: { content: incoming, clientId: randomUUID() } });
  await textVisible(incoming, '.messages');
  passed('native sends reach another account and committed WebSocket replies reach the native UI');

  peerSocket.socket.close(); peerSocket = undefined;
  await stopOwned(apis[0]); await startApi(0);
  const history = await api(0, `/channels/${channelId}/messages?limit=100`, { token: peerToken });
  assert.ok(history.messages.some((item) => item.content === outbound));
  assert.ok(history.messages.some((item) => item.content === incoming));
  const restored = `${prefix} after server restart`;
  await api(0, `/channels/${channelId}/messages`, { method: 'POST', token: peerToken, status: 201, body: { content: restored, clientId: randomUUID() } });
  await textVisible(restored, '.messages');
  passed('real process restart preserves history and native reconnection converges');

  await logoutUi(); await loginUi(); await textVisible(outbound, '.messages');
  const oldDocument = await executeAsync(`const done=arguments[arguments.length-1];
    window.__TAURI_INTERNALS__.invoke('nuvex_document').then(done,()=>done(null));`);
  assert.match(oldDocument?.documentId ?? '', /^[a-f0-9-]{36}$/i, 'The authenticated document must have a native identity.');
  await inSession('/refresh', {});
  await textVisible('De vuelta con tu equipo.', '.entry-card');
  assert.equal(await has('.account-profile'), false, 'Document reload must clear the native credential and private workspace.');
  const newDocument = await executeAsync(`const done=arguments[arguments.length-1];
    window.__TAURI_INTERNALS__.invoke('nuvex_document').then(done,()=>done(null));`);
  assert.match(newDocument?.documentId ?? '', /^[a-f0-9-]{36}$/i, 'The reloaded document must have a native identity.');
  assert.notEqual(newDocument.documentId, oldDocument.documentId, 'A real reload must rotate the native document nonce.');
  const staleDocument = await executeAsync(`const done=arguments[arguments.length-1];const [origin,documentId]=arguments;
    window.__TAURI_INTERNALS__.invoke('nuvex_connect',{origin,order:Date.now(),documentId})
      .then(()=>done(false),(error)=>done(error?.code==='stale_session'));`, [bases[1], oldDocument.documentId]);
  assert.equal(staleDocument, true, 'A previous document nonce must be rejected even with a larger selection order.');
  await loginUi(); await textVisible(restored, '.messages');
  await closeApp(); await openApp();
  if (await has('#instance-url')) await selectInstance(0);
  await textVisible('De vuelta con tu equipo.', '.entry-card');
  assert.equal(await has('.account-profile'), false, 'Native process restart must not restore a bearer credential from storage.');
  await loginUi(); await textVisible(restored, '.messages'); await logoutUi();
  passed('logout, document reload, and process restart clear local credentials while stale document selection cannot replace the new session');

  await selectInstance(1); await registerUi(1);
  await fill('#first-community', `Independent ${prefix}`); await clickCss('.entry-form button[type="submit"]');
  const isolated = `${prefix} in the second instance`;
  await sendUi(isolated);
  assert.equal(await execute('return document.body.textContent.includes(arguments[0]);', [outbound]), false, 'Switching instances must discard prior private messages.');
  const storage = await execute('return {keys:[...Object.keys(localStorage),...Object.keys(sessionStorage)],values:[...Object.values(localStorage),...Object.values(sessionStorage)]};');
  assert.ok(!storage.keys.some((key) => /token|credential|password|auth/i.test(key)), 'Browser storage must not hold authentication entries.');
  assert.ok(!storage.values.some((value) => /\b[a-f0-9]{64}\b/i.test(value)), 'Browser storage must not contain opaque bearer credentials.');
  await safeScreenshot();
  passed('a second real instance has isolated account/workspace state and no browser credential storage');
  await logoutUi();

  const boundary = await executeAsync(`const done=arguments[arguments.length-1]; const [first,second,password,email]=arguments; (async()=>{
    const invoke=window.__TAURI_INTERNALS__?.invoke; if(!invoke)throw Error('Native IPC unavailable');
    const {documentId}=await invoke('nuvex_document');
    const order=1_000_000; const a=await invoke('nuvex_connect',{origin:first,order,documentId});
    const b=await invoke('nuvex_connect',{origin:second,order:order+1,documentId});
    const rejected=async(command,args)=>{try{await invoke(command,args);return false;}catch{return true;}};
    const stale=await rejected('nuvex_request',{handle:a.handle,path:'/instance',method:'GET'});
    const route=await rejected('nuvex_request',{handle:b.handle,path:'/../../health/live',method:'GET'});
    const windowPermission=await rejected('plugin:window|set_title',{label:'main',value:'ungranted native permission'});
    const login=await invoke('nuvex_request',{handle:b.handle,path:'/auth/login',method:'POST',body:JSON.stringify({email,password,transport:'bearer'})});
    const noToken=login.status===200 && !Object.hasOwn(login.payload,'accessToken');
    await invoke('nuvex_request',{handle:b.handle,path:'/auth/logout',method:'POST'});
    await invoke('nuvex_dispose',{handle:b.handle});
    return {stale,route,windowPermission,noToken};
  })().then(done,()=>done({failed:true}));`, [bases[0], bases[1], uiPassword, `${prefix}@example.test`]);
  assert.deepEqual(boundary, { stale: true, route: true, windowPermission: true, noToken: true }, 'Real IPC must reject stale handles, unknown routes, and ungranted window commands, and hide authentication tokens.');
  passed('actual IPC enforces generation/route/window boundaries and strips bearer tokens from authentication DTOs');

  await writeFile(resolve(output, 'result.json'), JSON.stringify({ ok: true, runId, checks, platform: process.platform, appBinary, apiOrigins: bases, nativeWebDriver: true, mockedIpc: false }, null, 2), { mode: 0o600 });
  console.log(`Verified ${checks.length} native acceptance groups against two isolated real instances. No installers or native runtime claims for other operating systems.`);
} catch (error) {
  process.exitCode = 1;
  const failure = redact(error?.stack ?? error);
  console.error(failure);
  await mkdir(output, { recursive: true, mode: 0o700 });
  try { await safeScreenshot(); } catch { /* Failure evidence must not replace the original diagnostic. */ }
  await writeFile(resolve(output, 'result.json'), JSON.stringify({ ok: false, runId, checks, error: failure, diagnostic: await safeDiagnostic() }, null, 2), { mode: 0o600 });
} finally {
  clearTimeout(watchdog);
  peerSocket?.socket.close();
  try { await closeApp(); } catch { /* Owned driver teardown below also closes the application. */ }
  await Promise.allSettled([...children].map(stopOwned));
  await Promise.allSettled(logStreams.map((stream) => new Promise((yes) => stream.end(yes))));
}
