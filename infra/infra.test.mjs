import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { archiveFormat, readAndVerifyArchive, repositoryRoot, validateRestoreDatabase } from './db-tools.mjs';
import { connectOrigins } from './connect-origins.mjs';

test('restore refuses active/system names and SQL/shell metacharacters', () => {
  for (const value of ['nuvex', 'postgres', 'template0', 'template1', '../nuvex', 'name;DROP DATABASE nuvex', '-option', 'a'.repeat(64), 'UPPER', 'name with space']) {
    assert.throws(() => validateRestoreDatabase(value, 'nuvex'));
  }
  assert.equal(validateRestoreDatabase('restore_drill_20261019', 'nuvex'), 'restore_drill_20261019');
});

test('restore verifies metadata and binary archive integrity before contacting Docker', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'nuvex-backup-test-'));
  const archive = join(directory, 'test.dump');
  const bytes = Buffer.from([0, 255, 10, 13, 128, 1]);
  writeFileSync(archive, bytes);
  const metadata = { format: archiveFormat, database: 'nuvex', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  writeFileSync(`${archive}.json`, JSON.stringify(metadata));
  assert.equal((await readAndVerifyArchive(archive)).database, 'nuvex');
  writeFileSync(archive, Buffer.from([0, 254, 10, 13, 128, 1]));
  await assert.rejects(readAndVerifyArchive(archive), /SHA-256/);
  writeFileSync(`${archive}.json`, JSON.stringify({ ...metadata, size: 1 }));
  await assert.rejects(readAndVerifyArchive(archive), /size/);
  writeFileSync(`${archive}.json`, JSON.stringify({ ...metadata, format: 'unrecognized' }));
  await assert.rejects(readAndVerifyArchive(archive), /format/);
});

test('web CSP hashes the exact inline bootstrap and never enables inline scripts', () => {
  const directory = mkdtempSync(join(tmpdir(), 'nuvex-csp-test-'));
  const input = join(directory, 'index.html');
  const output = join(directory, 'csp.conf');
  const bootstrap = '\nwindow.start();\n';
  writeFileSync(input, `<script>${bootstrap}</script><script src="/app.js"></script>`);
  const result = spawnSync(process.execPath, ['infra/write-csp.mjs', input, output], { cwd: repositoryRoot, encoding: 'utf8', env: { ...process.env, NUVEX_CONNECT_ORIGINS: '' } });
  assert.equal(result.status, 0, result.stderr);
  const policy = readFileSync(output, 'utf8');
  assert.ok(policy.includes(`'sha256-${createHash('sha256').update(bootstrap).digest('base64')}'`));
  assert.match(policy, /script-src 'self' 'sha256-[^']+';/);
  assert.ok(!policy.includes("script-src 'self' 'unsafe-inline'"));
  assert.ok(policy.includes("connect-src 'self'"));
  // Running twice must not overwrite an existing configuration.
  assert.notEqual(spawnSync(process.execPath, ['infra/write-csp.mjs', input, output], { cwd: repositoryRoot }).status, 0);
});

function generatedPolicy(value) {
  const directory = mkdtempSync(join(tmpdir(), 'nuvex-origin-test-'));
  const input = join(directory, 'index.html');
  const output = join(directory, 'csp.conf');
  writeFileSync(input, '<script>window.start();</script><script src="/app.js"></script>');
  const result = spawnSync(process.execPath, ['infra/write-csp.mjs', input, output], {
    cwd: repositoryRoot, encoding: 'utf8', env: { ...process.env, NUVEX_CONNECT_ORIGINS: value },
  });
  return { ...result, output, policy: existsSync(output) ? readFileSync(output, 'utf8') : '' };
}

test('actual CSP generator normalizes explicit API origins and pairs WebSocket schemes', () => {
  const result = generatedPolicy('HTTPS://API.Example.org:443, https://api.example.org, https://chat.example.org:8443, http://localhost:5173, http://127.0.0.1:3001, http://[::1]:3002');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.policy, /connect-src 'self' https:\/\/api\.example\.org wss:\/\/api\.example\.org https:\/\/chat\.example\.org:8443 wss:\/\/chat\.example\.org:8443 http:\/\/localhost:5173 ws:\/\/localhost:5173 http:\/\/127\.0\.0\.1:3001 ws:\/\/127\.0\.0\.1:3001 http:\/\/\[::1\]:3002 ws:\/\/\[::1\]:3002;/);
  assert.match(result.policy, /script-src 'self' 'sha256-[^']+';/);
  assert.ok(!result.policy.includes('script-src https:'));
  const sixteen = generatedPolicy(Array.from({ length: 16 }, (_, i) => `https://api${i}.example.org`).join(','));
  assert.equal(sixteen.status, 0, sixteen.stderr);
  assert.ok(sixteen.policy.includes('wss://api15.example.org'));
  const atByteLimit = Array.from({ length: 16 }, (_, i) => `https://${'a'.repeat(i === 0 ? 60 : 59)}.${'b'.repeat(59)}`).join(',');
  assert.equal(Buffer.byteLength(atByteLimit), 2048);
  const boundary = generatedPolicy(atByteLimit);
  assert.equal(boundary.status, 0, boundary.stderr);
});

test('actual CSP generator fails closed on ambiguous, unbounded, or injectable origin lists', () => {
  const invalid = [
    ' ', 'https://api.example.org,', ',https://api.example.org',
    'https://user:password@api.example.org', 'https://@api.example.org',
    'https://api.example.org/', 'https://api.example.org/path', 'https://api.example.org/..',
    'https://api.example.org?', 'https://api.example.org?key=value',
    'https://api.example.org#', 'https://api.example.org#fragment',
    'https://*.example.org', '*', 'https:', 'wss://api.example.org',
    'http://public.example.org', 'http://localhost.example.org', 'http://192.168.1.1',
    'https://api.example.org\\path', 'https://api.example.org:65536', 'https://api.example.org:',
    'https://api.example.org;script-src *', 'https://api.example.org"; script-src *',
    'https://api.example.org\n', 'https://api.example.org\t',
    'https://.', 'https://-invalid.example.org',
    Array.from({ length: 17 }, (_, i) => `https://api${i}.example.org`).join(','),
    'https://' + 'a'.repeat(2041),
  ];
  for (const value of invalid) {
    const result = generatedPolicy(value);
    assert.notEqual(result.status, 0, `Accepted ${JSON.stringify(value)}`);
    assert.equal(existsSync(result.output), false, 'Invalid input must not write a partial configuration');
  }
});

test('origin validator rejects embedded NUL before policy generation', () => {
  // Operating systems cannot pass NUL in environment variables; exercise the
  // real exported validator directly for this additional input boundary.
  assert.throws(() => connectOrigins('https://api.example.org\u0000'), /control characters/);
});


test('CI preparation creates independent secrets and an isolated remote-CSP override', () => {
  const directory = mkdtempSync(join(tmpdir(), 'nuvex-compose-test-'));
  const environmentFile = join(directory, 'instance.env');
  const runnerFile = join(directory, 'github.env');
  const result = spawnSync(process.execPath, ['scripts/prepare-compose-env.mjs', environmentFile], {
    cwd: repositoryRoot, encoding: 'utf8',
    env: { ...process.env, GITHUB_ENV: runnerFile, GITHUB_ACTIONS: 'false' },
  });
  assert.equal(result.status, 0, result.stderr);
  const secrets = readFileSync(environmentFile, 'utf8');
  const administrator = secrets.match(/^POSTGRES_PASSWORD=([a-f0-9]{64})$/m)?.[1];
  const application = secrets.match(/^NUVEX_DATABASE_PASSWORD=([a-f0-9]{64})$/m)?.[1];
  assert.ok(administrator && application && administrator !== application, 'Independent random database secrets are required.');
  assert.ok(!result.stdout.includes(administrator) && !result.stdout.includes(application), 'Secrets must not be printed.');
  const settings = Object.fromEntries(readFileSync(runnerFile, 'utf8').trim().split('\n').map((line) => {
    const separator = line.indexOf('=');
    return [line.slice(0, separator), line.slice(separator + 1)];
  }));
  assert.equal(settings.COMPOSE_ENV_FILES, environmentFile);
  assert.ok(/^nuvex-ci-[a-f0-9-]{36}$/.test(settings.COMPOSE_PROJECT_NAME));
  assert.equal(settings.NUVEX_E2E_REMOTE_URL, 'http://127.0.0.1:8081');
  const [base, override] = settings.COMPOSE_FILE.split(delimiter);
  assert.equal(base, join(repositoryRoot, 'compose.yaml'));
  assert.ok(override.startsWith(directory));
  const overrideYaml = readFileSync(override, 'utf8');
  assert.ok(overrideYaml.includes('NUVEX_CONNECT_ORIGINS: http://127.0.0.1:8081'));
  assert.ok(overrideYaml.includes('"127.0.0.1:8081:8080"'));
  assert.ok(!overrideYaml.includes(administrator) && !overrideYaml.includes(application));
});
