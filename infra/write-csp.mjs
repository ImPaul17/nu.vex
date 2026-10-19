import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { connectOrigins } from './connect-origins.mjs';

const [, , input, output] = process.argv;
if (!input || !output) throw new Error('Usage: node infra/write-csp.mjs <built index.html> <output.conf>');
const connections = connectOrigins(process.env.NUVEX_CONNECT_ORIGINS ?? '');
const html = readFileSync(input, 'utf8');
const hashes = new Set();
for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
  if (!/\bsrc\s*=/i.test(match[1])) {
    hashes.add(`'sha256-${createHash('sha256').update(match[2], 'utf8').digest('base64')}'`);
  }
}
if (hashes.size === 0) throw new Error('No inline SvelteKit bootstrap found; review the build and CSP generator.');
const policy = [
  "default-src 'self'",
  `script-src 'self' ${[...hashes].join(' ')}`,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: blob:",
  `connect-src 'self'${connections.length ? ` ${connections.join(' ')}` : ''}`,
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');
writeFileSync(output, `# Generated from the built SvelteKit bootstrap; rebuild after HTML changes.\nadd_header Content-Security-Policy "${policy}" always;\n`, { flag: 'wx' });
