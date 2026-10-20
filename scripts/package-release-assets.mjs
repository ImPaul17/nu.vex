import { createHash } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const allowed = Object.freeze({
  'windows-x64': new Set(['.exe', '.msi']),
  'linux-x64': new Set(['.AppImage', '.deb']),
  'macos-arm64': new Set(['.dmg']),
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

async function filesUnder(root) {
  const result = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      // AppImage bundling adds these desktop integration entries beside the
      // image. They are inputs to the installer, not distributable assets.
      if (entry.name === '.DirIcon' || entry.name.endsWith('.desktop') ||
          entry.name === 'nuvex-desktop.png' || entry.name === 'bundle_dmg.sh') continue;
      // Tauri's Linux AppImage bundler can expose its icon as a symlink.
      // It is metadata for the bundle and must not become a release asset.
      if (entry.isSymbolicLink()) continue;
      // A DMG build uses an intermediate .app directory. The DMG is the
      // distributable artifact; do not mistake its internal files for release
      // assets or copy the bundle's private contents.
      if (entry.isDirectory()) {
        if (!entry.name.endsWith('.app')) await visit(path);
        continue;
      }
      if (entry.isFile()) result.push(path);
      else fail(`bundle contains a non-regular entry: ${entry.name}`);
    }
  }
  await visit(root);
  return result.sort((left, right) => left.localeCompare(right));
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function packageReleaseAssets({ bundleRoot, output, platform, target }) {
  const root = resolve(bundleRoot);
  const destination = resolve(output);
  const suffixes = allowed[platform];
  if (!suffixes) fail(`unsupported release platform ${platform}`);
  const sourceFiles = await filesUnder(root).catch((error) => {
    if (error.code === 'ENOENT') fail(`bundle directory does not exist: ${platform}`);
    throw error;
  });
  const candidates = sourceFiles.filter((path) => suffixes.has(extname(path)));
  if (!candidates.length) fail(`no expected installer was produced for ${platform}`);
  const unexpected = sourceFiles.filter((path) => !suffixes.has(extname(path)));
  if (unexpected.length) {
    fail(`unexpected bundle output: ${relative(root, unexpected[0])}`);
  }
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
