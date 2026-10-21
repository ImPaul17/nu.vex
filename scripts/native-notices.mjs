import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const registry = 'registry+https://github.com/rust-lang/crates.io-index';
const maximumText = 32 * 1024 * 1024;
const maximumArchive = 96 * 1024 * 1024;
const decoder = new TextDecoder('utf-8', { fatal: true });
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function fail(message) { throw new Error(`native notices: ${message}`); }
function text(bytes, label) {
  if (bytes.length > maximumText || bytes.includes(0)) fail(`invalid/oversized notice text: ${label}`);
  try { return decoder.decode(bytes); } catch { fail(`notice is not UTF-8: ${label}`); }
}
function safeRelative(path) {
  if (!path || path.length > 500 || isAbsolute(path) || /[\\:\x00-\x1f]/.test(path) ||
      path.split('/').some((part) => !part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    fail('unsafe archive/notice path');
  }
  return path;
}
function stringValue(value) {
  const trimmed = value.trim();
  if (/^"(?:[^"\\]|\\.)*"$/.test(trimmed)) return JSON.parse(trimmed);
  if (/^'[^']*'$/.test(trimmed)) return trimmed.slice(1, -1);
  fail('unsupported Cargo identity/license metadata');
}

// Cargo.lock v3/v4 has a deliberately small, generated format. Unknown sources
// fail rather than being silently treated as equivalent to crates.io.
export function parseLockedPackages(source) {
  if (!/^version = [34]\s*$/m.test(source)) fail('unsupported Cargo.lock version');
  const entries = [];
  for (const block of source.split(/^\[\[package\]\]\s*$/m).slice(1)) {
    const fields = {};
    for (const line of block.split(/\r?\n/)) {
      const match = /^(name|version|source|checksum)\s*=\s*(".*")\s*$/.exec(line);
      if (match) fields[match[1]] = stringValue(match[2]);
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(fields.name ?? '') || !/^[0-9][a-zA-Z0-9.+_-]*$/.test(fields.version ?? '')) fail('invalid locked package');
    if (!fields.source) {
      if (!['nuvex-desktop', 'nuvex-transport'].includes(fields.name)) fail(`unreviewed local package ${fields.name}`);
      continue;
    }
    if (fields.source !== registry || !/^[a-f0-9]{64}$/.test(fields.checksum ?? '')) fail(`unsupported source/checksum for ${fields.name}`);
    entries.push(fields);
  }
  if (!entries.length || entries.length > 2000) fail('empty/oversized locked package union');
  const unique = new Set(entries.map((item) => `${item.name}@${item.version}`));
  if (unique.size !== entries.length) fail('duplicate locked registry package');
  return entries.sort((a, b) => order(`${a.name}@${a.version}`, `${b.name}@${b.version}`));
}

function tarNumber(bytes) {
  const value = bytes.toString('ascii').replace(/\0.*$/, '').trim();
  if (!/^[0-7]+$/.test(value || '0')) fail('unsupported tar numeric field');
  return parseInt(value || '0', 8);
}
function tarString(bytes) { return decoder.decode(bytes.subarray(0, bytes.indexOf(0) < 0 ? bytes.length : bytes.indexOf(0))); }

// Read the authenticated archive in memory; never extract an archive to disk.
// Cargo crate archives use regular ustar members and GNU long-name records.
// Long names are validated before use; links and other special entries fail.
export function crateMembers(compressed, prefix) {
  if (compressed.length > maximumArchive) fail('crate archive exceeds size bound');
  let tar;
  try { tar = gunzipSync(compressed, { maxOutputLength: 512 * 1024 * 1024 }); } catch { fail('invalid/oversized crate gzip'); }
  const result = new Map();
  let offset = 0;
  let longName;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((value) => value === 0)) break;
    const stored = tarNumber(header.subarray(148, 156));
    const actual = header.reduce((sum, value, index) => sum + (index >= 148 && index < 156 ? 32 : value), 0);
    if (stored !== actual) fail('tar header checksum mismatch');
    const headerName = `${tarString(header.subarray(345, 500)) ? `${tarString(header.subarray(345, 500))}/` : ''}${tarString(header.subarray(0, 100))}`;
    const size = tarNumber(header.subarray(124, 136));
    const type = String.fromCharCode(header[156] || 48);
    const start = offset + 512;
    if (start + size > tar.length) fail('truncated crate archive');
    if (type === 'L') {
      if (longName || headerName !== '././@LongLink' || size < 2 || size > 1000) fail('invalid GNU long-name record');
      const bytes = tar.subarray(start, start + size);
      if (bytes.at(-1) !== 0 || bytes.subarray(0, -1).includes(0)) fail('invalid GNU long-name text');
      longName = decoder.decode(bytes.subarray(0, -1));
      offset = start + Math.ceil(size / 512) * 512;
      continue;
    }
    if (!['0', '5'].includes(type)) fail('unsupported crate archive member type');
    const name = longName ?? headerName;
    longName = undefined;
    if (!name.startsWith(`${prefix}/`)) fail('crate archive package prefix mismatch');
    const path = name.slice(prefix.length + 1).replace(/\/$/, '');
    if (path) safeRelative(path);
    if (type === '0') {
      if (!path || result.has(path)) fail('duplicate/empty crate member');
      result.set(path, tar.subarray(start, start + size));
    }
    offset = start + Math.ceil(size / 512) * 512;
    if (result.size > 50000) fail('crate member count exceeds bound');
  }
  if (longName) fail('dangling GNU long-name record');
  if (!result.has('Cargo.toml')) fail('crate has no normalized Cargo.toml');
  return result;
}

function manifestIdentity(bytes) {
  const fields = {};
  let inPackage = false;
  for (const line of text(bytes, 'Cargo.toml').split(/\r?\n/)) {
    if (/^\[/.test(line)) inPackage = line.trim() === '[package]';
    if (!inPackage) continue;
    const match = /^(name|version|license|license-file|license_file)\s*=\s*(.*?)\s*$/.exec(line);
    if (match) fields[match[1].replace('_', '-')] = stringValue(match[2]);
  }
  return fields;
}
function noticePath(path) {
  return path.split('/').some((part) => /^licen[cs]es$/i.test(part)) ||
    /^(?:licen[cs]e|copying|notice|copyright|unlicense)(?:$|[._-])/i.test(basename(path));
}
async function sourceBytes(root, path, archived) {
  const source = join(root, safeRelative(path));
  const absoluteRoot = await realpath(root);
  const absoluteFile = await realpath(source);
  if (!absoluteFile.startsWith(`${absoluteRoot}${sep}`) || !(await lstat(source)).isFile()) fail('source notice escapes crate root');
  const bytes = await readFile(source);
  if (!bytes.equals(archived)) fail(`cached source differs from locked archive: ${path}`);
  return bytes;
}

export async function collectCrate(entry, cargoHome, supplements = []) {
  const label = `${entry.name}-${entry.version}`;
  const registryRoots = (await readdir(join(cargoHome, 'registry/cache'), { withFileTypes: true }))
    .filter((item) => item.isDirectory() && /^index\.crates\.io-[a-z0-9]+$/.test(item.name));
  let location;
  for (const candidate of registryRoots) {
    const archive = join(cargoHome, 'registry/cache', candidate.name, `${label}.crate`);
    try {
      const info = await lstat(archive);
      if (!info.isFile() || info.size > maximumArchive) fail(`invalid crate archive ${label}`);
      if (location) fail(`ambiguous registry cache for ${label}`);
      location = { archive, source: join(cargoHome, 'registry/src', candidate.name, label) };
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (!location) fail(`missing locked archive ${label}; run cargo fetch --locked without --target first`);
  const compressed = await readFile(location.archive);
  if (sha256(compressed) !== entry.checksum) fail(`locked archive digest mismatch: ${label}`);
  const members = crateMembers(compressed, label);
  const metadata = manifestIdentity(await sourceBytes(location.source, 'Cargo.toml', members.get('Cargo.toml')));
  if (metadata.name !== entry.name || metadata.version !== entry.version || (!metadata.license && !metadata['license-file'])) fail(`missing/mismatched package license metadata: ${label}`);
  // Recent Cargo caches need not contain .cargo-checksum.json. The locked
  // archive digest and byte comparison above remain mandatory in that case.
  let checksum;
  try { checksum = JSON.parse(await readFile(join(location.source, '.cargo-checksum.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (checksum && checksum.package !== entry.checksum) fail(`source checksum provenance mismatch: ${label}`);
  const paths = new Set([...members.keys()].filter(noticePath));
  if (metadata['license-file']) paths.add(safeRelative(metadata['license-file']));
  if (entry.name === 'ring') {
    for (const path of ['LICENSE', 'LICENSE-BoringSSL', 'LICENSE-other-bits', 'src/polyfill/once_cell/LICENSE-APACHE', 'src/polyfill/once_cell/LICENSE-MIT']) paths.add(path);
  }
  const supplement = supplements.find((item) => item.name === entry.name && item.version === entry.version);
  if (!paths.size && !supplement) fail(`no full license text in locked crate ${label}; explicit upstream source review required`);
  const notices = [];
  for (const path of [...paths].sort(order)) {
    const archived = members.get(path);
    if (!archived) fail(`referenced notice missing from locked crate ${label}: ${path}`);
    const bytes = await sourceBytes(location.source, path, archived);
    text(bytes, `${label}/${path}`);
    if (checksum?.files?.[path] && checksum.files[path] !== sha256(bytes)) fail(`Cargo source text checksum mismatch: ${label}/${path}`);
    notices.push({ path, bytes });
  }
  const upstream = [];
  if (supplement) {
    if (supplement.crateChecksum !== entry.checksum || !Array.isArray(supplement.files) || !supplement.files.length) fail(`supplement crate identity changed: ${label}`);
    const recordedLicense = supplement.licenseExpression ?? supplement.upstreamLicense;
    if (recordedLicense && recordedLicense !== metadata.license) fail(`supplement declared license changed: ${label}`);
    const vcsBytes = members.get('.cargo_vcs_info.json');
    if (supplement.vcsCommit) {
      const vcs = vcsBytes ? JSON.parse(text(vcsBytes, '.cargo_vcs_info.json')) : null;
      if (vcs?.git?.sha1 !== supplement.vcsCommit || (vcs.path_in_vcs ?? '') !== supplement.pathInVcs) fail(`supplement VCS provenance changed: ${label}`);
    } else if (vcsBytes) fail(`supplement must bind available VCS provenance: ${label}`);
    if (supplement.licenseSelection) {
      const offered = (metadata.license ?? '').replace(/[()]/g, '').split(/\s+OR\s+/).map((item) => item.trim());
      if (/\bAND\b/.test(metadata.license ?? '') || !offered.includes(supplement.licenseSelection)) fail(`supplement license choice is not an offered alternative: ${label}`);
    }
    for (const item of supplement.files) {
      if (!item.url.startsWith('https://') || !/^[a-f0-9]{64}$/.test(item.sha256) || !Number.isSafeInteger(item.bytes)) fail('invalid supplemental notice provenance');
      const bytes = await readFile(join(supplement.root, safeRelative(item.file)));
      text(bytes, item.file);
      if (bytes.length !== item.bytes || sha256(bytes) !== item.sha256) fail(`supplemental notice digest mismatch: ${label}`);
      notices.push({ path: `upstream-supplement/${item.file}`, bytes });
      upstream.push({ ...item, vcsCommit: supplement.vcsCommit, pathInVcs: supplement.pathInVcs });
    }
  }
  return { name: entry.name, version: entry.version, source: registry, checksum: entry.checksum,
    sourceArchive: `https://static.crates.io/crates/${entry.name}/${entry.name}-${entry.version}.crate`,
    declaredLicense: metadata.license ?? null, noticeLicenseSelection: supplement?.licenseSelection ?? null,
    selectionReason: supplement?.selectionReason ?? null,
    supplementProvenance: supplement ? { vcsCommit: supplement.vcsCommit, pathInVcs: supplement.pathInVcs,
      licenseSourceCommit: supplement.licenseSourceCommit ?? null,
      historicalNoticeProvenance: supplement.historicalNoticeProvenance ?? null,
      provenanceNote: supplement.provenanceNote ?? supplement.notes ?? supplement.note ?? null,
      upstreamAuthors: supplement.authors ?? [] } : null,
    scope: 'conservative-all-target-lock-union', upstreamSupplements: upstream, notices };
}

async function regularTree(root, prefix = '') {
  const result = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    safeRelative(path);
    if (entry.isDirectory()) result.push(...await regularTree(root, path));
    else if (entry.isFile()) result.push(path);
    else fail('non-regular notice tree member');
  }
  return result.sort(order);
}

export async function collectNativeNotices({ root, cargoHome, output, target, sysroot, rustcVersion }) {
  if (!/^(?:x86_64-pc-windows-msvc|x86_64-unknown-linux-gnu|aarch64-apple-darwin|x86_64-pc-windows-gnu)$/.test(target)) fail('unsupported target');
  if (!/^rustc [0-9][a-zA-Z0-9 .()+_-]+$/.test(rustcVersion)) fail('invalid rustc identity');
  const lockBytes = await readFile(join(root, 'apps/desktop/src-tauri/Cargo.lock'));
  const locked = parseLockedPackages(lockBytes.toString('utf8'));
  await mkdir(output, { recursive: true });
  if ((await readdir(output)).length) fail('output must be empty; refusing to retain stale notices');
  const files = [];
  let totalBytes = 0;
  const put = async (path, bytes) => {
    safeRelative(path);
    text(bytes, path);
    totalBytes += bytes.length;
    if (files.length > 20000 || totalBytes > 128 * 1024 * 1024) fail('notice collection exceeds aggregate bound');
    if (files.some((item) => item.file.toLowerCase() === path.toLowerCase())) fail('duplicate notice output');
    await mkdir(dirname(join(output, path)), { recursive: true });
    await writeFile(join(output, path), bytes);
    const record = { file: path, bytes: bytes.length, sha256: sha256(bytes) };
    files.push(record);
    return record;
  };
  for (const name of ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md']) await put(`project/${name}`, await readFile(join(root, name)));
  const frontendRoot = join(root, 'apps/web/static/licenses');
  for (const path of await regularTree(frontendRoot)) await put(`frontend/licenses/${path}`, await readFile(join(frontendRoot, path)));
  await put('frontend/fonts/LICENSE.txt', await readFile(join(root, 'apps/web/static/fonts/LICENSE.txt')));
  const packages = [];
  const supplementRoot = join(root, 'docs/legal/crate-supplements');
  let supplements = [];
  try {
    const policy = JSON.parse(await readFile(join(supplementRoot, 'policy.json'), 'utf8'));
    if (policy.schemaVersion !== 1 || !Array.isArray(policy.packages)) fail('invalid crate supplement policy');
    const seen = new Set();
    for (const item of policy.packages) {
      const key = `${item.name}@${item.version}`;
      if (seen.has(key) || !locked.some((entry) => entry.name === item.name && entry.version === item.version && entry.checksum === item.crateChecksum)) fail('duplicate/stale crate supplement policy identity');
      seen.add(key);
    }
    supplements = policy.packages.map((item) => ({ ...item, root: supplementRoot }));
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const entry of locked) {
    const crate = await collectCrate(entry, cargoHome, supplements);
    const notices = [];
    for (const item of crate.notices) notices.push(await put(`rust/crates/${crate.name}-${crate.version}/${item.path}`, item.bytes));
    packages.push({ ...crate, notices });
  }
  const rustRoot = join(sysroot, 'share/doc/rust');
  for (const name of ['COPYRIGHT.html', 'COPYRIGHT-library.html']) await put(`rust/toolchain/${name}`, await readFile(join(rustRoot, name)));
  for (const path of await regularTree(join(rustRoot, 'licenses'))) await put(`rust/toolchain/licenses/${path}`, await readFile(join(rustRoot, 'licenses', path)));
  const platform = [];
  if (target.includes('windows')) {
    const externalRoot = join(root, 'docs/legal/native-platform');
    const policy = JSON.parse(await readFile(join(externalRoot, 'sources.json'), 'utf8'));
    if (policy.schemaVersion !== 1 || !Array.isArray(policy.files) || policy.files.length > 50) fail('invalid platform notice policy');
    for (const item of policy.files) {
      if (!/^[a-f0-9]{64}$/.test(item.sha256) || !item.url.startsWith('https://')) fail('invalid platform provenance');
      const bytes = await readFile(join(externalRoot, safeRelative(item.file)));
      if (bytes.length !== item.bytes || sha256(bytes) !== item.sha256) fail('platform source text digest mismatch');
      const outputFile = await put(`platform/windows/${item.file}`, bytes);
      platform.push({ ...item, notice: outputFile });
    }
  }
  const index = [
    'nu.vex component notices and corresponding source',
    '',
    'Project: project/LICENSE and project/NOTICE',
    'Fonts: frontend/fonts/LICENSE.txt',
    'Frontend package notices: frontend/licenses/',
    'Rust standard library/toolchain: rust/toolchain/COPYRIGHT-library.html, COPYRIGHT.html and licenses/',
    'These are conservative notice entries, not a claim that every component is linked.',
    '',
  ];
  for (const item of packages) {
    index.push(`${item.name} ${item.version}`, `Declared: ${item.declaredLicense ?? 'See supplied license-file'}`);
    if (item.noticeLicenseSelection) index.push(`Selected offered alternative: ${item.noticeLicenseSelection}`, item.selectionReason);
    index.push(`Complete unmodified source: ${item.sourceArchive}`, `Source archive SHA-256: ${item.checksum}`);
    for (const notice of item.notices) index.push(`  ${notice.file}`);
    if (item.supplementProvenance?.historicalNoticeProvenance) index.push(item.supplementProvenance.historicalNoticeProvenance);
    if (item.supplementProvenance?.provenanceNote) index.push(String(item.supplementProvenance.provenanceNote));
    index.push('');
  }
  if (platform.length) {
    index.push('Additional Windows loader/installer notices');
    for (const item of platform) index.push(`  ${item.notice.file}`, `  Source: ${item.url}`);
  }
  await put('INDEX.txt', Buffer.from(`${index.join('\n')}\n`));
  const readme = 'nu.vex distribution notice collection\n\n' +
    'These exact upstream texts accompany the application. INDEX.txt lists readable component names, notice paths and complete-source download URLs. Read inventory.json for identities, source checksums, and copied-file SHA-256 values.\n\n' +
    'The Cargo section conservatively includes every registry package in the committed desktop Cargo.lock, including other targets and build dependencies. Inclusion is not a claim that a package is linked into this executable. Original declared license expressions are preserved. Complete license/notice files discovered in each archive are retained; supplemental upstream texts and any explicit permitted license alternative are indexed with provenance. The Rust toolchain copyright/license tree is also retained in full.\n\n' +
    'Each registry entry includes a sourceArchive HTTPS URL for its complete unmodified source package and its SHA-256. Obtain the corresponding source at that URL; compare the downloaded archive digest with checksum in inventory.json. The application source is available at https://github.com/ImPaul17/nu.vex.\n\n' +
    'This collection is not a complete linked-payload inventory or a legal compatibility decision. Nonstandard source headers/vendor notices, system and bundled native libraries, the Microsoft CRT, installer tool/plugin dependencies, and AppImage runtime/library redistribution need separate payload-specific review. See the source repository docs/legal/native-distribution.md.\n\n' +
    'Original upstream HTML notice files are preserved as source text; no generated application UI renders arbitrary notice HTML. Fonts and frontend packages retain their own terms in frontend/.\n';
  await put('README.txt', Buffer.from(readme));
  const inventory = { schemaVersion: 1, product: 'nu.vex', scope: 'notice-collection-conservative-lock-union',
    completeLinkedPayloadInventory: false, target, rustcVersion, cargoLockSha256: sha256(lockBytes),
    sourceDiscovery: 'Complete named LICENSE/LICENCE/COPYING/NOTICE/COPYRIGHT/UNLICENSE files and license directories; declared license-file; explicit ring nested texts',
    packages, platform, files: files.sort((a, b) => order(a.file, b.file)),
    remainingReview: ['Source-file/vendor exceptions not discovered by notice filenames', 'Actual linked native and installer payloads and their dependencies',
      ...(target.includes('linux') ? ['AppImage runtime, bundled shared libraries, corresponding source/relinking obligations; see docs/legal/native-distribution.md'] : []),
      ...(target.includes('windows') ? ['Microsoft CRT and any runtime/bootstrapper redistribution', 'NSIS plugin transitive dependencies and actual compressor/stub payload', 'MSI/WiX installer payload'] : []),
      ...(target.includes('apple') ? ['macOS packaged payload and third-party native components'] : [])] };
  await writeFile(join(output, 'inventory.json'), `${JSON.stringify(inventory, null, 2)}\n`);
  return inventory;
}

export async function verifyNativeNotices(root) {
  const inventoryBytes = await readFile(join(root, 'inventory.json'));
  const inventory = JSON.parse(text(inventoryBytes, 'inventory.json'));
  if (inventory.schemaVersion !== 1 || inventory.product !== 'nu.vex' || inventory.scope !== 'notice-collection-conservative-lock-union' ||
      !Array.isArray(inventory.files) || !inventory.files.length || inventory.files.length > 20000 ||
      !Array.isArray(inventory.packages) || !inventory.packages.length || inventory.completeLinkedPayloadInventory !== false) fail('invalid collection inventory');
  const expected = new Set(['inventory.json']);
  for (const file of inventory.files) {
    safeRelative(file.file);
    if (expected.has(file.file) || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > maximumText) fail('invalid notice file record');
    expected.add(file.file);
    const bytes = await sourceBytes(root, file.file, await readFile(join(root, file.file)));
    if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256) fail(`installed notice digest mismatch: ${file.file}`);
  }
  const actual = await regularTree(root);
  if (actual.length !== expected.size || actual.some((path) => !expected.has(path))) fail('installed notice file set differs from inventory');
  return { files: inventory.files.length, packages: inventory.packages.length, target: inventory.target };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = new Map();
  for (let index = 2; index < process.argv.length; index += 2) {
    if (!process.argv[index].startsWith('--') || !process.argv[index + 1]) fail('expected --key value arguments');
    args.set(process.argv[index].slice(2), process.argv[index + 1]);
  }
  if (args.has('verify')) {
    const verified = await verifyNativeNotices(resolve(args.get('verify')));
    console.log(`Verified ${verified.files} exact notice files for ${verified.target}, ${verified.packages} conservatively listed packages.`);
  } else {
  const root = resolve(args.get('root') ?? fileURLToPath(new URL('..', import.meta.url)));
  const rustc = args.get('rustc') ?? 'rustc';
  const sysroot = args.get('sysroot') ?? execFileSync(rustc, ['--print', 'sysroot'], { encoding: 'utf8' }).trim();
  const rustcVersion = args.get('rustc-version') ?? execFileSync(rustc, ['--version'], { encoding: 'utf8' }).trim();
  if (!args.get('target') || !args.get('output')) fail('--target and --output are required');
  const inventory = await collectNativeNotices({ root, cargoHome: resolve(args.get('cargo-home') ?? process.env.CARGO_HOME ?? join(homedir(), '.cargo')),
    output: resolve(args.get('output')), target: args.get('target'), sysroot, rustcVersion });
  console.log(`Collected exact notices for ${inventory.packages.length} locked registry packages and ${inventory.files.length} files; payload-specific review remains required.`);
  }
}
