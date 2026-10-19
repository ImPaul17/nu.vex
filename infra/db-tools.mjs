import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
export const archiveFormat = 'nuvex-postgres-custom-v1';

export function docker(args, options = {}) {
  const result = spawnSync('docker', ['compose', ...args], {
    cwd: repositoryRoot,
    stdio: 'inherit',
    shell: false,
    ...options,
  });
  if (result.error) throw new Error(`Docker CLI could not run: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`docker compose ${args[0]} failed (exit ${result.status ?? 'unknown'}).`);
  return result;
}

export function captureDocker(args) {
  return docker(args, { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', maxBuffer: 128 * 1024 }).stdout.trim();
}

export function validateDatabaseName(name) {
  if (typeof name !== 'string' || !/^[a-z][a-z0-9_]{0,62}$/.test(name) || ['postgres', 'template0', 'template1'].includes(name)) {
    throw new Error('Database name must start with a lowercase letter, contain only lowercase letters/digits/underscores, and have at most 63 characters; system databases are forbidden.');
  }
  return name;
}

export function validateRestoreDatabase(name, sourceName) {
  validateDatabaseName(name);
  if (name === sourceName) throw new Error('Restore requires a NEW database name, different from the backed-up or currently configured database.');
  return name;
}

export async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

export async function readAndVerifyArchive(path) {
  const metadataPath = `${path}.json`;
  if (statSync(metadataPath).size > 64 * 1024) throw new Error('Backup metadata exceeds the size limit.');
  const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
  if (!metadata || metadata.format !== archiveFormat || !/^[0-9a-f]{64}$/.test(metadata.sha256)) {
    throw new Error('Backup metadata has an unsupported format or digest.');
  }
  validateDatabaseName(metadata.database);
  if (!statSync(path).isFile() || metadata.size !== statSync(path).size) throw new Error('Archive size does not match its metadata.');
  if (await sha256(path) !== metadata.sha256) throw new Error('Archive SHA-256 does not match its metadata.');
  return metadata;
}
