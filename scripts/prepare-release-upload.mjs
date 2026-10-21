import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const expectedPlatforms = Object.freeze({
  'windows-x64': { target: 'x86_64-pc-windows-msvc', suffixes: ['.exe', '.msi'] },
  'linux-x64': { target: 'x86_64-unknown-linux-gnu', suffixes: ['.deb'] },
  'macos-arm64': { target: 'aarch64-apple-darwin', suffixes: ['.dmg'] },
});

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
  if (typeof tag !== 'string' || !/^v\d+\.\d+\.\d+-alpha\.\d+$/.test(tag)) {
    fail('expected an alpha release tag such as v0.2.0-alpha.6');
  }
  if (typeof revision !== 'string' || !/^[a-f0-9]{40}$/.test(revision)) {
    fail('revision must be a complete lowercase Git commit SHA');
  }
  const project = JSON.parse(await readFile(resolve('package.json'), 'utf8'));
  if (project.version !== tag.slice(1)) fail(`tag ${tag} does not match project version ${project.version}`);
  const inputRoot = resolve(input);
  const outputRoot = resolve(output);
  const manifests = await findManifests(inputRoot);
  if (manifests.length !== 3) fail(`expected three platform manifests, found ${manifests.length}`);
  await mkdir(outputRoot, { recursive: true });
  const assets = [];
  const platforms = [];
  const seenPlatforms = new Set();
  for (const manifestPath of manifests) {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (!manifest || manifest.product !== 'nu.vex' || manifest.schemaVersion !== 1 || manifest.unsigned !== true) {
      fail(`invalid platform manifest ${basename(manifestPath)}`);
    }
    const expected = Object.hasOwn(expectedPlatforms, manifest.platform) ? expectedPlatforms[manifest.platform] : null;
    if (!expected || manifest.target !== expected.target) fail(`unsupported platform/target ${manifest.platform}/${manifest.target}`);
    if (seenPlatforms.has(manifest.platform)) fail(`duplicate platform ${manifest.platform}`);
    seenPlatforms.add(manifest.platform);
    if (!Array.isArray(manifest.files) || manifest.files.length !== expected.suffixes.length) {
      fail(`expected ${expected.suffixes.length} installers for ${manifest.platform}`);
    }
    const seenSuffixes = new Set();
    const platformRoot = resolve(manifestPath, '..');
    for (const file of manifest.files) {
      if (!file || typeof file.name !== 'string' || file.name !== basename(file.name) ||
          file.name === '.' || file.name === '..' || /[\x00-\x1f\x7f/\\:]/.test(file.name) ||
          !file.name.startsWith(`nuvex-${manifest.platform}-`)) {
        fail(`invalid installer name for ${manifest.platform}`);
      }
      const suffix = extname(file.name);
      if (!expected.suffixes.includes(suffix) || seenSuffixes.has(suffix)) {
        fail(`unexpected or duplicate installer format ${suffix} for ${manifest.platform}`);
      }
      seenSuffixes.add(suffix);
      if (!Number.isSafeInteger(file.bytes) || file.bytes <= 0 ||
          typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)) {
        fail(`invalid size/hash metadata for ${file.name}`);
      }
      if (assets.some((asset) => asset.name === file.name)) fail(`duplicate release asset ${file.name}`);
      const source = join(platformRoot, file.name);
      if (!(await lstat(source)).isFile()) fail(`installer is not a regular file: ${file.name}`);
      const bytes = await readFile(source);
      if (bytes.byteLength !== file.bytes || digest(bytes) !== file.sha256) {
        fail(`hash mismatch for ${file.name}`);
      }
      await copyFile(source, join(outputRoot, file.name));
      assets.push({ name: file.name, bytes: bytes.byteLength, sha256: file.sha256 });
    }
    platforms.push({ platform: manifest.platform, target: manifest.target, files: manifest.files.map((file) => file.name).sort() });
  }
  platforms.sort((left, right) => left.platform.localeCompare(right.platform));
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
