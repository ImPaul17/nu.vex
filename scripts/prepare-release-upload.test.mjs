import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareReleaseUpload } from './prepare-release-upload.mjs';

const tag = 'v0.2.0-alpha.6';
const revision = 'a'.repeat(40);
const definitions = [
  ['windows-x64', 'x86_64-pc-windows-msvc', ['.exe', '.msi']],
  ['linux-x64', 'x86_64-unknown-linux-gnu', ['.deb']],
  ['macos-arm64', 'aarch64-apple-darwin', ['.dmg']],
];

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'nuvex-upload-'));
  const input = join(root, 'input');
  const output = join(root, 'output');
  const manifests = new Map();
  await mkdir(input);
  for (const [platform, target, suffixes] of definitions) {
    const folder = join(input, platform);
    await mkdir(folder);
    const files = [];
    for (const suffix of suffixes) {
      const name = `nuvex-${platform}-nu.vex_0.2.0${suffix}`;
      const content = Buffer.from(`${platform}${suffix}`);
      await writeFile(join(folder, name), content);
      files.push({ name, bytes: content.length, sha256: createHash('sha256').update(content).digest('hex') });
    }
    const manifest = { schemaVersion: 1, product: 'nu.vex', platform, target, unsigned: true, files };
    const path = join(folder, 'release-manifest.json');
    await writeFile(path, JSON.stringify(manifest));
    manifests.set(platform, { folder, path, manifest });
  }
  for (const notice of ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md']) {
    await writeFile(join(root, notice), notice);
  }
  await writeFile(join(root, 'package.json'), JSON.stringify({ version: tag.slice(1) }));
  const previous = process.cwd();
  process.chdir(root);
  try {
    await run({
      root, input, output, manifests,
      prepare: (overrides = {}) => prepareReleaseUpload({ input, output, tag, revision, ...overrides }),
      save: async (platform) => {
        const entry = manifests.get(platform);
        await writeFile(entry.path, JSON.stringify(entry.manifest));
      },
    });
  } finally {
    process.chdir(previous);
  }
}

test('combines all four verified installers and preserves source notices', async () => {
  await fixture(async ({ output, prepare }) => {
    const assets = await prepare();
    assert.equal(assets.length, 7);
    const manifest = JSON.parse(await readFile(join(output, 'RELEASE-MANIFEST.json'), 'utf8'));
    assert.equal(manifest.tag, tag);
    assert.equal(manifest.revision, revision);
    assert.deepEqual(manifest.platforms.map((platform) => [platform.platform, platform.files.length]), [
      ['linux-x64', 1], ['macos-arm64', 1], ['windows-x64', 2],
    ]);
    for (const asset of manifest.assets) {
      const bytes = await readFile(join(output, asset.name));
      assert.equal(bytes.length, asset.bytes);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256);
    }
    assert.equal(await readFile(join(output, 'nu.vex-LICENSE.txt'), 'utf8'), 'LICENSE');
    assert.match(await readFile(join(output, 'SHA256SUMS.txt'), 'utf8'), /nu\.vex-THIRD_PARTY_NOTICES\.md/);
  });
});

test('rejects a missing platform manifest', async () => {
  await fixture(async ({ manifests, prepare }) => {
    await unlink(manifests.get('macos-arm64').path);
    await assert.rejects(prepare(), /expected three platform manifests, found 2/);
  });
});

test('rejects a repeated platform even when there are three manifests', async () => {
  await fixture(async ({ manifests, save, prepare }) => {
    const manifest = manifests.get('macos-arm64').manifest;
    manifest.platform = 'linux-x64';
    manifest.target = 'x86_64-unknown-linux-gnu';
    await save('macos-arm64');
    await assert.rejects(prepare(), /duplicate platform linux-x64/);
  });
});

test('rejects a missing installer format', async () => {
  await fixture(async ({ manifests, save, prepare }) => {
    manifests.get('windows-x64').manifest.files.pop();
    await save('windows-x64');
    await assert.rejects(prepare(), /expected 2 installers for windows-x64/);
  });
});

test('rejects a duplicate format instead of accepting two EXE files', async () => {
  await fixture(async ({ manifests, save, prepare }) => {
    const files = manifests.get('windows-x64').manifest.files;
    files[1] = { ...files[0], name: 'nuvex-windows-x64-second.exe' };
    await save('windows-x64');
    await assert.rejects(prepare(), /duplicate installer format \.exe/);
  });
});

test('rejects an AppImage in the Debian-only Linux release', async () => {
  await fixture(async ({ manifests, save, prepare }) => {
    const files = manifests.get('linux-x64').manifest.files;
    const appImage = { ...files[0], name: 'nuvex-linux-x64-nu.vex_0.2.0.AppImage' };
    const deb = files[0];
    files[0] = appImage;
    await save('linux-x64');
    await assert.rejects(prepare(), /unexpected or duplicate installer format \.AppImage/);
    files[0] = deb;
    files.push(appImage);
    await save('linux-x64');
    await assert.rejects(prepare(), /expected 1 installers for linux-x64/);
  });
});

test('rejects an incorrect platform target', async () => {
  await fixture(async ({ manifests, save, prepare }) => {
    manifests.get('macos-arm64').manifest.target = 'x86_64-apple-darwin';
    await save('macos-arm64');
    await assert.rejects(prepare(), /unsupported platform\/target/);
  });
});

test('rejects traversal in installer names on every host', async () => {
  await fixture(async ({ manifests, save, prepare }) => {
    const file = manifests.get('windows-x64').manifest.files[0];
    for (const name of ['nuvex-windows-x64-../outside.exe', 'nuvex-windows-x64-..\\outside.exe']) {
      file.name = name;
      await save('windows-x64');
      await assert.rejects(prepare(), /invalid installer name/);
    }
  });
});

test('rejects a tampered installer even when its byte length is unchanged', async () => {
  await fixture(async ({ manifests, prepare }) => {
    const entry = manifests.get('linux-x64');
    const file = entry.manifest.files[0];
    await writeFile(join(entry.folder, file.name), Buffer.alloc(file.bytes, 42));
    await assert.rejects(prepare(), /hash mismatch/);
  });
});

test('rejects invalid size or hash metadata', async () => {
  await fixture(async ({ manifests, save, prepare }) => {
    const file = manifests.get('linux-x64').manifest.files[0];
    const bytes = file.bytes;
    file.bytes = -1;
    await save('linux-x64');
    await assert.rejects(prepare(), /invalid size\/hash metadata/);
    file.bytes = bytes;
    file.sha256 = 'not-a-hash';
    await save('linux-x64');
    await assert.rejects(prepare(), /invalid size\/hash metadata/);
  });
});

test('rejects a tag that does not match the checked-out package version', async () => {
  await fixture(async ({ prepare }) => {
    await assert.rejects(prepare({ tag: 'v0.2.0-alpha.7' }), /does not match project version/);
    await assert.rejects(prepare({ tag: 'v0.2.0' }), /expected an alpha release tag/);
  });
});

test('rejects a revision without a complete commit SHA', async () => {
  await fixture(async ({ prepare }) => {
    await assert.rejects(prepare({ revision: 'abc123' }), /complete lowercase Git commit SHA/);
  });
});
