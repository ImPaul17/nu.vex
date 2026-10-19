// Synthetic loopback PKI only. No system trust changes are made by this script.
// openssl ca -startdate/-enddate creates genuinely expired certificates without
// changing the host clock: https://docs.openssl.org/3.0/man1/openssl-ca/
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { X509Certificate, createHash, randomUUID } from 'node:crypto';
import { access, appendFile, lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

process.umask(0o077);
const action = process.argv[2] ?? 'prepare';
assert.equal(action, 'prepare', 'Only the prepare action is supported.');
assert.ok(['linux', 'win32'].includes(process.platform), 'TLS fixtures support Linux and Windows.');
const temporary = process.env.RUNNER_TEMP;
assert.ok(temporary && isAbsolute(temporary), 'Provide an absolute disposable RUNNER_TEMP directory.');
assert.notEqual(resolve(temporary), parse(resolve(temporary)).root, 'RUNNER_TEMP cannot be a filesystem root.');
const root = join(resolve(temporary), 'nuvex-tls');
for (let path = dirname(root); ; path = dirname(path)) {
  const stat = await lstat(path);
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), 'TLS fixture ancestors must be ordinary directories.');
  if (path === dirname(path)) break;
}
await mkdir(root, { mode: 0o700 }); // Never reuse or replace an earlier fixture.

function run(binary, args, cwd = root, expectedSuccess = true) {
  const result = spawnSync(binary, args, {
    cwd, shell: false, windowsHide: true, encoding: 'utf8', timeout: 30_000,
    maxBuffer: 128 * 1024, env: { ...process.env, MSYS_NO_PATHCONV: '1' },
  });
  if (result.error || (expectedSuccess ? result.status !== 0 : result.status === 0)) {
    throw new Error('A synthetic certificate command failed its expected outcome. No private command output was printed.');
  }
  return result.stdout.trim();
}

if (process.platform === 'win32') {
  run('pwsh.exe', ['-NoProfile', '-NonInteractive', '-File', fileURLToPath(new URL('./windows-tls-trust.ps1', import.meta.url)), '-Action', 'Protect']);
}

let openssl = process.env.NUVEX_OPENSSL_BIN ?? 'openssl';
let probe = spawnSync(openssl, ['version'], { shell: false, windowsHide: true, encoding: 'utf8', timeout: 10_000 });
if (probe.error?.code === 'ENOENT' && !process.env.NUVEX_OPENSSL_BIN && process.platform === 'win32') {
  // Git for Windows is preinstalled on the hosted runner; do not install tools.
  openssl = join(process.env.ProgramFiles ?? 'C:/Program Files', 'Git/usr/bin/openssl.exe');
  await access(openssl);
  probe = spawnSync(openssl, ['version'], { shell: false, windowsHide: true, encoding: 'utf8', timeout: 10_000 });
}
assert.ok(!probe.error && probe.status === 0 && /^OpenSSL 3\./.test(probe.stdout), 'An existing OpenSSL 3 executable is required.');
const opensslVersion = probe.stdout.trim();
console.log(`Synthetic certificate tool: ${opensslVersion}`);

const fixtureId = randomUUID();
const utc = (date) => date.toISOString().replace(/[-:]/g, '').replace('T', '').slice(0, 14) + 'Z';
const now = Date.now();
async function authority(folderName) {
  const directory = join(root, folderName);
  await mkdir(directory, { mode: 0o700 });
  await mkdir(join(directory, 'issued'), { mode: 0o700 });
  const cert = join(directory, 'cert.pem');
  const key = join(directory, 'key.pem');
  await writeFile(join(directory, 'index.txt'), '', { mode: 0o600 });
  await writeFile(join(directory, 'serial'), '1000\n', { mode: 0o600 });
  await writeFile(join(directory, 'ca.cnf'), `[ca]\ndefault_ca = local_ca\n[local_ca]\ndatabase = index.txt\nserial = serial\nnew_certs_dir = issued\ncertificate = cert.pem\nprivate_key = key.pem\ndefault_md = sha256\npolicy = policy\nunique_subject = no\n[policy]\ncommonName = supplied\n`, { mode: 0o600 });
  run(openssl, ['req', '-new', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '3',
    '-subj', `/CN=nu.vex synthetic ${folderName} ${fixtureId}`, '-keyout', key, '-out', cert,
    '-addext', 'basicConstraints=critical,CA:TRUE,pathlen:0',
    '-addext', 'keyUsage=critical,keyCertSign,cRLSign', '-addext', 'subjectKeyIdentifier=hash']);
  const x509 = new X509Certificate(await readFile(cert));
  assert.ok(x509.ca && x509.verify(x509.publicKey), 'Expected a self-signed synthetic CA.');
  return { cert, key, sha256: createHash('sha256').update(x509.raw).digest('hex'), thumbprint: x509.fingerprint.replaceAll(':', '') };
}

const ca = await authority('ca');
const foreignCa = await authority('foreign-ca');
async function leaf(name, issuer, { expired = false, wrongSan = false } = {}) {
  const directory = join(root, name);
  await mkdir(directory, { mode: 0o700 });
  const cert = join(directory, 'cert.pem');
  const key = join(directory, 'key.pem');
  const csr = join(directory, 'request.pem');
  const extensions = join(directory, 'extensions.cnf');
  const san = wrongSan ? 'DNS:wrong.invalid' : 'DNS:localhost,IP:127.0.0.1';
  await writeFile(extensions, `[server]\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=${san}\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\n`, { mode: 0o600 });
  run(openssl, ['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-subj', `/CN=nu.vex synthetic ${name}`, '-keyout', key, '-out', csr]);
  const start = utc(new Date(now - (expired ? 3 * 86_400_000 : 300_000)));
  const end = utc(new Date(now + (expired ? -2 * 86_400_000 : 86_400_000)));
  run(openssl, ['ca', '-batch', '-notext', '-config', 'ca.cnf', '-extensions', 'server', '-extfile', extensions,
    '-startdate', start, '-enddate', end, '-in', csr, '-out', cert], dirname(issuer.cert));
  const x509 = new X509Certificate(await readFile(cert));
  assert.ok(!x509.ca && x509.verify(new X509Certificate(await readFile(issuer.cert)).publicKey), 'Expected a correctly signed leaf.');
  assert.equal(Boolean(x509.checkHost('localhost')), !wrongSan, 'Unexpected DNS SAN.');
  assert.equal(Boolean(x509.checkIP('127.0.0.1')), !wrongSan, 'Unexpected IP SAN.');
  assert.equal(Date.parse(x509.validTo) < Date.now(), expired, 'Unexpected certificate validity period.');
  return { cert, key };
}

const valid = await leaf('valid', ca);
const expired = await leaf('expired', ca, { expired: true });
const wrongSan = await leaf('wrong-san', ca, { wrongSan: true });
const untrusted = await leaf('untrusted', foreignCa);
run(openssl, ['verify', '-CAfile', ca.cert, '-verify_hostname', 'localhost', valid.cert]);
run(openssl, ['verify', '-CAfile', ca.cert, '-verify_ip', '127.0.0.1', valid.cert]);
for (const candidate of [expired, wrongSan, untrusted]) {
  run(openssl, ['verify', '-CAfile', ca.cert, '-verify_hostname', 'localhost', candidate.cert], root, false);
}

const fixture = { version: 1, root, fixtureId, opensslVersion, ca, foreignCa, valid, expired, wrongSan, untrusted };
const manifest = join(root, 'fixture.json');
await writeFile(manifest, JSON.stringify(fixture, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
process.env.NUVEX_TLS_CERTIFICATES = manifest;
if (process.env.GITHUB_ENV) await appendFile(process.env.GITHUB_ENV, `NUVEX_TLS_CERTIFICATES=${manifest}\n`);
console.log('PASS synthetic certificates: valid DNS/IP, expired, wrong SAN, and foreign CA verified.');
