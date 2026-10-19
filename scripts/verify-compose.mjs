// Run only against a uniquely named disposable CI Compose project, after `up --wait`.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { captureDocker, docker, repositoryRoot } from '../infra/db-tools.mjs';

process.umask(0o077);
const project = process.env.COMPOSE_PROJECT_NAME;
assert.ok(/^nuvex-ci-[a-z0-9-]{8,}$/.test(project ?? ''), 'Prepare a disposable nuvex-ci-* Compose project first.');
assert.ok(process.env.COMPOSE_ENV_FILES, 'An explicit disposable Compose environment file is required.');
const baseURL = process.env.NUVEX_E2E_BASE_URL ?? 'http://127.0.0.1:8080';
const parsedURL = new URL(baseURL);
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(parsedURL.hostname), 'Verification must target loopback.');
process.env.NUVEX_VERIFY_COMPOSE_PROJECT = project;
process.env.NUVEX_VERIFY_BASE_URL = parsedURL.origin;

function nodeScript(path, args) {
  const result = spawnSync(process.execPath, [resolve(repositoryRoot, path), ...args], {
    cwd: repositoryRoot, env: process.env, stdio: 'inherit', shell: false, timeout: 90000,
  });
  if (result.error) throw new Error(`Verification helper failed: ${result.error.message}`);
  assert.equal(result.status, 0, `Verification helper ${path} failed`);
}

const api = await fetch(`${parsedURL.origin}/api/v1/instance`, { signal: AbortSignal.timeout(5000) });
assert.equal(api.status, 200, 'Nginx must proxy the real instance API.');
const page = await fetch(parsedURL.origin, { signal: AbortSignal.timeout(5000) });
assert.equal(page.status, 200, 'Nginx must serve the built application.');
const csp = page.headers.get('content-security-policy') ?? '';
const scriptPolicy = csp.split(';').find((directive) => directive.trim().startsWith('script-src ')) ?? '';
assert.ok(scriptPolicy.includes('sha256-') && !scriptPolicy.includes("'unsafe-inline'"), 'The production web server must serve a generated strict script policy.');
const connectionPolicy = csp.split(';').find((directive) => directive.trim().startsWith('connect-src ')) ?? '';
const remoteURL = process.env.NUVEX_E2E_REMOTE_URL;
if (remoteURL) {
  assert.equal(remoteURL, 'http://127.0.0.1:8081', 'Only the isolated CI loopback remote probe is permitted.');
  assert.ok(connectionPolicy.includes('http://127.0.0.1:8081') && connectionPolicy.includes('ws://127.0.0.1:8081'), 'The built CSP must permit the explicit API and WebSocket probe origins.');
  const remote = await fetch(`${remoteURL}/api/v1/instance`, { headers: { Origin: parsedURL.origin }, signal: AbortSignal.timeout(5000) });
  assert.equal(remote.status, 200, 'The secondary Nginx binding must proxy the actual API.');
  assert.equal(remote.headers.get('access-control-allow-origin'), parsedURL.origin, 'The remote API must allow exactly the frontend origin.');
}

// Deliberately invented, unissued credentials: never print their values or log
// output. These unauthenticated requests create no accounts, invites, or data.
const inviteProbe = randomUUID().replaceAll('-', '');
const ticketProbe = randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
const logSince = new Date(Date.now() - 1000).toISOString();
const inviteResponse = await fetch(`${parsedURL.origin}/api/v1/invites/${inviteProbe}/join`, {
  method: 'POST', headers: { Origin: parsedURL.origin }, signal: AbortSignal.timeout(5000),
});
assert.equal(inviteResponse.status, 401, 'An unauthenticated synthetic invite must be rejected.');
const ticketResponse = await fetch(`${parsedURL.origin}/api/v1/events?ticket=${ticketProbe}`, {
  headers: { Origin: parsedURL.origin }, signal: AbortSignal.timeout(5000),
});
assert.ok([400, 401, 403, 426].includes(ticketResponse.status), 'A non-WebSocket request with an invented ticket must be rejected.');
await delay(250);
const privateWebLogs = captureDocker(['logs', '--no-color', '--since', logSince, 'web']);
assert.ok(privateWebLogs.includes('/api/v1/invites/[redacted]'), 'The real Nginx access log must record a redacted invite route.');
assert.ok(privateWebLogs.includes('/api/v1/events'), 'The real Nginx access log must record the ticket endpoint without its query.');
assert.ok(!privateWebLogs.includes(inviteProbe), 'Nginx logs exposed the synthetic invite credential.');
assert.ok(!privateWebLogs.includes(ticketProbe), 'Nginx logs exposed the synthetic WebSocket credential.');
console.log('PASS Nginx invite/ticket credential redaction in actual container logs.');

// Reuse the same wire-contract acceptance as native verification, including a
// real Compose service restart. No mock API or host Rust binary is involved.
await import('./verify-instance.mjs');
assert.ok(!process.exitCode, 'Real Compose API/restart acceptance failed.');

// The acceptance deliberately exhausts the auth limiter. Restart the isolated
// services so the following independent browser suite begins with a fresh
// in-memory request budget while retaining all database state.
docker(['restart', 'server', 'web']);
let ready = false;
for (let attempt = 0; attempt < 120; attempt++) {
  try {
    ready = (await fetch(`${parsedURL.origin}/health/ready`, { signal: AbortSignal.timeout(1000) })).status === 200;
    if (ready) break;
  } catch { /* The Compose services are still restarting. */ }
  await delay(250);
}
assert.ok(ready, 'The isolated deployment did not become ready after its final restart.');

const tables = ['_sqlx_migrations', 'users', 'sessions', 'communities', 'community_members', 'channels', 'invites', 'messages'];
const query = tables.map((table) => `SELECT '${table}', count(*)::text, coalesce(md5(string_agg(md5(row_to_json(snapshot_row)::text), '' ORDER BY md5(row_to_json(snapshot_row)::text))), md5('')) FROM public.${table} snapshot_row`).join(' UNION ALL ');
const database = captureDocker(['exec', '-T', 'database', 'printenv', 'NUVEX_DATABASE_NAME']);
assert.ok(/^[a-z][a-z0-9_]{0,62}$/.test(database), 'Invalid development database name.');
const applicationPrivileges = captureDocker(['exec', '-T', 'database', 'psql', '--username=postgres', '--dbname=postgres', '--no-psqlrc', '--tuples-only', '--no-align', '--field-separator=|', '--set=ON_ERROR_STOP=1', '--command', "SELECT rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname='nuvex'"]);
assert.equal(applicationPrivileges, 'f|f|f', 'The API database role must not have cluster administration privileges.');
function fingerprints(name) {
  return captureDocker(['exec', '-T', 'database', 'psql', '--username=postgres', `--dbname=${name}`, '--no-psqlrc', '--tuples-only', '--no-align', '--field-separator=|', '--set=ON_ERROR_STOP=1', '--command', query]).split('\n').filter(Boolean).sort();
}
const before = fingerprints(database);
const output = resolve(repositoryRoot, '.cache/compose-verification');
await mkdir(output, { recursive: true, mode: 0o700 });
const archive = resolve(output, `${randomUUID()}.dump`);
const restored = `nuvex_ci_restore_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
nodeScript('infra/backup-db.mjs', [archive]);
nodeScript('infra/restore-db.mjs', [archive, restored]);
assert.deepEqual(fingerprints(database), before, 'The source changed during the isolated restore drill.');
assert.deepEqual(fingerprints(restored), before, 'Restored data does not match the source.');
const rowCounts = Object.fromEntries(before.map((line) => {
  const [table, count] = line.split('|');
  return [table, Number(count)];
}));
await writeFile(resolve(output, 'summary.json'), JSON.stringify({
  ok: true, project, origin: parsedURL.origin, strictWebCsp: true,
  explicitRemoteConnectionPolicy: Boolean(remoteURL), nginxCredentialRedaction: true,
  applicationRoleRestricted: true,
  sourceUnchanged: true, restoredDatabase: restored, tableFingerprintsMatch: true, rowCounts,
}, null, 2), { mode: 0o600 });
console.log(`PASS container backup/restore: ${tables.length} table fingerprints match; source unchanged.`);
console.log('PASS Compose deployment API, persistence, restart, and isolated restore acceptance.');
