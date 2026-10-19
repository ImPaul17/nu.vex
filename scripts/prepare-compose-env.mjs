import { randomBytes, randomUUID } from 'node:crypto';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { delimiter, dirname, resolve } from 'node:path';
import { repositoryRoot } from '../infra/db-tools.mjs';

process.umask(0o077);
const explicitPath = process.argv[2];
if (!explicitPath && !process.env.RUNNER_TEMP) throw new Error('Pass a disposable environment-file path or run inside the CI runner.');
const runId = randomUUID();
const path = resolve(explicitPath ?? `${process.env.RUNNER_TEMP}/nuvex-compose-${runId}.env`);
const project = `nuvex-ci-${runId}`;
const postgresPassword = randomBytes(32).toString('hex');
const appPassword = randomBytes(32).toString('hex');
await mkdir(dirname(path), { recursive: true, mode: 0o700 });
await writeFile(path, [
  `POSTGRES_PASSWORD=${postgresPassword}`,
  `NUVEX_DATABASE_PASSWORD=${appPassword}`,
  'NUVEX_DATABASE_NAME=nuvex',
  'NUVEX_ALLOWED_ORIGIN=http://127.0.0.1:8080',
  'NUVEX_INSECURE_DEV=true',
  'NUVEX_REGISTRATION_OPEN=true',
  'NUVEX_WEB_BIND=127.0.0.1',
  'NUVEX_WEB_PORT=8080',
  '',
].join('\n'), { flag: 'wx', mode: 0o600 });
if (process.env.GITHUB_ACTIONS === 'true') {
  // GitHub consumes these workflow commands and masks the values before displaying logs.
  console.log(`::add-mask::${postgresPassword}`);
  console.log(`::add-mask::${appPassword}`);
}
if (process.env.GITHUB_ENV) {
  // This disposable override exposes the same Nginx on a second loopback port
  // to verify real cross-origin bearer/WS connections under the built CSP.
  // The production Compose file and its default connection policy stay closed.
  const override = resolve(dirname(path), `nuvex-compose-${runId}.override.yaml`);
  await writeFile(override, [
    'services:',
    '  web:',
    '    build:',
    '      args:',
    '        NUVEX_CONNECT_ORIGINS: http://127.0.0.1:8081',
    '    ports:',
    '      - "127.0.0.1:8081:8080"',
    '',
  ].join('\n'), { flag: 'wx', mode: 0o600 });
  await appendFile(process.env.GITHUB_ENV, [
    `COMPOSE_ENV_FILES=${path}`,
    `COMPOSE_PROJECT_NAME=${project}`,
    `COMPOSE_FILE=${[resolve(repositoryRoot, 'compose.yaml'), override].join(delimiter)}`,
    'NUVEX_E2E_BASE_URL=http://127.0.0.1:8080',
    'NUVEX_E2E_REMOTE_URL=http://127.0.0.1:8081',
    '',
  ].join('\n'));
}
console.log(`Disposable Compose project prepared: ${project}`);
console.log(`Environment file: ${path}`);
