import { isIP } from 'node:net';

/** Only explicit browser API origins may extend the production connect policy. */
export function connectOrigins(value = '') {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > 2048) {
    throw new Error('NUVEX_CONNECT_ORIGINS must contain at most 2048 bytes.');
  }
  if (value === '') return [];
  if (/[\x00-\x1f\x7f]/.test(value)) {
    throw new Error('NUVEX_CONNECT_ORIGINS must not contain control characters.');
  }
  const entries = value.split(',');
  if (entries.length > 16) throw new Error('NUVEX_CONNECT_ORIGINS permits at most 16 origins.');
  const sources = new Set();
  for (const entry of entries) {
    const candidate = entry.trim();
    // Validate the unparsed spelling first: URL otherwise normalizes paths,
    // backslashes, credentials, control characters, and empty query markers.
    if (!/^https?:\/\/[a-z0-9.:[\]-]+$/i.test(candidate) || candidate.endsWith(':')) {
      throw new Error('NUVEX_CONNECT_ORIGINS requires exact HTTP(S) origins without paths, credentials, wildcards, or query/fragment markers.');
    }
    let url;
    try { url = new URL(candidate); } catch {
      throw new Error('NUVEX_CONNECT_ORIGINS contains an invalid origin.');
    }
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const validDnsName = hostname.length <= 253 && hostname.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
    if (!isIP(hostname) && !validDnsName) {
      throw new Error('NUVEX_CONNECT_ORIGINS contains an invalid host; use ASCII/punycode DNS names or an IP address.');
    }
    if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '::1'].includes(hostname)) {
      throw new Error('NUVEX_CONNECT_ORIGINS permits HTTP only for localhost, 127.0.0.1, or [::1].');
    }
    sources.add(url.origin);
    sources.add(`${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}`);
  }
  return [...sources];
}
