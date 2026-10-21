import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyNativeNotices } from './native-notices.mjs';

export async function verifyExtractedNotices({ searchRoot, expected }) {
  const expectedBytes = await readFile(join(expected, 'inventory.json'));
  const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
  const expectedHash = digest(expectedBytes);
  const matches = [];
  let visited = 0;
  async function visit(directory, depth = 0) {
    if (depth > 30 || ++visited > 30000) throw new Error('installer tree exceeds verification bounds');
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path, depth + 1);
      else if (entry.isFile() && entry.name === 'inventory.json' &&
        digest(await readFile(path)) === expectedHash) matches.push(directory);
    }
  }
  await visit(resolve(searchRoot));
  if (matches.length !== 1) throw new Error(`expected one exact packaged notice inventory, found ${matches.length}`);
  const verified = await verifyNativeNotices(matches[0]);
  return { target: verified.target, files: verified.files, inventorySha256: expectedHash };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = new Map();
  for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
  if (!args.get('--search-root') || !args.get('--expected')) throw new Error('--search-root and --expected are required');
  const result = await verifyExtractedNotices({ searchRoot: args.get('--search-root'), expected: args.get('--expected') });
  console.log(`Verified ${result.files} exact packaged notice files for ${result.target}; inventory ${result.inventorySha256}`);
}
