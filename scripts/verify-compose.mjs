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
  applicationRoleRestricted: true,
  sourceUnchanged: true, restoredDatabase: restored, tableFingerprintsMatch: true, rowCounts,
}, null, 2), { mode: 0o600 });
console.log(`PASS container backup/restore: ${tables.length} table fingerprints match; source unchanged.`);
console.log('PASS Compose deployment API, persistence, restart, and isolated restore acceptance.');
