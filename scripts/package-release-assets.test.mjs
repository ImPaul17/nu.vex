import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { packageReleaseAssets } from './package-release-assets.mjs';

test('packages only the expected Windows installers and records hashes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nuvex-release-'));
  const bundle = join(root, 'bundle');
  const output = join(root, 'output');
  await mkdir(bundle);
  await writeFile(join(bundle, 'nuvex_0.2.0_x64-setup.exe'), 'exe');
  await writeFile(join(bundle, 'nuvex_0.2.0_x64_en-US.msi'), 'msi');
  const files = await packageReleaseAssets({
    bundleRoot: bundle,
    output,
    platform: 'windows-x64',
    target: 'x86_64-pc-windows-msvc',
  });
  assert.deepEqual(files.map((file) => file.name), [
    'nuvex-windows-x64-nuvex_0.2.0_x64_en-US.msi',
    'nuvex-windows-x64-nuvex_0.2.0_x64-setup.exe',
  ]);
  const sums = await readFile(join(output, 'SHA256SUMS.txt'), 'utf8');
  assert.match(sums, /^[a-f0-9]{64}  nuvex-windows-x64-/m);
  const manifest = JSON.parse(await readFile(join(output, 'release-manifest.json'), 'utf8'));
  assert.equal(manifest.unsigned, true);
  assert.equal(manifest.target, 'x86_64-pc-windows-msvc');
});

test('fails closed when a platform receives an unexpected bundle type', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nuvex-release-'));
  const bundle = join(root, 'bundle');
  await mkdir(bundle);
  await writeFile(join(bundle, 'nuvex.AppImage'), 'appimage');
  await writeFile(join(bundle, 'unexpected.tar.gz'), 'archive');
  await assert.rejects(
    packageReleaseAssets({
      bundleRoot: bundle,
      output: join(root, 'output'),
      platform: 'linux-x64',
      target: 'x86_64-unknown-linux-gnu',
    }),
    /unexpected bundle output/,
  );
});

test('ignores the macOS intermediate app bundle when packaging its DMG', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nuvex-release-'));
  const bundle = join(root, 'bundle');
  const app = join(bundle, 'nu.vex.app', 'Contents');
  await mkdir(app, { recursive: true });
  await writeFile(join(app, 'Info.plist'), 'private app payload');
  await writeFile(join(bundle, 'nu.vex_0.2.0_aarch64.dmg'), 'dmg');
  const files = await packageReleaseAssets({
    bundleRoot: bundle,
    output: join(root, 'output'),
    platform: 'macos-arm64',
    target: 'aarch64-apple-darwin',
  });
  assert.equal(files.length, 1);
  assert.match(files[0].name, /\.dmg$/);
});

test('ignores bundler metadata beside Linux and macOS installers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nuvex-release-'));
  const linuxBundle = join(root, 'linux-bundle');
  const macBundle = join(root, 'mac-bundle');
  await mkdir(linuxBundle);
  await mkdir(macBundle);
  await writeFile(join(linuxBundle, 'nuvex-desktop.png'), 'icon metadata');
  await writeFile(join(linuxBundle, 'nuvex-desktop.desktop'), 'desktop metadata');
  await writeFile(join(linuxBundle, 'nuvex_0.2.0_amd64.AppImage'), 'appimage');
  await writeFile(join(macBundle, 'bundle_dmg.sh'), 'dmg helper');
  await writeFile(join(macBundle, 'nu.vex_0.2.0_aarch64.dmg'), 'dmg');

  const linuxFiles = await packageReleaseAssets({
    bundleRoot: linuxBundle,
    output: join(root, 'linux-output'),
    platform: 'linux-x64',
    target: 'x86_64-unknown-linux-gnu',
  });
  const macFiles = await packageReleaseAssets({
    bundleRoot: macBundle,
    output: join(root, 'mac-output'),
    platform: 'macos-arm64',
    target: 'aarch64-apple-darwin',
  });

  assert.deepEqual(linuxFiles.map((file) => file.name), [
    'nuvex-linux-x64-nuvex_0.2.0_amd64.AppImage',
  ]);
  assert.deepEqual(macFiles.map((file) => file.name), [
    'nuvex-macos-arm64-nu.vex_0.2.0_aarch64.dmg',
  ]);
});
