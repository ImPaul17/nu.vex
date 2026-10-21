import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { collectCrate, collectNativeNotices, crateMembers, parseLockedPackages, verifyNativeNotices } from './native-notices.mjs';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'nuvex-notices-'));
  t.after(async () => {
    const checked = resolve(root);
    assert.ok(checked.startsWith(`${resolve(tmpdir())}${sep}nuvex-notices-`));
    await rm(checked, { recursive: true, force: true });
  });
  return root;
}
async function put(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}
function archive(entries) {
  const parts = [];
  for (const item of entries) {
    const bytes = Buffer.from(item.bytes);
    const header = Buffer.alloc(512);
    header.write(item.path);
    header.write('0000644\0', 100);
    header.write('0000000\0', 108);
    header.write('0000000\0', 116);
    header.write(`${bytes.length.toString(8).padStart(11, '0')}\0`, 124);
    header.write('00000000000\0', 136);
    header.fill(32, 148, 156);
    header[156] = (item.type ?? '0').charCodeAt(0);
    header.write('ustar\0', 257);
    header.write(`${header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0')}\0 `, 148);
    parts.push(header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...parts, Buffer.alloc(1024)]));
}
async function cachedCrate(root, { name = 'example', version = '1.0.0', license = 'MIT AND Unicode-3.0', notices = { LICENSE: 'Complete fixture license\n', 'LICENSES/Unicode-3.0.txt': 'Full fixture Unicode notice\n' } } = {}) {
  const files = { 'Cargo.toml': `[package]\nname = "${name}"\nversion = "${version}"\nlicense = "${license}"\n`, ...notices };
  const prefix = `${name}-${version}`;
  const compressed = archive(Object.entries(files).map(([path, bytes]) => ({ path: `${prefix}/${path}`, bytes })));
  const checksum = digest(compressed);
  const source = join(root, 'registry/src/index.crates.io-fixture', prefix);
  await put(join(root, 'registry/cache/index.crates.io-fixture', `${prefix}.crate`), compressed);
  for (const [path, bytes] of Object.entries(files)) await put(join(source, path), bytes);
  await put(join(source, '.cargo-checksum.json'), JSON.stringify({ package: checksum, files: Object.fromEntries(Object.entries(files).map(([path, bytes]) => [path, digest(bytes)])) }));
  return { entry: { name, version, checksum, source: 'registry+https://github.com/rust-lang/crates.io-index' }, source, compressed };
}

test('lock union retains all registry identities and rejects unreviewed sources', () => {
  const lock = `version = 4\n[[package]]\nname = "nuvex-desktop"\nversion = "0.2.0"\n[[package]]\nname = "example"\nversion = "1.0.0"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\nchecksum = "${'a'.repeat(64)}"\n`;
  assert.equal(parseLockedPackages(lock).length, 1);
  assert.throws(() => parseLockedPackages(lock.replace('registry+https://github.com/rust-lang/crates.io-index', 'git+https://example.test/source')), /unsupported source/);
  assert.throws(() => parseLockedPackages(lock.replace('name = "nuvex-desktop"', 'name = "unknown-local"')), /unreviewed local/);
});

test('authenticated archive and Cargo source bytes bind nested ring and license-directory notices', async (t) => {
  const root = await fixture(t);
  const paths = ['LICENSE', 'LICENSE-BoringSSL', 'LICENSE-other-bits', 'src/polyfill/once_cell/LICENSE-APACHE', 'src/polyfill/once_cell/LICENSE-MIT', 'LICENSES/Unicode-3.0.txt'];
  const cached = await cachedCrate(root, { name: 'ring', notices: Object.fromEntries(paths.map((path) => [path, `Complete ${path} fixture\n`])) });
  const collected = await collectCrate(cached.entry, root);
  assert.equal(collected.notices.length, 6);
  assert.equal(collected.declaredLicense, 'MIT AND Unicode-3.0');
  await writeFile(join(cached.source, 'LICENSE-BoringSSL'), 'tampered');
  await assert.rejects(collectCrate(cached.entry, root), /differs from locked archive/);
});

test('altered crate bytes and absent required nested notices fail closed', async (t) => {
  const root = await fixture(t);
  const cached = await cachedCrate(root, { name: 'ring' });
  await assert.rejects(collectCrate(cached.entry, root), /referenced notice missing/);
  await assert.rejects(collectCrate({ ...cached.entry, checksum: '0'.repeat(64) }, root), /archive digest mismatch/);
});

test('tar paths and special member types cannot redirect notice reads', () => {
  assert.throws(() => crateMembers(archive([{ path: 'example-1.0.0/../LICENSE', bytes: 'x' }]), 'example-1.0.0'), /unsafe/);
  assert.throws(() => crateMembers(archive([{ path: 'example-1.0.0/LICENSE', bytes: 'x', type: '2' }]), 'example-1.0.0'), /member type/);
  const compressed = archive([{ path: 'other-1.0.0/LICENSE', bytes: 'x' }]);
  assert.throws(() => crateMembers(compressed, 'example-1.0.0'), /prefix mismatch/);
  const longPath = `${'nested/'.repeat(20)}LICENSE`;
  const longArchive = archive([
    { path: 'example-1.0.0/Cargo.toml', bytes: '[package]\n' },
    { path: '././@LongLink', type: 'L', bytes: `example-1.0.0/${longPath}\0` },
    { path: 'example-1.0.0/truncated-name', bytes: 'Complete long-path license\n' },
  ]);
  assert.equal(crateMembers(longArchive, 'example-1.0.0').get(longPath).toString(), 'Complete long-path license\n');
});

test('missing tarball notices require byte-checked VCS supplements and an actually offered license alternative', async (t) => {
  const root = await fixture(t);
  const commit = 'a'.repeat(40);
  const cached = await cachedCrate(root, { license: 'MIT OR Apache-2.0', notices: { '.cargo_vcs_info.json': JSON.stringify({ git: { sha1: commit }, path_in_vcs: 'crates/example' }) } });
  await rm(join(cached.source, '.cargo-checksum.json'));
  const bytes = Buffer.from('Complete upstream Apache fixture notice\n');
  await put(join(root, 'supplement/LICENSE'), bytes);
  const supplement = { name: 'example', version: '1.0.0', root, crateChecksum: cached.entry.checksum, vcsCommit: commit, pathInVcs: 'crates/example',
    licenseSelection: 'Apache-2.0', files: [{ file: 'supplement/LICENSE', url: `https://example.test/${commit}/LICENSE`, bytes: bytes.length, sha256: digest(bytes) }] };
  const collected = await collectCrate(cached.entry, root, [supplement]);
  assert.equal(collected.noticeLicenseSelection, 'Apache-2.0');
  assert.equal(collected.upstreamSupplements.length, 1);
  await assert.rejects(collectCrate(cached.entry, root, [{ ...supplement, vcsCommit: 'b'.repeat(40) }]), /VCS provenance changed/);
  await assert.rejects(collectCrate(cached.entry, root, [{ ...supplement, licenseSelection: 'BSD-3-Clause' }]), /not an offered alternative/);
  await put(join(root, 'supplement/LICENSE'), 'changed');
  await assert.rejects(collectCrate(cached.entry, root, [supplement]), /supplemental notice digest mismatch/);
});

test('complete fixture collection is deterministic and installed-resource verification rejects drift', async (t) => {
  const root = await fixture(t);
  const cargoHome = join(root, 'cargo');
  const { entry } = await cachedCrate(cargoHome);
  await put(join(root, 'apps/desktop/src-tauri/Cargo.lock'), `version = 4\n[[package]]\nname = "${entry.name}"\nversion = "${entry.version}"\nsource = "${entry.source}"\nchecksum = "${entry.checksum}"\n`);
  for (const name of ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md']) await put(join(root, name), `Project ${name}\n`);
  await put(join(root, 'apps/web/static/licenses/example/LICENSE'), 'Frontend license\n');
  await put(join(root, 'apps/web/static/fonts/LICENSE.txt'), 'Font license\n');
  const sysroot = join(root, 'toolchain');
  for (const name of ['COPYRIGHT.html', 'COPYRIGHT-library.html', 'licenses/MIT.txt']) await put(join(sysroot, 'share/doc/rust', name), `Toolchain ${name}\n`);
  const platform = Buffer.from('Complete versioned platform fixture license\n');
  await put(join(root, 'docs/legal/native-platform/platform.txt'), platform);
  await put(join(root, 'docs/legal/native-platform/sources.json'), JSON.stringify({ schemaVersion: 1, files: [{ file: 'platform.txt', bytes: platform.length, sha256: digest(platform), url: 'https://example.test/versioned/LICENSE' }] }));
  const options = { root, cargoHome, sysroot, target: 'x86_64-pc-windows-msvc', rustcVersion: 'rustc 1.99.1 (fixture)' };
  const output = join(root, 'output');
  const first = await collectNativeNotices({ ...options, output });
  assert.equal(first.completeLinkedPayloadInventory, false);
  assert.equal(first.packages.length, 1);
  assert.equal(first.platform.length, 1);
  assert.equal(first.packages[0].declaredLicense, 'MIT AND Unicode-3.0');
  assert.ok(!JSON.stringify(first).includes(root));
  const second = join(root, 'second');
  await collectNativeNotices({ ...options, output: second });
  assert.deepEqual(await readFile(join(output, 'inventory.json')), await readFile(join(second, 'inventory.json')));
  assert.equal((await verifyNativeNotices(output)).files, first.files.length);
  await assert.rejects(collectNativeNotices({ ...options, output }), /must be empty/);
  await put(join(output, 'unexpected.txt'), 'extra');
  await assert.rejects(verifyNativeNotices(output), /file set differs/);
  await rm(join(output, 'unexpected.txt'));
  await writeFile(join(output, 'frontend/fonts/LICENSE.txt'), 'changed');
  await assert.rejects(verifyNativeNotices(output), /digest mismatch/);
});
