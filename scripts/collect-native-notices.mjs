// Windows release evidence and exact upstream notice candidates, never approval.
// Raw process output and source paths stay in an owner-only scratch directory.
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { lstat, mkdir, open, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import * as evidence from './native-build-evidence.mjs';
import { collectNoticeFiles } from './native-notice-files.mjs';

process.umask(0o077);
const repository = resolve(import.meta.dirname, '..');
const target = 'x86_64-pc-windows-msvc';
const tauriCliVersion = '2.12.3';
const runId = randomUUID();
const output = join(repository, '.cache/native-notices', runId);
const scratch = join(output, 'private');
const desktop = join(repository, 'apps/desktop');
const manifestPath = join(desktop, 'src-tauri/Cargo.toml');
const lockPath = join(desktop, 'src-tauri/Cargo.lock');
const configurationPath = join(desktop, 'src-tauri/tauri.conf.json');
const cliPath = join(repository, 'node_modules/@tauri-apps/cli/tauri.js');
const targetDirectory = join(scratch, 'target');
let phase = 'initialization';
let outputProtected = false;

function requireValue(value, message) {
  if (!value) throw Object.assign(new Error(message), { code: 'NUVEX_NOTICE_COLLECTION_INVALID' });
}
function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function inside(parent, child) {
  const path = relative(parent, child);
  return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

async function assertOrdinaryAncestors(path) {
  for (let cursor = path; ; cursor = dirname(cursor)) {
    const information = await lstat(cursor);
    requireValue(information.isDirectory() && !information.isSymbolicLink(), 'Expected ordinary notice output ancestors.');
    if (cursor === dirname(cursor)) return;
  }
}

async function createPrivateOutput() {
  await assertOrdinaryAncestors(repository);
  const base = dirname(output);
  await mkdir(base, { recursive: true, mode: 0o700 });
  await assertOrdinaryAncestors(base);
  await mkdir(output, { mode: 0o700 }); // Never reuse another run's evidence.
  const protect = `
$ErrorActionPreference = 'Stop'
$path = $env:NUVEX_NATIVE_NOTICES_PRIVATE
if (-not [IO.Path]::IsPathFullyQualified($path)) { throw 'Private notice directory must be absolute.' }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
try {
  $acl = [Security.AccessControl.DirectorySecurity]::new()
  $acl.SetOwner($identity.User)
  $acl.SetAccessRuleProtection($true, $false)
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($identity.User, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
  Set-Acl -LiteralPath $path -AclObject $acl
} finally { $identity.Dispose() }
`;
  const protectedDirectory = spawnSync('pwsh.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(protect, 'utf16le').toString('base64')], {
    shell: false, windowsHide: true, timeout: 20_000, encoding: 'utf8', maxBuffer: 16 * 1024,
    env: { ...process.env, NUVEX_NATIVE_NOTICES_PRIVATE: output },
  });
  requireValue(!protectedDirectory.error && protectedDirectory.status === 0, 'Could not protect the private native notice directory.');
  await mkdir(scratch, { mode: 0o700 });
  outputProtected = true;
}

async function capture(binary, args, name, { cwd = repository, timeout = 35 * 60_000, env = {} } = {}) {
  const stdoutPath = join(scratch, `${name}.stdout`);
  const stderrPath = join(scratch, `${name}.stderr`);
  const stdout = await open(stdoutPath, 'wx', 0o600);
  const stderr = await open(stderrPath, 'wx', 0o600);
  let child;
  let timer;
  let timedOut = false;
  try {
    child = spawn(binary, args, {
      cwd, shell: false, windowsHide: true,
      stdio: ['ignore', stdout.fd, stderr.fd],
      env: { ...process.env, CARGO_TARGET_DIR: targetDirectory, CARGO_TERM_COLOR: 'never', ...env },
    });
    timer = setTimeout(() => {
      timedOut = true;
      if (child.pid && child.exitCode === null) {
        // Only this collector's owned child tree; no global process matching.
        const killer = spawnSync(join(process.env.SystemRoot ?? 'C:/Windows', 'System32/taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], {
          shell: false, windowsHide: true, timeout: 15_000, stdio: 'ignore',
        });
        if (killer.error || killer.status !== 0) child.kill();
      }
    }, timeout);
    const [code, signal] = await once(child, 'close');
    requireValue(!timedOut, `${name} exceeded its execution limit.`);
    requireValue(code === 0 && signal === null, `${name} failed with exit code ${Number.isInteger(code) ? code : 'unavailable'}.`);
    requireValue((await stat(stdoutPath)).size <= 256 * 1024 * 1024 && (await stat(stderrPath)).size <= 256 * 1024 * 1024, 'Captured command output exceeded its limit.');
    return { stdoutPath, stderrPath };
  } finally {
    clearTimeout(timer);
    await stdout.close();
    await stderr.close();
  }
}

function safeText(value, maximum, label) {
  requireValue(typeof value === 'string' && value.length > 0 && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value), `Invalid public ${label}.`);
  return value;
}

function relativeLicenseFile(pkg) {
  if (pkg.licenseFile === null) return null;
  const path = resolve(pkg.packageRoot, pkg.licenseFile);
  requireValue(inside(pkg.packageRoot, path), 'The declared license file escapes its registry package.');
  return relative(pkg.packageRoot, path).split(sep).join('/');
}

async function firstPartyNotices() {
  const files = [];
  for (const path of ['LICENSE', 'NOTICE']) {
    const source = join(repository, path);
    const information = await lstat(source);
    requireValue(information.isFile() && !information.isSymbolicLink() && information.size <= 2 * 1024 * 1024, 'Invalid first-party notice source.');
    const content = await readFile(source);
    new TextDecoder('utf-8', { fatal: true }).decode(content);
    files.push({ path, sha256: digest(content), bytes: content.length, content });
  }
  return { files };
}

async function main() {
  requireValue(process.platform === 'win32' && process.arch === 'x64', 'This evidence collector requires native 64-bit Windows.');
  await createPrivateOutput();
  const readme = await readFile(join(repository, 'scripts/native-notices-README.txt'));
  requireValue(readme.length > 0 && readme.length <= 64 * 1024, 'Invalid native notice candidate explanation.');
  new TextDecoder('utf-8', { fatal: true }).decode(readme);
  await writeFile(join(output, 'README.txt'), readme, { flag: 'wx', mode: 0o600 });
  phase = 'toolchain validation';
  const cliPackage = JSON.parse(await readFile(join(repository, 'node_modules/@tauri-apps/cli/package.json'), 'utf8'));
  requireValue(cliPackage.version === tauriCliVersion, 'The installed Tauri CLI differs from the evidence command.');
  const cliProbe = await capture(process.execPath, [cliPath, '--version'], 'tauri-version', { timeout: 30_000 });
  requireValue((await readFile(cliProbe.stdoutPath, 'utf8')).trim() === `tauri-cli ${tauriCliVersion}`, 'Unexpected Tauri CLI executable version.');
  const rustProbe = await capture('rustc.exe', ['--version'], 'rust-version', { timeout: 30_000 });
  const cargoProbe = await capture('cargo.exe', ['--version'], 'cargo-version', { timeout: 30_000 });
  const rustVersion = safeText((await readFile(rustProbe.stdoutPath, 'utf8')).trim(), 256, 'Rust version');
  const cargoVersion = safeText((await readFile(cargoProbe.stdoutPath, 'utf8')).trim(), 256, 'Cargo version');
  requireValue(/^rustc 1\.99\.1\s/.test(rustVersion) && /^cargo 1\.99\.1\s/.test(cargoVersion), 'The evidence collector requires pinned Rust and Cargo 1.99.1.');
  const revisionProbe = await capture('git.exe', ['rev-parse', '--verify', 'HEAD'], 'source-revision', { timeout: 30_000 });
  const sourceRevision = (await readFile(revisionProbe.stdoutPath, 'utf8')).trim().toLowerCase();
  requireValue(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(sourceRevision), 'Unexpected actual Git source revision.');
  const initialStatus = await capture('git.exe', ['status', '--porcelain', '--untracked-files=normal'], 'source-status-before', { timeout: 30_000 });
  requireValue((await readFile(initialStatus.stdoutPath, 'utf8')).trim() === '', 'The source checkout must be clean before collection.');
  const lockBefore = await readFile(lockPath);
  const configurationBefore = await readFile(configurationPath);

  phase = 'Tauri release compilation';
  console.log(`Compiling the actual Windows release with Tauri CLI ${tauriCliVersion}; raw output remains private.`);
  const buildArgs = ['build', '--ci', '--no-bundle', '--target', target, '--', '--locked', '--message-format=json-render-diagnostics'];
  const build = await capture(process.execPath, [cliPath, ...buildArgs], 'tauri-build', { cwd: desktop });
  requireValue(configurationBefore.equals(await readFile(configurationPath)), 'Tauri changed the captured application configuration.');
  const frontendInventoryPath = join(repository, 'apps/web/build/licenses/frontend-inventory.json');
  const frontendInventoryInformation = await lstat(frontendInventoryPath);
  requireValue(frontendInventoryInformation.isFile() && !frontendInventoryInformation.isSymbolicLink() && frontendInventoryInformation.size <= 1024 * 1024, 'Expected the actual built frontend notice inventory.');
  const frontendInventorySha256 = digest(await readFile(frontendInventoryPath));

  phase = 'locked Cargo metadata';
  console.log('Reading locked, platform-filtered Cargo metadata; required registry source downloads are permitted.');
  // Explicit online-capable metadata resolution, without an offline fallback.
  // --locked must reject any dependency-resolution change.
  const metadata = await capture('cargo.exe', ['metadata', '--manifest-path', manifestPath, '--locked', '--format-version', '1', '--filter-platform', target, '--features', 'tauri/custom-protocol'], 'cargo-metadata', { timeout: 10 * 60_000 });
  const lockAfter = await readFile(lockPath);
  requireValue(lockBefore.equals(lockAfter), 'Cargo changed the locked dependency evidence.');
  requireValue(configurationBefore.equals(await readFile(configurationPath)), 'The captured Tauri configuration changed during metadata collection.');

  phase = 'build evidence classification';
  const observed = evidence.analyzeNativeBuild({
    cargoOutput: await readFile(build.stdoutPath, 'utf8'),
    metadata: JSON.parse(await readFile(metadata.stdoutPath, 'utf8')),
    lockText: lockAfter.toString('utf8'), expectedTarget: target,
    rootManifestPath: manifestPath, workspaceRoot: repository,
  });
  requireValue(inside(targetDirectory, observed.executablePath), 'The release executable must belong to this collector run.');
  const executableInformation = await lstat(observed.executablePath);
  requireValue(executableInformation.isFile() && !executableInformation.isSymbolicLink() && executableInformation.size > 0 && executableInformation.size <= 256 * 1024 * 1024, 'Invalid observed release executable.');
  requireValue(inside(await realpath(targetDirectory), await realpath(observed.executablePath)), 'The observed executable escapes the private target directory.');

  phase = 'exact upstream notice collection';
  const packages = [];
  const keys = new Set();
  let totalFiles = 0;
  let totalBytes = 0;
  for (const pkg of observed.packages) {
    requireValue(/^[A-Za-z0-9_-]{1,128}$/.test(pkg.name) && /^[0-9A-Za-z][0-9A-Za-z.+-]{0,127}$/.test(pkg.version), 'Invalid package name or version for notice output.');
    const key = `${pkg.name}@${pkg.version}`;
    requireValue(!keys.has(key), 'Duplicate native notice candidate identity.');
    keys.add(key);
    phase = `exact notice collection for ${key}`;
    let collected;
    if (pkg.source === null) {
      collected = await firstPartyNotices();
    } else {
      requireValue(pkg.source === 'registry+https://github.com/rust-lang/crates.io-index', 'Only the locked canonical crates.io registry is supported.');
      const registryIndex = dirname(pkg.packageRoot);
      const registrySources = dirname(registryIndex);
      requireValue(basename(registrySources) === 'src' && basename(dirname(registrySources)) === 'registry' && basename(pkg.packageRoot) === `${pkg.name}-${pkg.version}`, 'Unexpected registry source cache layout.');
      const packageArchive = join(dirname(registrySources), 'cache', basename(registryIndex), `${basename(pkg.packageRoot)}.crate`);
      collected = await collectNoticeFiles({ packageRoot: pkg.packageRoot, packageArchive, packageChecksum: pkg.checksum, licenseFile: relativeLicenseFile(pkg) });
    }
    const directory = `notices/${pkg.source === null ? 'first-party' : 'crates'}/${pkg.name}-${pkg.version}`;
    const notices = [];
    for (const file of collected.files) {
      requireValue(Buffer.isBuffer(file.content) && file.bytes === file.content.length && digest(file.content) === file.sha256, 'The notice-file collector returned inconsistent bytes.');
      requireValue(typeof file.path === 'string' && file.path.length <= 2048 && !file.path.includes('\\') && !file.path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..') && !/[\u0000-\u001f\u007f:]/.test(file.path), 'Invalid relative upstream notice path.');
      totalFiles += 1;
      totalBytes += file.bytes;
      requireValue(totalFiles <= 20_000 && totalBytes <= 128 * 1024 * 1024, 'Native notice candidates exceeded their output limit.');
      const path = `${directory}/${file.path}`;
      const destination = resolve(output, path);
      requireValue(inside(output, destination), 'A notice destination escaped the owned output directory.');
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      await writeFile(destination, file.content, { flag: 'wx', mode: 0o600 });
      notices.push({ path, sha256: file.sha256, bytes: file.bytes });
    }
    packages.push({
      key, name: pkg.name, version: pkg.version, source: pkg.source, checksum: pkg.checksum,
      reviewStatus: 'unreviewed', declaredLicense: pkg.license === null ? null : safeText(pkg.license, 8192, 'declared package license'),
      features: pkg.features.map((value) => safeText(value, 256, 'feature')),
      observedRoles: pkg.roles.map((value) => { requireValue(['target', 'host-build'].includes(value), 'Invalid observed package role.'); return value; }),
      observedArtifactKinds: pkg.artifactKinds.map((value) => safeText(value, 64, 'artifact kind')),
      hasBuildScript: pkg.hasBuildScript, notices,
    });
  }
  requireValue(packages.length > 2, 'Expected third-party release compilation candidates.');
  phase = 'source evidence stability';
  const finalRevision = await capture('git.exe', ['rev-parse', '--verify', 'HEAD'], 'source-revision-after', { timeout: 30_000 });
  requireValue((await readFile(finalRevision.stdoutPath, 'utf8')).trim().toLowerCase() === sourceRevision, 'The source revision changed during collection.');
  const finalStatus = await capture('git.exe', ['status', '--porcelain', '--untracked-files=normal'], 'source-status-after', { timeout: 30_000 });
  requireValue((await readFile(finalStatus.stdoutPath, 'utf8')).trim() === '', 'The source checkout changed during collection.');
  const candidate = {
    version: 1, reviewStatus: 'unreviewed', runId,
    scope: {
      target, profile: 'release', installersProduced: false, binariesPublished: false,
      claim: 'Packages observed in Cargo compilation artifacts, classified with locked platform-filtered metadata; exact upstream notice files are candidates for review.',
      roleMeaning: 'Dependency-graph roles and observed custom-build artifacts. This does not identify final linker-retained compilation units or every bundled native component.',
      completeLinkedGraph: false, licenseApproval: false,
    },
    build: {
      tauriCliVersion, rustVersion, cargoVersion, sourceRevision,
      tauriConfigSha256: digest(configurationBefore), frontendInventorySha256,
      command: ['node', 'node_modules/@tauri-apps/cli/tauri.js', ...buildArgs],
      successful: true, lockSha256: digest(lockAfter),
      executable: { name: 'nuvex-desktop.exe', sha256: digest(await readFile(observed.executablePath)), bytes: executableInformation.size },
      freshArtifacts: observed.freshArtifacts, compiledArtifacts: observed.compiledArtifacts,
    },
    summary: { packages: packages.length, noticeFiles: totalFiles, noticeBytes: totalBytes },
    packages,
  };
  phase = 'sanitized candidate output';
  await writeFile(join(output, 'candidate.json'), JSON.stringify(candidate, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(`Collected ${packages.length} unreviewed native package candidates and ${totalFiles} exact upstream notice files. No installers or binaries were published.`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  try { await main(); }
  catch (error) {
    // Only explicitly tagged constant validation errors may disclose detail.
    // Node/JSON/process errors can embed private paths or upstream metadata.
    const approvedCodes = new Set(['NUVEX_BUILD_EVIDENCE_INVALID', 'NUVEX_NOTICE_INVALID', 'NUVEX_NOTICE_COLLECTION_INVALID']);
    const code = approvedCodes.has(error?.code) ? error.code
      : error?.code === 'ENOENT' ? 'NUVEX_NOTICE_INPUT_MISSING'
      : ['EACCES', 'EPERM'].includes(error?.code) ? 'NUVEX_NOTICE_ACCESS_DENIED'
      : 'NUVEX_NOTICE_COLLECTION_FAILED';
    const detail = approvedCodes.has(error?.code) && typeof error.message === 'string' && /^[A-Za-z0-9 ,().'-]{1,240}$/.test(error.message) ? error.message : null;
    const failure = { version: 1, reviewStatus: 'unreviewed', complete: false, runId, phase, error: { code, detail } };
    if (outputProtected) {
      try { await writeFile(join(output, 'candidate-failure.json'), JSON.stringify(failure, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
      catch { /* The safe console diagnostic remains available if disk output fails. */ }
    }
    console.error(`Native notice collection failed during ${phase} (${code}).${detail ? ` ${detail}` : ''} No raw command output was published.`);
    process.exitCode = 1;
  }
}
