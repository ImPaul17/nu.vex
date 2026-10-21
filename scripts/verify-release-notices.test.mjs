import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyExtractedNotices } from './verify-release-notices.mjs';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'nuvex-installed-notices-'));
  const expected = join(root, 'expected');
  const searchRoot = join(root, 'extracted');
  const notices = join(searchRoot, 'app', 'notices');
  await mkdir(expected);
  const content = Buffer.from('Upstream license and copyright\n');
  await writeFile(join(expected, 'LICENSE.txt'), content);
  await writeFile(join(expected, 'inventory.json'), JSON.stringify({
    schemaVersion: 1, product: 'nu.vex', scope: 'notice-collection-conservative-lock-union',
    completeLinkedPayloadInventory: false, target: 'x86_64-pc-windows-msvc',
    packages: [{ name: 'fixture', version: '1.0.0' }],
    files: [{ file: 'LICENSE.txt', bytes: content.length, sha256: createHash('sha256').update(content).digest('hex') }],
  }));
  await cp(expected, notices, { recursive: true });
  return { expected, searchRoot, notices };
}

test('finds and verifies the exact build notice inventory in an extracted installer', async () => {
  const paths = await fixture();
  const result = await verifyExtractedNotices(paths);
  assert.equal(result.files, 1);
  assert.equal(result.target, 'x86_64-pc-windows-msvc');
});

test('rejects altered notice content inside the installer', async () => {
  const paths = await fixture();
  await writeFile(join(paths.notices, 'LICENSE.txt'), 'Changed notice');
  await assert.rejects(verifyExtractedNotices(paths), /notice digest mismatch/);
});

test('rejects missing, different or duplicated packaged inventories', async () => {
  const paths = await fixture();
  await writeFile(join(paths.notices, 'inventory.json'), '{}');
  await assert.rejects(verifyExtractedNotices(paths), /found 0/);
  await cp(paths.expected, paths.notices, { recursive: true });
  await cp(paths.expected, join(paths.searchRoot, 'duplicate'), { recursive: true });
  await assert.rejects(verifyExtractedNotices(paths), /found 2/);
});
