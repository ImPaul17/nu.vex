import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import test from 'node:test';
import { collectNoticeFiles } from './native-notice-files.mjs';

const hash = (content) => createHash('sha256').update(content).digest('hex');
const checksum = hash('synthetic registry archive');
async function fixture(action) {
  const base = await mkdtemp(join(tmpdir(), 'nuvex-native-notices-'));
  const packageRoot = join(base, 'synthetic-1.2.3');
  await mkdir(packageRoot);
  const files = {};
  const put = async (path, content) => {
    const destination = resolve(packageRoot, path);
    assert.ok(destination.startsWith(packageRoot + sep), 'Test writes must stay in their temporary package');
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, content);
    files[path] = hash(content);
  };
  const manifest = async (overrides = {}) => writeFile(join(packageRoot, '.cargo-checksum.json'), JSON.stringify({ package: checksum, files, ...overrides }));
  const archive = async (members = [basename(packageRoot)]) => {
    const packageArchive = join(base, `${basename(packageRoot)}.crate`);
    const packed = spawnSync('tar', ['-czf', packageArchive, '-C', base, '--', ...members], {
      shell: false, windowsHide: true, timeout: 15_000, maxBuffer: 128 * 1024,
    });
    assert.equal(packed.status, 0, 'The existing tar executable must create the isolated fixture');
    return { packageArchive, packageChecksum: hash(await readFile(packageArchive)) };
  };
  const collect = (options = {}) => collectNoticeFiles({ packageRoot, packageChecksum: checksum, ...options });
  try { await action({ base, packageRoot, files, put, manifest, archive, collect }); }
  finally {
    assert.ok(base.startsWith(resolve(tmpdir()) + sep) && base.split(sep).at(-1).startsWith('nuvex-native-notices-'));
    await rm(base, { recursive: true });
  }
}

test('recursive candidates preserve exact bytes, POSIX paths, and stable sorting', async () => {
  await fixture(async ({ put, manifest, collect, packageRoot }) => {
    const original = Buffer.from('\ufeffCopyright © synthetic\r\n\r\nKeep trailing space. \r\n');
    await put('LICENSE', original);
    await put('LICENSE-other-bits', 'Different terms\n');
    await put('third_party/fiat/LICENSE', 'Nested fiat\n');
    await put('src/polyfill/once_cell/LICENSE-MIT', 'Nested MIT\n');
    await put('src/polyfill/once_cell/LICENSE-APACHE', 'Nested Apache\n');
    await put('docs/LICENCE.txt', 'British spelling\n');
    await put('legal/COPYING.LESSER', 'Additional terms\n');
    await put('legal/COPYRIGHT', 'Copyright holder\n');
    await put('legal/NOTICE.md', 'Required notice\n');
    await put('legal/UNLICENSE', 'Public-domain candidate\n');
    await put('README.md', 'Not a notice candidate\n');
    await manifest();
    const first = await collect();
    const second = await collect();
    assert.deepEqual(first, second);
    assert.equal(first.files.length, 10);
    assert.deepEqual(first.files.map((file) => file.path), [...first.files.map((file) => file.path)].sort());
    assert.deepEqual(first.files[0], { path: 'LICENSE', sha256: hash(original), bytes: original.length, content: original });
    for (const file of first.files) {
      assert.ok(Buffer.isBuffer(file.content));
      assert.ok(!file.path.includes('\\') && !file.path.startsWith('/'));
      assert.deepEqual(file.content, await readFile(resolve(packageRoot, file.path)));
    }
  });
});

test('explicit licenseFile and requiredFiles are additional exact paths, never discovery overrides', async () => {
  await fixture(async ({ put, manifest, collect }) => {
    await put('LICENSE', 'Primary\n');
    await put('legal/terms.txt', 'Custom license-file\n');
    await put('docs/extra.txt', 'Additional reviewed candidate\n');
    await manifest();
    const result = await collect({ licenseFile: 'legal/terms.txt', requiredFiles: ['docs/extra.txt', 'LICENSE', 'docs/extra.txt'] });
    assert.deepEqual(result.files.map((file) => file.path), ['LICENSE', 'docs/extra.txt', 'legal/terms.txt']);
    await assert.rejects(collect({ requiredFiles: ['missing/NOTICE'] }), /required.*missing/);
    await assert.rejects(collect({ licenseFile: 'legal/missing' }), /required.*missing/);
  });
});

test('registry package identity, candidate membership and exact file digests are mandatory', async () => {
  await fixture(async ({ packageRoot, put, manifest, collect, files }) => {
    await put('LICENSE', 'Original\n');
    await manifest();
    await assert.rejects(collect({ packageChecksum: '0'.repeat(64) }), /package checksum mismatch/);
    await writeFile(join(packageRoot, 'LICENSE'), 'Altered\n');
    await assert.rejects(collect(), /file checksum mismatch/);
    await put('LICENSE', 'Restored\n');
    delete files.LICENSE;
    await manifest();
    await assert.rejects(collect(), /missing its registry checksum/);
    await manifest({ package: null });
    await assert.rejects(collect(), /package checksum mismatch/);
  });
});

test('traversal, absolute, Windows alias and unrecorded required paths fail closed', async () => {
  await fixture(async ({ put, manifest, collect, files }) => {
    await put('LICENSE', 'Terms\n');
    await manifest();
    for (const path of ['../LICENSE', '/LICENSE', 'legal/../../LICENSE', 'C:/LICENSE', '\\\\host\\LICENSE',
      'legal\\LICENSE', './LICENSE', 'legal//LICENSE', 'LICENSE:stream', 'LICENSE.', 'legal/NUL.txt', 'LICENSE\0']) {
      await assert.rejects(collect({ requiredFiles: [path] }), /relative native notice path/);
      await assert.rejects(collect({ licenseFile: path }), /relative native notice path/);
    }
    files['../outside/LICENSE'] = checksum;
    await manifest();
    await assert.rejects(collect(), /relative native notice path/);
  });
});

test('file and directory symbolic-link escapes are rejected without reading their target', async () => {
  await fixture(async ({ base, packageRoot, put, manifest, collect }) => {
    await put('LICENSE', 'Inside\n');
    const outside = join(base, 'outside');
    await mkdir(outside);
    await writeFile(join(outside, 'LICENSE'), 'Outside\n');
    await manifest();
    // Windows directory junction creation needs no elevated symlink privilege.
    await symlink(outside, join(packageRoot, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(collect(), /symbolic links/);
    await assert.rejects(collect({ packageRoot: join(packageRoot, 'linked') }), /symbolic links/);
  });
  if (process.platform !== 'win32') {
    await fixture(async ({ base, packageRoot, put, manifest, collect }) => {
      const outside = join(base, 'outside.txt');
      await writeFile(outside, 'Outside\n');
      await put('README.md', 'Synthetic package\n');
      await symlink(outside, join(packageRoot, 'LICENSE'));
      await manifest();
      await assert.rejects(collect(), /symbolic links/);
    });
  }
});

test('alternate ordinary spellings of one root resolve to a single canonical identity', async (t) => {
  await fixture(async ({ packageRoot, put, manifest, collect }) => {
    await put('LICENSE', 'Terms\n');
    await manifest();
    const expected = await collect();
    // Windows CI reaches the temporary directory through an 8.3 short name
    // (C:\Users\RUNNER~1\...) and NTFS/APFS accept any path case, so the same
    // ordinary directory has several valid spellings. None of them may be
    // reported as a non-canonical root or change the collected result.
    const spellings = new Set([await realpath(packageRoot), join(dirname(packageRoot), basename(packageRoot).toUpperCase())]);
    let exercised = 0;
    for (const spelling of spellings) {
      if (spelling === packageRoot) continue;
      try { await realpath(spelling); } catch { continue; }
      assert.deepEqual(await collect({ packageRoot: spelling }), expected);
      exercised += 1;
    }
    if (exercised === 0) t.skip('This host exposes no alternate spelling of the temporary package root.');
  });
});

test('invalid UTF-8 and binary NUL are rejected while valid text remains byte-exact', async () => {
  for (const content of [Buffer.from([0xc3, 0x28]), Buffer.from('Terms\0hidden')]) {
    await fixture(async ({ put, manifest, collect }) => {
      await put('LICENSE', content); await manifest();
      await assert.rejects(collect(), /UTF-8|binary NUL/);
    });
  }
});

test('per-file, aggregate, candidate-count and directory-depth limits fail rather than truncate', async () => {
  await fixture(async ({ put, manifest, collect }) => {
    await put('LICENSE', Buffer.alloc(2 * 1024 * 1024 + 1, 65)); await manifest();
    await assert.rejects(collect(), /byte limit/);
  });
  await fixture(async ({ put, manifest, collect }) => {
    for (let i = 0; i < 9; i++) await put(`LICENSE-${i}`, Buffer.alloc(2 * 1024 * 1024, 65));
    await manifest(); await assert.rejects(collect(), /total byte limit/);
  });
  await fixture(async ({ put, manifest, collect }) => {
    for (let i = 0; i < 513; i++) await put(`NOTICE-${i}`, 'Small\n');
    await manifest(); await assert.rejects(collect(), /candidates exceed/);
  });
  await fixture(async ({ put, manifest, collect }) => {
    await put(`${'nested/'.repeat(17)}LICENSE`, 'Deep\n'); await manifest();
    await assert.rejects(collect(), /depth exceeds/);
  });
});

test('missing/malformed checksum metadata and no candidates do not become successful coverage', async () => {
  await fixture(async ({ packageRoot, put, manifest, collect }) => {
    await put('README.md', 'No license candidate\n');
    await assert.rejects(collect(), (error) => error.message === 'Native notice source could not be read (ENOENT).');
    await writeFile(join(packageRoot, '.cargo-checksum.json'), '{broken');
    await assert.rejects(collect(), /Invalid registry checksum JSON/);
    await manifest();
    await assert.rejects(collect(), /No native notice text candidates/);
  });
});

test('a real checksum-verified crate supplies every recursive candidate and exact custom notice', async () => {
  await fixture(async ({ put, archive, collect }) => {
    const original = Buffer.from('Synthetic terms\r\nCopyright © owner\r\n');
    await put('LICENSE', original);
    await put('LICENSE-BoringSSL', 'Nested terms one\n');
    await put('LICENSE-other-bits', 'Nested terms two\n');
    await put('src/polyfill/once_cell/LICENSE-APACHE', 'Nested terms three\n');
    await put('src/polyfill/once_cell/LICENSE-MIT', 'Nested terms four\n');
    await put('third_party/fiat/LICENSE', 'Nested terms five\n');
    await put('legal/custom.txt', 'Explicit license-file\n');
    const options = await archive();
    const result = await collect({ ...options, licenseFile: 'legal/custom.txt' });
    assert.equal(result.files.length, 7);
    assert.deepEqual(result.files[0].content, original);
    assert.deepEqual(result, await collect({ ...options, requiredFiles: ['legal/custom.txt'] }));
    await put('LICENSE', 'Changed after download\n');
    await assert.rejects(collect({ ...options }), /differs from its verified archive/);
  });
});

test('archive checksum drift, wrong prefix and missing archive candidates fail closed', async () => {
  await fixture(async ({ base, put, archive, collect }) => {
    await put('LICENSE', 'Exact archived terms\n');
    const options = await archive();
    await assert.rejects(collect({ ...options, packageChecksum: '0'.repeat(64) }), /archive checksum mismatch/);
    await assert.rejects(collect({ ...options, requiredFiles: ['legal/missing'] }), /missing from its archive/);
    await put('NOTICE', 'An unverified local addition\n');
    await assert.rejects(collect({ ...options }), /missing from its verified archive/);
    await mkdir(join(base, 'other-1.2.3'));
    await writeFile(join(base, 'other-1.2.3', 'LICENSE'), 'Wrong prefix\n');
    const wrong = await archive(['other-1.2.3']);
    await assert.rejects(collect(wrong), /escapes its name-version prefix/);
  });
});

test('tar output is bounded and archive provenance never overrides invalid checksum metadata', async () => {
  await fixture(async ({ put, archive, collect }) => {
    await put('LICENSE', Buffer.alloc(2 * 1024 * 1024 + 1, 65));
    const options = await archive();
    await assert.rejects(collect(options), /archive output exceeds its byte limit/);
  });
  await fixture(async ({ put, archive, manifest, collect }) => {
    await put('LICENSE', 'Valid archived terms\n');
    const options = await archive();
    await manifest({ package: '0'.repeat(64) });
    await assert.rejects(collect(options), /package checksum mismatch/);
  });
});

test('source/archive directory link escapes are refused before any notice can be retained', async () => {
  await fixture(async ({ base, packageRoot, put, archive, collect }) => {
    await put('LICENSE', 'Inside\n');
    const outside = join(base, 'external');
    await mkdir(outside); await writeFile(join(outside, 'NOTICE'), 'External\n');
    await symlink(outside, join(packageRoot, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    const options = await archive();
    // bsdtar can encode Windows junctions as ordinary directories; the source
    // boundary must still reject those. POSIX symbolic links are rejected in tar.
    await assert.rejects(collect(options), /archive links and special entries|symbolic links/);
  });
});

test('ambient TAR_OPTIONS cannot change archive inspection', async () => {
  await fixture(async ({ put, archive, collect }) => {
    await put('LICENSE', 'Original\n');
    const options = await archive();
    const previous = process.env.TAR_OPTIONS;
    try {
      process.env.TAR_OPTIONS = '--invalid-option-must-not-be-inherited';
      assert.equal((await collect(options)).files.length, 1);
    } finally {
      if (previous === undefined) delete process.env.TAR_OPTIONS;
      else process.env.TAR_OPTIONS = previous;
    }
  });
});

test('exact legal directories retain all text in archive and source without matching license-tests', async () => {
  for (const mode of ['checksum', 'archive']) {
    await fixture(async ({ put, manifest, archive, collect }) => {
      const original = Buffer.from('\ufeffCopyright © Unicode terms\r\nKeep exact bytes. \r\n');
      await put('LICENSES/Unicode-3.0.txt', original);
      await put('LICENSES/BSD-3-Clause.txt', 'BSD terms\n');
      await put('third_party/licences/ISC.txt', 'ISC terms\n');
      await put('third_party/LICENSE/terms.txt', 'Single-directory spelling\n');
      await put('COPYING/third-party.txt', 'Copying terms\n');
      await put('NOTICES/acknowledgements.txt', 'Acknowledgements\n');
      await put('license-tests/helpers.rs', 'Source, not a notice candidate\n');
      await put('notice-tests/helpers.rs', 'More source\n');
      await put('LICENSES-backup/helpers.rs', 'Unreviewed backup directory\n');
      const options = mode === 'archive' ? await archive() : (await manifest(), {});
      const { files } = await collect(options);
      assert.deepEqual(files.map((file) => file.path), [
        'COPYING/third-party.txt', 'LICENSES/BSD-3-Clause.txt', 'LICENSES/Unicode-3.0.txt',
        'NOTICES/acknowledgements.txt', 'third_party/LICENSE/terms.txt', 'third_party/licences/ISC.txt',
      ]);
      assert.deepEqual(files.find((file) => file.path === 'LICENSES/Unicode-3.0.txt').content, original);
    });
  }
});

test('public validation diagnostics have a constant code and never expose source paths or raw inputs', async () => {
  await fixture(async ({ packageRoot, base, put, collect }) => {
    const safe = (message) => (error) => {
      assert.equal(error.code, 'NUVEX_NOTICE_INVALID');
      assert.equal(error.message, message);
      assert.ok(/^[\x20-\x7e]{1,240}$/.test(error.message));
      assert.ok(!error.message.includes(packageRoot) && !error.message.includes(base));
      return true;
    };
    await assert.rejects(collect({ packageChecksum: 'private-untrusted-value' }), safe('A registry package SHA-256 checksum is required.'));
    await assert.rejects(collect(), safe('Native notice source could not be read (ENOENT).'));
    await writeFile(join(packageRoot, '.cargo-checksum.json'), '{private malformed data');
    await assert.rejects(collect(), safe('Invalid registry checksum JSON.'));
    await put('LICENSE', Buffer.from([0xc3, 0x28]));
    await writeFile(join(packageRoot, '.cargo-checksum.json'), JSON.stringify({ package: checksum, files: { LICENSE: hash(Buffer.from([0xc3, 0x28])) } }));
    await assert.rejects(collect(), safe('A native notice input is not valid UTF-8.'));
  });
});
