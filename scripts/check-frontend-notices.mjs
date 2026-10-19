import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const inventoryPath = 'licenses/frontend-inventory.json';
const policyPath = 'apps/web/static/licenses/frontend-packages.json';
const materialSources = { 'licenses/nuvex/LICENSE': 'LICENSE', 'licenses/nuvex/NOTICE': 'NOTICE', 'fonts/LICENSE.txt': 'apps/web/static/fonts/LICENSE.txt' };
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const normalized = (value) => value.replaceAll('\\', '/').replace(/\/$/, '');
function requireValue(condition, message) { if (!condition) throw new Error(message); }
function keys(value, expected) {
  requireValue(value && typeof value === 'object' && !Array.isArray(value) && JSON.stringify(Object.keys(value).sort(compare)) === JSON.stringify(expected.sort(compare)), 'Unexpected frontend inventory fields.');
}
function readBounded(file, max = 1024 * 1024) {
  const info = lstatSync(file);
  requireValue(info.isFile() && info.size <= max, 'A frontend notice input exceeds its file bound.');
  return readFileSync(file);
}
export function loadPolicy(root = repository) {
  const policy = JSON.parse(readBounded(resolve(root, policyPath)));
  keys(policy, ['version', 'packages', 'materials']);
  requireValue(policy.version === 1 && Array.isArray(policy.packages) && policy.packages.length <= 16, 'Invalid frontend notices policy.');
  const names = new Set();
  for (const item of policy.packages) {
    keys(item, ['name', 'version', 'license', 'directory', 'upstream', 'files']);
    requireValue(typeof item.name === 'string' && /^(?:@[a-z0-9-]+\/)?[a-z0-9-]+$/.test(item.name) && !names.has(item.name), 'Invalid or duplicate reviewed package.');
    names.add(item.name);
    requireValue(/^[a-z0-9-]+$/.test(item.directory) && /^\d+\.\d+\.\d+(?:[-.a-z0-9]+)?$/.test(item.version), 'Invalid reviewed package location/version.');
    requireValue(typeof item.license === 'string' && item.license.length <= 80 && /^https:\/\//.test(item.upstream), 'Invalid reviewed package provenance.');
    requireValue(Array.isArray(item.files) && item.files.length >= 1 && item.files.length <= 8, 'Invalid notice file list.');
    for (const file of item.files) {
      keys(file, ['name', 'sha256']);
      requireValue(/^(?:LICENSE|LICENCE|COPYING|NOTICE)(?:[-.][a-z0-9_.-]+)?$/i.test(file.name) && /^[a-f0-9]{64}$/.test(file.sha256), 'Invalid reviewed notice filename/hash.');
    }
  }
  requireValue(Array.isArray(policy.materials) && policy.materials.length === Object.keys(materialSources).length, 'Missing distributed project/font notices.');
  const materials = new Set();
  for (const file of policy.materials) {
    keys(file, ['file', 'sha256']);
    requireValue(Object.hasOwn(materialSources, file.file) && !materials.has(file.file) && /^[a-f0-9]{64}$/.test(file.sha256), 'Unreviewed distributed notice material.');
    materials.add(file.file);
  }
  return policy;
}
export function verifyNoticeCopies(root = repository, publicRoot = resolve(root, 'apps/web/static'), policy = loadPolicy(root)) {
  requireValue(readBounded(resolve(root, policyPath)).equals(readBounded(resolve(publicRoot, 'licenses/frontend-packages.json'))), 'Distributed review policy differs from the source policy.');
  for (const item of policy.packages) {
    const installed = resolve(root, 'node_modules', item.name);
    const metadata = JSON.parse(readBounded(resolve(installed, 'package.json')));
    requireValue(metadata.name === item.name && metadata.version === item.version && metadata.license === item.license, `Reviewed package metadata changed: ${item.name}.`);
    for (const file of item.files) {
      const original = readBounded(resolve(installed, file.name));
      const copy = readBounded(resolve(publicRoot, 'licenses', item.directory, file.name));
      requireValue(sha256(original) === file.sha256 && original.equals(copy), `License copy or reviewed hash changed: ${item.name}/${file.name}.`);
    }
  }
  for (const file of policy.materials) {
    const original = readBounded(resolve(root, materialSources[file.file]));
    requireValue(sha256(original) === file.sha256 && original.equals(readBounded(resolve(publicRoot, file.file))), 'Distributed project/font notice copy changed.');
  }
}
// This is deliberately a closed classifier. New rendered packages or virtual
// helpers require review instead of reading arbitrary module/package metadata.
export function classifyModule(id, root, policy) {
  const source = normalized(id.split('?')[0]);
  const prefix = normalized(root) + '/';
  const helpers = new Set(['\0vite/preload-helper.js', '\0vite/modulepreload-polyfill.js']);
  if (helpers.has(source)) {
    requireValue(policy.packages.some((item) => item.name === 'vite'), 'Injected Vite code requires its reviewed license.');
    return 'vite';
  }
  if (source.startsWith('\0')) throw new Error('Unreviewed virtual frontend module.');
  requireValue(source.startsWith(prefix), 'A rendered frontend module is outside the reviewed repository.');
  const relative = source.slice(prefix.length);
  if (relative.startsWith('node_modules/')) {
    const match = relative.match(/^node_modules\/((?:@[^/]+\/)?[^/]+)\/(.+)$/);
    requireValue(match && !/(?:^|\/)node_modules\//.test(match[2]), 'A nested frontend dependency requires its own provenance review.');
    requireValue(policy.packages.some((item) => item.name === match[1]), `Unreviewed bundled frontend package: ${match[1]}.`);
    return match[1];
  }
  requireValue(/^(?:apps\/web\/|packages\/(?:core|tokens)\/)/.test(relative), 'Unreviewed first-party frontend module location.');
  return null;
}
function publicOutputName(name) {
  requireValue(typeof name === 'string' && name.length <= 256 && /^_app\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+\.(?:js|css)$/.test(name), 'Invalid public frontend output path.');
  return name;
}
export function createInventory(bundle, root = repository, policy = loadPolicy(root)) {
  verifyNoticeCopies(root, resolve(root, 'apps/web/static'), policy);
  const modules = new Map();
  const outputs = [];
  requireValue(Object.keys(bundle).length <= 256, 'Frontend bundle exceeds its inventory bound.');
  for (const item of Object.values(bundle)) {
    if (item.type === 'chunk') {
      for (const [id, module] of Object.entries(item.modules)) {
        // Extracted CSS can have an empty JS body while still contributing CSS.
        if (module.renderedLength <= 0 && !/\.css(?:$|\?)/.test(id)) continue;
        const name = classifyModule(id, root, policy);
        if (name) { if (!modules.has(name)) modules.set(name, new Set()); modules.get(name).add(id); }
      }
      outputs.push({ file: publicOutputName(item.fileName), bytes: Buffer.byteLength(item.code), sha256: sha256(item.code) });
    } else if (item.fileName.endsWith('.css')) {
      const source = Buffer.from(item.source);
      outputs.push({ file: publicOutputName(item.fileName), bytes: source.length, sha256: sha256(source) });
    }
  }
  requireValue(outputs.length > 0 && modules.size > 0, 'A client bundle inventory cannot be empty.');
  const packages = [...modules].sort(([a], [b]) => compare(a, b)).map(([name, entries]) => {
    const known = policy.packages.find((item) => item.name === name);
    return { name, version: known.version, license: known.license, upstream: known.upstream, renderedModuleCount: entries.size, notices: known.files.map((file) => ({ file: `licenses/${known.directory}/${file.name}`, sha256: file.sha256 })) };
  });
  return { version: 1, scope: 'rendered-client-javascript-and-css', method: 'rollup-output-chunk-modules-and-final-assets', packages, materials: policy.materials, outputs: outputs.sort((a, b) => compare(a.file, b.file)) };
}
export function verifyBuild(root = repository, buildRoot = resolve(root, 'apps/web/build')) {
  const policy = loadPolicy(root);
  verifyNoticeCopies(root, buildRoot, policy);
  const inventory = JSON.parse(readBounded(resolve(buildRoot, inventoryPath)));
  keys(inventory, ['version', 'scope', 'method', 'packages', 'materials', 'outputs']);
  requireValue(inventory.version === 1 && inventory.scope === 'rendered-client-javascript-and-css' && inventory.method === 'rollup-output-chunk-modules-and-final-assets' && Array.isArray(inventory.outputs) && inventory.outputs.length <= 128, 'Invalid public client inventory.');
  requireValue(JSON.stringify(inventory.materials) === JSON.stringify(policy.materials), 'Distributed material inventory changed.');
  requireValue(Array.isArray(inventory.packages) && inventory.packages.length > 0 && inventory.packages.length <= policy.packages.length, 'Invalid bundled package inventory.');
  const names = new Set();
  for (const item of inventory.packages) {
    keys(item, ['name', 'version', 'license', 'upstream', 'renderedModuleCount', 'notices']);
    const known = policy.packages.find((entry) => entry.name === item.name);
    requireValue(known && !names.has(item.name) && item.version === known.version && item.license === known.license && item.upstream === known.upstream && Number.isSafeInteger(item.renderedModuleCount) && item.renderedModuleCount > 0 && item.renderedModuleCount <= 5000, 'Bundled package inventory no longer matches reviewed provenance.');
    names.add(item.name);
    requireValue(JSON.stringify(item.notices) === JSON.stringify(known.files.map((file) => ({ file: `licenses/${known.directory}/${file.name}`, sha256: file.sha256 }))), 'Bundled notice inventory changed.');
  }
  const files = [];
  let entries = 0;
  function walk(directory, relative = '_app', depth = 0) {
    requireValue(depth <= 8, 'Frontend output directory exceeds its depth bound.');
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      requireValue(++entries <= 512, 'Frontend output directory exceeds its entry bound.');
      requireValue(!entry.isSymbolicLink(), 'Built frontend files must not be symbolic links.');
      const file = `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(resolve(directory, entry.name), file, depth + 1);
      else if (/\.(?:js|css)$/.test(entry.name)) files.push(publicOutputName(file));
      requireValue(files.length <= 128, 'Built frontend files exceed their inventory bound.');
    }
  }
  walk(resolve(buildRoot, '_app'));
  requireValue(JSON.stringify(files.sort(compare)) === JSON.stringify(inventory.outputs.map((item) => publicOutputName(item.file)).sort(compare)), 'The distributed JS/CSS file set differs from its Rollup inventory.');
  for (const item of inventory.outputs) {
    keys(item, ['file', 'bytes', 'sha256']);
    requireValue(Number.isSafeInteger(item.bytes) && item.bytes >= 0 && item.bytes <= 8 * 1024 * 1024 && /^[a-f0-9]{64}$/.test(item.sha256), 'Invalid frontend asset digest.');
    const content = readBounded(resolve(buildRoot, publicOutputName(item.file)), 8 * 1024 * 1024);
    requireValue(content.length === item.bytes && sha256(content) === item.sha256, 'A distributed frontend asset changed after inventory generation.');
  }
  return inventory;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const inventory = verifyBuild();
  console.log(`Verified ${inventory.packages.length} bundled frontend packages, ${inventory.outputs.length} JS/CSS assets, and exact distributed license copies.`);
}
