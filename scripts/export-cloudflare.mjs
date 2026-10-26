import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { connectOrigins } from '../infra/connect-origins.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, '.cache', 'cloudflare', 'web');
const extraOrigins = connectOrigins(process.env.NUVEX_CONNECT_ORIGINS ?? '');
if (!process.env.npm_execpath) throw new Error('Ejecuta npm run web:export.');

const built = spawnSync(process.execPath, [process.env.npm_execpath, 'run', 'build'], {
  cwd: root, stdio: 'inherit', env: { ...process.env, VITE_NUVEX_CLIENT_ONLY: process.env.NUVEX_CLIENT_ONLY ?? 'false' }
});
if (built.status !== 0) process.exit(built.status ?? 1);

// Solo se reemplaza la exportación generada en esta ruta fija de la caché.
if (resolve(output) !== join(root, '.cache', 'cloudflare', 'web')) throw new Error('Destino no válido.');
mkdirSync(dirname(output), { recursive: true });
rmSync(output, { recursive: true, force: true });
cpSync(join(root, 'apps', 'web', 'build'), output, { recursive: true });
const html = readFileSync(join(output, 'index.html'), 'utf8');
const hashes = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
  .filter((match) => !/\bsrc\s*=/.test(match[1]) && match[2].trim())
  .map((match) => `'sha256-${createHash('sha256').update(match[2]).digest('base64')}'`);
if (!hashes.length) throw new Error('Falta el arranque del cliente para construir su CSP.');
const csp = [
  "default-src 'self'", `script-src 'self' ${[...new Set(hashes)].join(' ')}`,
  "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "font-src 'self'",
  `connect-src 'self' ${extraOrigins.join(' ')}`.trim(), "media-src 'self' blob:",
  "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'", "form-action 'self'"
].join('; ');
writeFileSync(join(output, '_headers'), `/*\n  Content-Security-Policy: ${csp}\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  X-Frame-Options: DENY\n`);
console.log('Cliente exportado para Cloudflare en .cache/cloudflare/web, con fuentes locales y CSP por hash.');
