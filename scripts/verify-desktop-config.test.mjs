import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const harness = fileURLToPath(new URL('./verify-desktop.mjs', import.meta.url));
const password = 'synthetic-config-password-do-not-print';
const primary = `postgres://test:${password}@127.0.0.1:55433/primary`;

for (const [name, first, second, message] of [
  ['malformed URL', `postgres://test:${password}@[`, primary, 'database URL is invalid'],
  ['identical databases', primary, primary, 'requires distinct databases'],
]) {
  test(`native acceptance rejects ${name} without logging credentials`, () => {
    const result = spawnSync(process.execPath, [harness], {
      env: { ...process.env, NUVEX_DESKTOP_DATABASE_URL: first, NUVEX_DESKTOP_SECOND_DATABASE_URL: second },
      encoding: 'utf8', timeout: 10_000, windowsHide: true, shell: false,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 1, 'Invalid configuration must stop before starting any binaries.');
    const diagnostic = result.stdout + result.stderr;
    assert.ok(diagnostic.includes(message), 'The failure must identify the configuration problem.');
    assert.ok(!diagnostic.includes(password), 'Configuration failure leaked a credential.');
    assert.ok(!diagnostic.includes(first), 'Configuration failure leaked a database URL.');
    assert.ok(!diagnostic.includes(second), 'Configuration failure leaked a database URL.');
  });
}
