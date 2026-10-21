import { createHash } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const allowed = Object.freeze({
  'windows-x64': [['nsis', '.exe'], ['msi', '.msi']],
  'linux-x64': [['deb', '.deb']],
  'macos-arm64': [['dmg', '.dmg']],
});

function fail(message) {
  throw new Error(`release asset packaging failed: ${message}`);
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--') || !argv[index + 1]) fail(`missing value for ${key}`);
    values.set(key.slice(2), argv[index + 1]);
    index += 1;
  }
  for (const key of ['bundle-root', 'output', 'platform', 'target']) {
    if (!values.has(key)) fail(`--${key} is required`);
  }
  return values;
}

async function installersUnder(root, formats) {
  const result = [];
  // Tauri leaves AppDir, DEBIAN/usr staging trees and DMG helpers beside its
  // final packages. Read only the documented output level for each format.
  for (const [folder, suffix] of formats) {
    const directory = join(root, folder);
    const entries = await readdir(directory, { withFileTypes: true });
    const candidates = entries.filter((entry) => entry.name.endsWith(suffix));
    if (candidates.length !== 1) {
      fail(`expected one ${suffix} installer in ${folder}, found ${candidates.length}`);
    }
    const [entry] = candidates;
    if (!entry.isFile()) fail(`installer is not a regular file: ${folder}/${entry.name}`);
    result.push(join(directory, entry.name));
  }
  return result.sort((left, right) => left.localeCompare(right));
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function packageReleaseAssets({ bundleRoot, output, platform, target }) {
  const root = resolve(bundleRoot);
  const destination = resolve(output);
  const formats = allowed[platform];
  if (!formats) fail(`unsupported release platform ${platform}`);
  const candidates = await installersUnder(root, formats).catch((error) => {
    if (error.code === 'ENOENT') fail(`bundle directory does not exist: ${platform}`);
    throw error;
  });
  const names = new Set();
  const files = [];
  await mkdir(destination, { recursive: true });
  for (const source of candidates) {
    const outputName = `nuvex-${platform}-${basename(source)}`;
    if (names.has(outputName)) fail(`duplicate release asset name ${outputName}`);
    names.add(outputName);
    const bytes = await readFile(source);
    await copyFile(source, join(destination, outputName));
    files.push({ name: outputName, bytes: bytes.byteLength, sha256: digest(bytes) });
  }
  files.sort((left, right) => left.name.localeCompare(right.name));
  await writeFile(join(destination, 'SHA256SUMS.txt'),
    `${files.map((file) => `${file.sha256}  ${file.name}`).join('\n')}\n`);
  await writeFile(join(destination, 'release-manifest.json'), `${JSON.stringify({
    schemaVersion: 1,
    product: 'nu.vex',
    platform,
    target,
    unsigned: true,
    files,
  }, null, 2)}\n`);
  return files;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const values = parseArgs(process.argv);
  await packageReleaseAssets({
    bundleRoot: values.get('bundle-root'),
    output: values.get('output'),
    platform: values.get('platform'),
    target: values.get('target'),
  });
}
