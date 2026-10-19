import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { archiveFormat, captureDocker, docker, repositoryRoot, sha256, validateDatabaseName } from './db-tools.mjs';

process.umask(0o077);
const timestamp = new Date().toISOString().replaceAll(':', '-');
const archive = resolve(process.argv[2] || join(repositoryRoot, 'backups', `nuvex-${timestamp}.dump`));
let archiveCreated = false;

try {
  if (existsSync(archive) || existsSync(`${archive}.json`)) throw new Error('Output archive or metadata already exists; nothing will be overwritten.');
  const database = validateDatabaseName(captureDocker(['exec', '-T', 'database', 'printenv', 'NUVEX_DATABASE_NAME']));
  const pgDumpVersion = captureDocker(['exec', '-T', 'database', 'pg_dump', '--version']);
  mkdirSync(dirname(archive), { recursive: true, mode: 0o700 });
  const output = openSync(archive, 'wx', 0o600);
  archiveCreated = true;
  try {
    docker(['exec', '-T', 'database', 'sh', '-c', 'exec pg_dump --username="$POSTGRES_USER" --dbname="$NUVEX_DATABASE_NAME" --format=custom --no-owner --no-privileges'], {
      stdio: ['ignore', output, 'inherit'],
    });
  } finally {
    closeSync(output);
  }
  const metadata = {
    format: archiveFormat,
    createdAt: new Date().toISOString(),
    appVersion: JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8')).version,
    database,
    pgDumpVersion,
    size: statSync(archive).size,
    sha256: await sha256(archive),
  };
  writeFileSync(`${archive}.json`, `${JSON.stringify(metadata, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  console.log(`Backup created: ${archive}\nMetadata: ${archive}.json\nStore both securely; a restore drill is still required.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  if (archiveCreated) console.error(`An incomplete archive may remain at ${archive}; do not use it without valid matching metadata.`);
  process.exitCode = 1;
}
