import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { archiveFormat, readAndVerifyArchive, repositoryRoot, validateRestoreDatabase } from './db-tools.mjs';

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
  const result = spawnSync(process.execPath, ['infra/write-csp.mjs', input, output], { cwd: repositoryRoot, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const policy = readFileSync(output, 'utf8');
  assert.ok(policy.includes(`'sha256-${createHash('sha256').update(bootstrap).digest('base64')}'`));
  assert.match(policy, /script-src 'self' 'sha256-[^']+';/);
  assert.ok(!policy.includes("script-src 'self' 'unsafe-inline'"));
  assert.ok(policy.includes("connect-src 'self'"));
  // Running twice must not overwrite an existing configuration.
  assert.notEqual(spawnSync(process.execPath, ['infra/write-csp.mjs', input, output], { cwd: repositoryRoot }).status, 0);
});
