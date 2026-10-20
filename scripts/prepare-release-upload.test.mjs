import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareReleaseUpload } from './prepare-release-upload.mjs';

test('combines exactly three verified platform manifests and source notices', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nuvex-upload-'));
  const input = join(root, 'input');
  const output = join(root, 'output');
  await mkdir(input, { recursive: true });
  for (const platform of ['windows-x64', 'linux-x64', 'macos-arm64']) {
    const folder = join(input, platform);
    await mkdir(folder);
    const name = `nuvex-${platform}-installer`;
    const content = platform;
    const { createHash } = await import('node:crypto');
    const sha256 = createHash('sha256').update(content).digest('hex');
    await writeFile(join(folder, name), content);
    await writeFile(join(folder, 'release-manifest.json'), JSON.stringify({
      schemaVersion: 1,
      product: 'nu.vex',
      platform,
      target: platform,
      unsigned: true,
      files: [{ name, bytes: content.length, sha256 }],
    }));
  }
  for (const notice of ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md']) {
    await writeFile(join(root, notice), notice);
  }
  const previous = process.cwd();
  process.chdir(root);
  try {
    const assets = await prepareReleaseUpload({ input, output, tag: 'v0.2.0-alpha.3', revision: 'abc123' });
    assert.equal(assets.length, 6);
    const manifest = JSON.parse(await readFile(join(output, 'RELEASE-MANIFEST.json'), 'utf8'));
    assert.equal(manifest.tag, 'v0.2.0-alpha.3');
    assert.equal(manifest.platforms.length, 3);
    assert.match(await readFile(join(output, 'SHA256SUMS.txt'), 'utf8'), /nu\.vex-LICENSE\.txt/);
  } finally {
    process.chdir(previous);
  }
});
