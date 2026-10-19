import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import test from 'node:test';
import { classifyModule, createInventory, inventoryPath, loadPolicy, repository, verifyBuild, verifyNoticeCopies } from './check-frontend-notices.mjs';
import { frontendNotices } from './frontend-notices.mjs';

const policy = loadPolicy();
const chunk = (modules, code = 'console.log("synthetic bundle");') => ({ type: 'chunk', fileName: '_app/immutable/test.js', modules, code });
const modules = { [resolve(repository, 'node_modules/svelte/src/internal/client/index.js')]: { renderedLength: 10 } };
function fixture(action) {
  const parent = resolve(repository, '.cache'); mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(resolve(parent, 'frontend-notices-test-'));
  const put = (file, content) => { const output = resolve(directory, file); mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, content); };
  try {
    const assets = { js: chunk(modules), css: { type: 'asset', fileName: '_app/immutable/test.css', source: 'body{color:green}' } };
    const inventory = createInventory(assets);
    for (const item of policy.packages) for (const file of item.files) {
      const relative = `licenses/${item.directory}/${file.name}`; put(relative, readFileSync(resolve(repository, 'apps/web/static', relative)));
    }
    for (const item of policy.materials) put(item.file, readFileSync(resolve(repository, 'apps/web/static', item.file)));
    put('licenses/frontend-packages.json', readFileSync(resolve(repository, 'apps/web/static/licenses/frontend-packages.json')));
    put('_app/immutable/test.js', assets.js.code); put('_app/immutable/test.css', assets.css.source);
    put(inventoryPath, JSON.stringify(inventory));
    action({ directory, put, inventory });
  } finally {
    assert.ok(directory.startsWith(parent + sep) && directory.slice(parent.length + 1).startsWith('frontend-notices-test-'));
    rmSync(directory, { recursive: true });
  }
}

test('inventory is deterministic, attributes injected Vite code, and publishes no application source paths', () => {
  const local = resolve(repository, 'apps/web/src/routes/private.svelte');
  const first = { a: chunk({ ...modules, [local]: { renderedLength: 40 }, '\0vite/preload-helper.js': { renderedLength: 80 } }), b: { type: 'asset', fileName: '_app/immutable/test.css', source: '.test{}' } };
  const second = { b: first.b, a: first.a };
  const inventory = createInventory(first);
  assert.deepEqual(inventory, createInventory(second));
  assert.deepEqual(inventory.packages.map((item) => item.name), ['svelte', 'vite']);
  assert.ok(!JSON.stringify(inventory).includes(repository));
  assert.ok(!JSON.stringify(inventory).includes('private.svelte'));
  assert.equal(classifyModule('D:\\repo\\node_modules\\svelte\\src\\internal.js', 'D:\\repo', policy), 'svelte');
});

test('new rendered dependencies and virtual helpers fail closed; elided JS is distinguished from extracted CSS', () => {
  const unknown = resolve(repository, 'node_modules/unreviewed-package/index.js');
  assert.throws(() => createInventory({ x: chunk({ ...modules, [unknown]: { renderedLength: 1 } }) }), /Unreviewed bundled/);
  assert.throws(() => createInventory({ x: chunk({ ...modules, '\0unknown-helper': { renderedLength: 1 } }) }), /Unreviewed virtual/);
  assert.throws(() => createInventory({ x: chunk({ ...modules, [unknown.replace('index.js', 'style.css')]: { renderedLength: 0 } }) }), /Unreviewed bundled/);
  assert.equal(createInventory({ x: chunk({ ...modules, [unknown]: { renderedLength: 0 } }) }).packages.length, 1);
  assert.throws(() => classifyModule(resolve(repository, 'node_modules/svelte/node_modules/devalue/index.js'), repository, policy), /nested frontend dependency/);
});

test('SSR hook emits nothing, while client hook emits a bounded public inventory', () => {
  const plugin = frontendNotices(); const emitted = [];
  const context = { emitFile: (asset) => emitted.push(asset) };
  plugin.configResolved({ build: { ssr: true } });
  plugin.generateBundle.handler.call(context, {}, { secret: { type: 'chunk', fileName: '/private/server.js', modules: { '/private/secret.js': { renderedLength: 100 } }, code: 'private' } });
  assert.equal(emitted.length, 0);
  plugin.configResolved({ build: { ssr: false } });
  plugin.generateBundle.handler.call(context, {}, { client: chunk(modules) });
  assert.equal(emitted.length, 1); assert.equal(emitted[0].fileName, inventoryPath);
  assert.ok(!emitted[0].source.includes('/private/'));
});

test('installed package version and license-byte changes require a reviewed update', () => {
  const version = structuredClone(policy); version.packages[0].version = '0.0.0';
  assert.throws(() => verifyNoticeCopies(repository, resolve(repository, 'apps/web/static'), version), /metadata changed/);
  const digest = structuredClone(policy); digest.packages[0].files[0].sha256 = '0'.repeat(64);
  assert.throws(() => verifyNoticeCopies(repository, resolve(repository, 'apps/web/static'), digest), /reviewed hash changed/);
  fixture(({ directory, put }) => {
    put('licenses/svelte/LICENSE.md', 'wrong synthetic license');
    assert.throws(() => verifyBuild(repository, directory), /License copy/);
  });
});

test('built file set and final digest changes are detected after static adaptation', () => {
  fixture(({ directory, put }) => {
    assert.equal(verifyBuild(repository, directory).outputs.length, 2);
    put('_app/immutable/test.js', 'tampered');
    assert.throws(() => verifyBuild(repository, directory), /asset changed/);
  });
  fixture(({ directory, put }) => {
    put('_app/immutable/extra.js', 'unlisted');
    assert.throws(() => verifyBuild(repository, directory), /file set differs/);
  });
});

test('public inventory rejects private extra fields and traversal before reading an output', () => {
  fixture(({ directory, put, inventory }) => {
    inventory.privateServerPaths = ['/private/synthetic']; put(inventoryPath, JSON.stringify(inventory));
    assert.throws(() => verifyBuild(repository, directory), /Unexpected frontend inventory fields/);
  });
  fixture(({ directory, put, inventory }) => {
    inventory.outputs[0].file = '../private.js'; put(inventoryPath, JSON.stringify(inventory));
    assert.throws(() => verifyBuild(repository, directory), /Invalid public frontend output path/);
  });
});
