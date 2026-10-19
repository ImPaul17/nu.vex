import { closeSync, openSync } from 'node:fs';
import { resolve } from 'node:path';
import { captureDocker, docker, readAndVerifyArchive, validateRestoreDatabase } from './db-tools.mjs';

let createdDatabase;
try {
  if (process.argv.length !== 4) throw new Error('Usage: node infra/restore-db.mjs <archive.dump> <NEW_database_name>');
  const archive = resolve(process.argv[2]);
  const metadata = await readAndVerifyArchive(archive);
  const database = validateRestoreDatabase(process.argv[3], metadata.database);
  const configuredDatabase = captureDocker(['exec', '-T', 'database', 'printenv', 'NUVEX_DATABASE_NAME']);
  validateRestoreDatabase(database, configuredDatabase);

  // Check archive readability before creating anything. File descriptors preserve
  // binary data on PowerShell, cmd, and POSIX shells without shell redirection.
  let input = openSync(archive, 'r');
  try {
    docker(['exec', '-T', 'database', 'pg_restore', '--list'], { stdio: [input, 'ignore', 'inherit'] });
  } finally {
    closeSync(input);
  }

  // createdb refuses an existing target. Never drop, clean, or overwrite a DB.
  docker(['exec', '-T', 'database', 'createdb', '--username=postgres', '--owner=nuvex', '--template=template0', '--', database]);
  createdDatabase = database;
  docker(['exec', '-T', 'database', 'psql', '--username=postgres', '--dbname=postgres', '--set=ON_ERROR_STOP=1', '--command', `REVOKE ALL ON DATABASE "${database}" FROM PUBLIC;`]);
  input = openSync(archive, 'r');
  try {
    docker(['exec', '-T', 'database', 'pg_restore', '--username=postgres', '--role=nuvex', `--dbname=${database}`, '--no-owner', '--no-privileges', '--single-transaction', '--exit-on-error'], {
      stdio: [input, 'inherit', 'inherit'],
    });
  } finally {
    closeSync(input);
  }
  console.log(`Restored into new database ${database}. The active application database was not changed. Verify data and permissions before an explicit maintenance cutover.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  if (createdDatabase) console.error(`New database ${createdDatabase} has been retained for diagnosis; the existing application database was not overwritten.`);
  process.exitCode = 1;
}
