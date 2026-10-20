import { createHash } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function fail(message) {
  throw new Error(`release upload preparation failed: ${message}`);
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--') || !argv[index + 1]) fail(`missing value for ${key}`);
    values.set(key.slice(2), argv[index + 1]);
    index += 1;
  }
  for (const key of ['input', 'output', 'tag', 'revision']) {
    if (!values.has(key)) fail(`--${key} is required`);
  }
  return values;
}

async function findManifests(root) {
  const result = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name === 'release-manifest.json') result.push(path);
    }
  }
  await visit(root);
  return result.sort();
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function prepareReleaseUpload({ input, output, tag, revision }) {
  const inputRoot = resolve(input);
  const outputRoot = resolve(output);
  const manifests = await findManifests(inputRoot);
  if (manifests.length !== 3) fail(`expected three platform manifests, found ${manifests.length}`);
  await mkdir(outputRoot, { recursive: true });
  const assets = [];
  const platforms = [];
  for (const manifestPath of manifests) {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (manifest.product !== 'nu.vex' || manifest.schemaVersion !== 1 || manifest.unsigned !== true) {
      fail(`invalid platform manifest ${basename(manifestPath)}`);
    }
    if (!Array.isArray(manifest.files) || !manifest.files.length) fail(`empty platform manifest ${basename(manifestPath)}`);
    const platformRoot = resolve(manifestPath, '..');
    platforms.push({ platform: manifest.platform, target: manifest.target, files: manifest.files.map((file) => file.name) });
    for (const file of manifest.files) {
      if (assets.some((asset) => asset.name === file.name)) fail(`duplicate release asset ${file.name}`);
      const source = join(platformRoot, file.name);
      const bytes = await readFile(source);
      if (bytes.byteLength !== file.bytes || digest(bytes) !== file.sha256) {
        fail(`hash mismatch for ${file.name}`);
      }
      await copyFile(source, join(outputRoot, file.name));
      assets.push({ name: file.name, bytes: bytes.byteLength, sha256: file.sha256 });
    }
  }
  assets.sort((left, right) => left.name.localeCompare(right.name));
  const noticeFiles = ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md'];
  for (const notice of noticeFiles) {
    const source = resolve(notice);
    const outputName = `nu.vex-${notice === 'LICENSE' ? 'LICENSE.txt' : notice}`;
    const bytes = await readFile(source);
    await copyFile(source, join(outputRoot, outputName));
    assets.push({ name: outputName, bytes: bytes.byteLength, sha256: digest(bytes), kind: 'source-notice' });
  }
  assets.sort((left, right) => left.name.localeCompare(right.name));
  await writeFile(join(outputRoot, 'SHA256SUMS.txt'),
    `${assets.map((file) => `${file.sha256}  ${file.name}`).join('\n')}\n`);
  await writeFile(join(outputRoot, 'RELEASE-MANIFEST.json'), `${JSON.stringify({
    schemaVersion: 1,
    product: 'nu.vex',
    tag,
    revision,
    prerelease: true,
    unsigned: true,
    platforms,
    assets,
  }, null, 2)}\n`);
  return assets;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const values = parseArgs(process.argv);
  await prepareReleaseUpload({
    input: values.get('input'),
    output: values.get('output'),
    tag: values.get('tag'),
    revision: values.get('revision'),
  });
}
