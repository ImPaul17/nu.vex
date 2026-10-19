// Registry-source notice candidates, not a license compatibility or SPDX audit.
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, open, opendir, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';

const limits = Object.freeze({ depth: 16, entries: 20_000, files: 512, fileBytes: 2 * 1024 * 1024,
  totalBytes: 16 * 1024 * 1024, checksumBytes: 16 * 1024 * 1024, pathBytes: 1024,
  archiveBytes: 128 * 1024 * 1024, listingBytes: 32 * 1024 * 1024 });
const checksumName = '.cargo-checksum.json';
const digest = (content) => createHash('sha256').update(content).digest('hex');
const hex = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const candidate = /^(?:LICEN[CS]ES?|COPYING|COPYRIGHTS?|NOTICES?|UNLICENSES?)(?:$|[._ -])/i;
const legalDirectory = /^(?:LICEN[CS]ES?|COPYING|NOTICES?)$/i;
const invalidCode = 'NUVEX_NOTICE_INVALID';
function invalid(message) { return Object.assign(new Error(message), { code: invalidCode }); }
function check(value, message) { if (!value) throw invalid(message); }
function isCandidate(path) {
  const parts = path.split('/');
  return candidate.test(parts.at(-1)) || parts.slice(0, -1).some((part) => legalDirectory.test(part));
}
function safePath(value) {
  check(typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= limits.pathBytes
    && !/[\\:\x00-\x1f\x7f<>"|?*\[\]]/.test(value), 'Invalid relative native notice path.');
  const segments = value.split('/');
  check(segments.every((part) => part && part !== '.' && part !== '..' && !/[. ]$/.test(part)
    && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)), 'Invalid relative native notice path.');
  return value;
}
function inside(root, path) {
  const rest = relative(root, path);
  check(rest && rest !== '..' && !rest.startsWith(`..${sep}`) && !isAbsolute(rest), 'A native notice path escapes its package root.');
}
async function ordinaryRoot(packageRoot) {
  check(typeof packageRoot === 'string' && isAbsolute(packageRoot), 'An absolute native package root is required.');
  const root = resolve(packageRoot);
  for (let path = root; ; path = dirname(path)) {
    const info = await lstat(path);
    check(info.isDirectory() && !info.isSymbolicLink(), 'Native package paths must not traverse symbolic links.');
    if (path === dirname(path)) break;
  }
  // realpath expands symbolic links and junctions, and also respells Windows
  // case and 8.3 short components: os.tmpdir() is C:\Users\RUNNER~1\... on
  // hosted Windows images. Those spellings denote the identical directory, so
  // the resolved root is compared by directory identity rather than by text.
  // Every ancestor above was already required to be an ordinary directory, so
  // a different identity can only mean the root changed while it was resolved.
  const canonical = await realpath(root);
  const requested = await lstat(root, { bigint: true });
  const resolved = await lstat(canonical, { bigint: true });
  // Node's Windows lstat reports dev=0 for both spellings; inode identity and
  // timestamps remain comparable there, so the volume check stays POSIX-only.
  check(resolved.isDirectory() && !resolved.isSymbolicLink() && resolved.ino === requested.ino
    && resolved.birthtimeNs === requested.birthtimeNs
    && (process.platform === 'win32' || resolved.dev === requested.dev),
    'The native package root must be canonical.');
  return canonical;
}
async function readBounded(root, path, maximum) {
  const absolute = resolve(root, safePath(path));
  inside(root, absolute);
  const before = await lstat(absolute, { bigint: true });
  check(before.isFile() && !before.isSymbolicLink() && before.nlink === 1n, 'Native notice inputs must be single-link regular files.');
  check(before.size <= BigInt(maximum), 'A native notice input exceeds its byte limit.');
  inside(root, await realpath(absolute));
  const handle = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat({ bigint: true });
    // Node's Windows lstat reports dev=0 while fstat reports the volume serial.
    check(opened.isFile() && opened.nlink === 1n && (process.platform === 'win32' || opened.dev === before.dev) && opened.ino === before.ino
      && opened.size === before.size, 'A native notice input changed while opening.');
    const chunks = [];
    let bytes = 0;
    for (;;) {
      const buffer = Buffer.alloc(Math.min(64 * 1024, maximum - bytes + 1));
      const read = await handle.read(buffer, 0, buffer.length, bytes);
      if (!read.bytesRead) break;
      bytes += read.bytesRead;
      check(bytes <= maximum, 'A native notice input exceeds its byte limit.');
      chunks.push(buffer.subarray(0, read.bytesRead));
    }
    const after = await handle.stat({ bigint: true });
    check(BigInt(bytes) === opened.size && after.size === opened.size && after.mtimeNs === opened.mtimeNs
      && after.ctimeNs === opened.ctimeNs, 'A native notice input changed while reading.');
    return Buffer.concat(chunks, bytes);
  } finally { await handle.close(); }
}
function utf8(content) {
  try { new TextDecoder('utf-8', { fatal: true }).decode(content); }
  catch { throw invalid('A native notice input is not valid UTF-8.'); }
  check(!content.includes(0), 'A native notice input contains binary NUL bytes.');
}
async function tar(archive, args, maximum) {
  return new Promise((yes, no) => {
    const child = spawn('tar', args, { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, TAR_OPTIONS: '', TAR_READER_OPTIONS: '', TAR_WRITER_OPTIONS: '' } });
    const chunks = [];
    let bytes = 0; let stderrBytes = 0; let failure;
    const fail = (message) => { failure ??= invalid(message); child.kill('SIGKILL'); };
    const timeout = setTimeout(() => fail('Native archive inspection timed out.'), 15_000);
    child.on('error', () => { failure ??= invalid('Native archive inspection requires a working existing tar executable.'); });
    child.stdin.on('error', (error) => { if (error.code !== 'EPIPE') fail('Native archive input could not be read.'); });
    child.stdout.on('error', () => fail('Native archive output could not be read.'));
    child.stderr.on('error', () => fail('Native archive diagnostics could not be read.'));
    child.stdout.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > maximum) fail('Native archive output exceeds its byte limit.');
      else chunks.push(chunk);
    });
    child.stderr.on('data', (chunk) => { stderrBytes += chunk.length; if (stderrBytes > 64 * 1024) fail('Native archive diagnostics exceed their byte limit.'); });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (failure) no(failure);
      else if (code !== 0) no(invalid('Native archive inspection failed.'));
      else yes(Buffer.concat(chunks, bytes));
    });
    // Feed the already-verified archive bytes, avoiding a second pathname open by tar.
    child.stdin.end(archive);
  });
}
async function archiveNotices(root, packageArchive, packageChecksum, required) {
  check(typeof packageArchive === 'string' && isAbsolute(packageArchive), 'An absolute native package archive is required.');
  const prefix = basename(root);
  check(/^[a-zA-Z0-9_][a-zA-Z0-9_-]*-\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9_.-]+)*$/.test(prefix), 'Native package archive requires a name-version package root.');
  check(basename(packageArchive) === `${prefix}.crate`, 'Native package archive name does not match its package root.');
  const parent = await ordinaryRoot(dirname(packageArchive));
  const archive = await readBounded(parent, basename(packageArchive), limits.archiveBytes);
  check(digest(archive) === packageChecksum.toLowerCase(), 'Registry archive checksum mismatch.');
  const listing = await tar(archive, ['-tf', '-'], limits.listingBytes);
  utf8(listing);
  const lines = listing.toString('utf8').split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  check(lines.length > 0 && lines.length <= limits.entries, 'Native archive entries exceed their limit.');
  const entries = new Map();
  for (const line of lines) {
    const directory = line.endsWith('/');
    const name = directory ? line.slice(0, -1) : line;
    if (directory && name === prefix) continue;
    check(name.startsWith(`${prefix}/`), 'A native archive entry escapes its name-version prefix.');
    const path = safePath(name.slice(prefix.length + 1));
    check(path.split('/').length <= limits.depth + 1 && !entries.has(path), 'Invalid or duplicate native archive entry.');
    entries.set(path, directory);
  }
  const verbose = await tar(archive, ['-tvf', '-'], limits.listingBytes);
  utf8(verbose);
  const types = verbose.toString('utf8').trimEnd().split(/\r?\n/);
  check(types.length === lines.length && types.every((line) => /^[-d]/.test(line)), 'Native archive links and special entries are forbidden.');
  const paths = new Set(required);
  for (const [path, directory] of entries) if (!directory && isCandidate(path)) paths.add(path);
  check(paths.size <= limits.files, 'Native notice candidates exceed their limit.');
  const contents = new Map();
  let total = 0;
  for (const path of [...paths].sort(compare)) {
    check(entries.has(path) && !entries.get(path), 'A required native notice file is missing from its archive.');
    const content = await tar(archive, ['-xOf', '-', '--', `${prefix}/${path}`], limits.fileBytes);
    total += content.length;
    check(total <= limits.totalBytes, 'Native notice texts exceed their total byte limit.');
    utf8(content);
    contents.set(path, content);
  }
  return contents;
}

/**
 * Collect exact UTF-8 notice candidates from one checksum-verified registry package.
 * requiredFiles and licenseFile add exact relative paths; neither excludes discovery.
 * No contents are normalized, and no license is approved by this function.
 */
export async function collectNoticeFiles({ packageRoot, packageChecksum, packageArchive = null, requiredFiles = [], licenseFile = null } = {}) {
  try {
    check(hex(packageChecksum), 'A registry package SHA-256 checksum is required.');
    check(Array.isArray(requiredFiles) && requiredFiles.length <= limits.files, 'Invalid required native notice files.');
    check(licenseFile === null || typeof licenseFile === 'string', 'Invalid explicit native license file.');
    const required = new Set(requiredFiles.map(safePath));
    if (licenseFile !== null) required.add(safePath(licenseFile));
    check(required.size <= limits.files, 'Too many required native notice files.');
    const root = await ordinaryRoot(packageRoot);
    let raw; let manifest = null;
    try { raw = await readBounded(root, checksumName, limits.checksumBytes); }
    catch (error) { if (error.code !== 'ENOENT' || packageArchive === null) throw error; }
    if (raw) {
      utf8(raw);
      try { manifest = JSON.parse(raw.toString('utf8')); }
      catch { throw invalid('Invalid registry checksum JSON.'); }
      check(manifest && typeof manifest === 'object' && !Array.isArray(manifest) && hex(manifest.package)
        && manifest.package.toLowerCase() === packageChecksum.toLowerCase(), 'Registry package checksum mismatch.');
      check(manifest.files && typeof manifest.files === 'object' && !Array.isArray(manifest.files), 'Invalid registry file checksums.');
      const recorded = Object.entries(manifest.files);
      check(recorded.length <= limits.entries, 'Registry checksum entries exceed their limit.');
      for (const [path, hash] of recorded) { safePath(path); check(hex(hash), 'Invalid registry file checksum.'); }
    }
    const archived = packageArchive === null ? null : await archiveNotices(root, packageArchive, packageChecksum, required);

    const available = new Set();
    const selected = new Set([...required, ...(archived?.keys() ?? [])]);
    let entries = 0;
    async function walk(directory, prefix = '', depth = 0) {
      check(depth <= limits.depth, 'Native package directory depth exceeds its limit.');
      const canonical = await realpath(directory);
      if (prefix) inside(root, canonical);
      const current = await lstat(directory);
      check(current.isDirectory() && !current.isSymbolicLink(), 'Native package paths must not traverse symbolic links.');
      const directoryHandle = await opendir(directory);
      for await (const entry of directoryHandle) {
        check(++entries <= limits.entries, 'Native package entries exceed their limit.');
        const path = safePath(prefix ? `${prefix}/${entry.name}` : entry.name);
        check(!entry.isSymbolicLink(), 'Native package paths must not traverse symbolic links.');
        if (entry.isDirectory()) await walk(resolve(directory, entry.name), path, depth + 1);
        else {
          check(entry.isFile(), 'Native package entries must be ordinary files or directories.');
          available.add(path);
          if (isCandidate(path)) selected.add(path);
          check(selected.size <= limits.files, 'Native notice candidates exceed their limit.');
        }
      }
    }
    await walk(root);
    for (const path of required) check(available.has(path), 'A required native notice file is missing.');
    check(selected.size > 0, 'No native notice text candidates were found.');
    const files = [];
    let total = 0;
    for (const path of [...selected].sort(compare)) {
      if (manifest) check(Object.hasOwn(manifest.files, path), 'A native notice candidate is missing its registry checksum.');
      if (archived) check(archived.has(path), 'A native notice candidate is missing from its verified archive.');
      const content = await readBounded(root, path, limits.fileBytes);
      total += content.length;
      check(total <= limits.totalBytes, 'Native notice texts exceed their total byte limit.');
      utf8(content);
      const sha256 = digest(content);
      if (manifest) check(sha256 === manifest.files[path].toLowerCase(), 'Native notice file checksum mismatch.');
      if (archived) check(content.equals(archived.get(path)), 'Native source notice differs from its verified archive.');
      files.push({ path, sha256, bytes: content.length, content });
    }
    return { files };
  } catch (error) {
    if (error?.code === invalidCode) throw error;
    // Filesystem errors can contain private absolute registry/home paths.
    if (typeof error?.code === 'string') throw invalid(error.code === 'ENOENT'
      ? 'Native notice source could not be read (ENOENT).' : 'Native notice source could not be read.');
    throw error;
  }
}
