import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { analyzeNativeBuild, readCargoLock, WINDOWS_TARGET } from './native-build-evidence.mjs';

const REGISTRY = 'registry+https://github.com/rust-lang/crates.io-index';
const checksum = (name) => createHash('sha256').update(name).digest('hex');
function fixture() {
  const workspaceRoot = resolve('synthetic private workspace');
  const rootManifestPath = join(workspaceRoot, 'apps/desktop/src-tauri/Cargo.toml');
  const targetDirectory = join(workspaceRoot, '.cache/evidence-target');
  const pkg = (name, version = '1.0.0', local = false) => ({
    id: `${local ? 'path+file:///private-workspace' : REGISTRY}#${name}@${version}`,
    name, version, source: local ? null : REGISTRY, license: local ? 'Apache-2.0' : 'MIT OR Apache-2.0', license_file: null,
    manifest_path: local ? join(workspaceRoot, `apps/desktop/${name === 'nuvex-desktop' ? 'src-tauri' : 'transport'}/Cargo.toml`)
      : join(workspaceRoot, 'synthetic registry', `${name}-${version}/Cargo.toml`),
  });
  const root = pkg('nuvex-desktop', '0.2.0', true); const transport = pkg('nuvex-transport', '0.2.0', true);
  const tauri = pkg('tauri', '2.12.4'); const helper = pkg('shared-helper'); const macro = pkg('derive-helper'); const dev = pkg('dev-only');
  const entries = [root, transport, tauri, helper, macro, dev];
  const dep = (entry, kind = null) => ({ name: entry.name, pkg: entry.id, dep_kinds: [{ kind, target: null }] });
  const nodes = entries.map((entry) => ({ id: entry.id, deps: [], features: [] }));
  nodes[0].deps = [dep(transport), dep(tauri), dep(macro), dep(helper, 'build'), dep(dev, 'dev')];
  nodes[1].deps = [dep(helper)]; nodes[4].deps = [dep(helper)];
  const metadata = { version: 1, workspace_root: dirname(rootManifestPath), target_directory: targetDirectory,
    workspace_members: [root.id], packages: entries, resolve: { root: root.id, nodes } };
  const artifact = (entry, kind = 'lib', fresh = false) => ({
    reason: 'compiler-artifact', package_id: entry.id, manifest_path: entry.manifest_path,
    target: { kind: [kind], crate_types: [kind === 'custom-build' ? 'bin' : kind], name: entry.name },
    profile: { opt_level: '3', debug_assertions: false, test: false }, fresh,
    features: entry.name === 'tauri' ? ['default', 'custom-protocol'] : [], filenames: [], executable: null,
  });
  const binary = artifact(root, 'bin'); binary.executable = join(targetDirectory, WINDOWS_TARGET, 'release/nuvex-desktop.exe'); binary.filenames = [binary.executable];
  const messages = [artifact(helper, 'lib', true), artifact(macro, 'proc-macro'), artifact(transport), artifact(tauri), artifact(root, 'custom-build'),
    { reason: 'build-script-executed', package_id: root.id, linked_libs: ['static=private_vendor'], linked_paths: ['/private/source'], env: [['PRIVATE', 'do not publish']] }, binary,
    { reason: 'build-finished', success: true }];
  const lock = () => '# Automatically generated\nversion = 4\n\n' + entries.map((entry) => `[[package]]\nname = "${entry.name}"\nversion = "${entry.version}"\n` +
    (entry.source ? `source = "${entry.source}"\nchecksum = "${checksum(entry.name + entry.version)}"\n` : '')).join('\n');
  const input = () => ({ cargoOutput: 'npm frontend prelude\n' + messages.map((item) => JSON.stringify(item)).join('\n'), metadata,
    lockText: lock(), expectedTarget: WINDOWS_TARGET, rootManifestPath, workspaceRoot });
  return { input, metadata, entries, nodes, messages, artifact, binary, root, transport, tauri, helper, macro, dev };
}

test('observed artifacts include fresh dependencies, dual roles, host macros and owned build scripts', () => {
  const f = fixture(); const result = analyzeNativeBuild(f.input());
  assert.equal(result.packages.length, 5); assert.equal(result.freshArtifacts, 1); assert.equal(result.compiledArtifacts, 5);
  assert.equal(result.executablePath, f.binary.executable);
  assert.deepEqual(result.packages.find((entry) => entry.name === 'shared-helper').roles, ['host-build', 'target']);
  assert.deepEqual(result.packages.find((entry) => entry.name === 'derive-helper').roles, ['host-build']);
  assert.deepEqual(result.packages.find((entry) => entry.name === 'nuvex-desktop').roles, ['host-build', 'target']);
  assert.equal(result.packages.find((entry) => entry.name === 'nuvex-desktop').hasBuildScript, true);
  assert.ok(!result.packages.some((entry) => entry.name === 'dev-only'));
  assert.equal(result.buildScripts[0].env[0][1], 'do not publish'); // Explicitly private intermediate representation.
});

test('lock parsing retains exact identities/checksums and rejects ambiguity or unsupported provenance', () => {
  const text = fixture().input().lockText; assert.equal(readCargoLock(text).length, 6);
  assert.throws(() => readCargoLock(text.replace('version = 4', 'version = 3')), /version-4/);
  assert.throws(() => readCargoLock(text.replace('name = "tauri"', 'name = "tauri"\nname = "other"')), /duplicate/);
  assert.throws(() => readCargoLock(text.replace(REGISTRY, 'git+https://secret:credential@example.test/repo')), (error) => /Unreviewed/.test(error.message) && !error.message.includes('credential'));
  assert.throws(() => readCargoLock(text + '\n[[package]]\nname = "tauri"\nversion = "2.12.4"\nsource = "' + REGISTRY + '"\nchecksum = "' + checksum('tauri2.12.4') + '"\n'), /Duplicate locked/);
});

test('missing, failed, duplicated and truncated build streams cannot become release evidence', () => {
  for (const mutate of [
    (f) => f.messages.pop(),
    (f) => { f.messages.at(-1).success = false; },
    (f) => f.messages.push({ reason: 'build-finished', success: true }),
    (f) => f.messages.push(f.artifact(f.helper)),
  ]) {
    const f = fixture(); mutate(f); assert.throws(() => analyzeNativeBuild(f.input()), /complete successful Cargo build stream/);
  }
  const f = fixture(); const input = f.input(); input.cargoOutput += '\n{ malformed';
  assert.throws(() => analyzeNativeBuild(input), /Malformed JSON/);
});

test('test artifacts, unknown packages and mismatched manifest provenance are rejected', () => {
  let f = fixture(); f.messages[0].profile.test = true; assert.throws(() => analyzeNativeBuild(f.input()), /ordinary release/);
  f = fixture(); f.messages[0].package_id = 'unknown'; assert.throws(() => analyzeNativeBuild(f.input()), /unknown or mismatched/);
  f = fixture(); f.messages[0].manifest_path = join(f.input().workspaceRoot, 'other/Cargo.toml'); assert.throws(() => analyzeNativeBuild(f.input()), /unknown or mismatched/);
  f = fixture(); f.messages[0].target.kind = ['test']; assert.throws(() => analyzeNativeBuild(f.input()), /target kind/);
});

test('metadata-only packages stay excluded and missing selected artifacts cannot be hidden', () => {
  let f = fixture(); f.nodes[0].deps = f.nodes[0].deps.filter((edge) => edge.pkg !== f.dev.id);
  assert.ok(!analyzeNativeBuild(f.input()).packages.some((entry) => entry.name === 'dev-only'));
  f = fixture(); f.nodes[0].deps.push({ name: 'dev-only', pkg: f.dev.id, dep_kinds: [{ kind: null, target: null }] });
  assert.throws(() => analyzeNativeBuild(f.input()), /lacks a captured compilation artifact/);
  f = fixture(); f.messages.splice(-1, 0, f.artifact(f.dev)); assert.throws(() => analyzeNativeBuild(f.input()), /outside the selected non-dev/);
});

test('different package versions preserve separate locked identities', () => {
  const f = fixture(); const second = structuredClone(f.helper);
  second.id += '-second'; second.version = '2.0.0'; second.manifest_path = join(dirname(dirname(second.manifest_path)), 'shared-helper-2.0.0/Cargo.toml');
  f.entries.push(second); f.nodes.push({ id: second.id, deps: [], features: [] });
  f.nodes[1].deps.push({ name: second.name, pkg: second.id, dep_kinds: [{ kind: null, target: null }] });
  f.messages.splice(-1, 0, f.artifact(second));
  const versions = analyzeNativeBuild(f.input()).packages.filter((entry) => entry.name === 'shared-helper');
  assert.deepEqual(versions.map((entry) => entry.version), ['1.0.0', '2.0.0']); assert.notEqual(versions[0].checksum, versions[1].checksum);
});

test('root, workspace, target, protocol and release executable must match the actual selection', () => {
  let f = fixture(); let input = f.input(); input.expectedTarget = 'x86_64-unknown-linux-gnu'; assert.throws(() => analyzeNativeBuild(input), /explicit Windows/);
  f = fixture(); f.metadata.workspace_root = f.input().workspaceRoot; assert.throws(() => analyzeNativeBuild(f.input()), /different Cargo workspace/);
  f = fixture(); f.metadata.resolve.root = f.transport.id; assert.throws(() => analyzeNativeBuild(f.input()), /root does not match/);
  f = fixture(); f.binary.profile.debug_assertions = true; assert.throws(() => analyzeNativeBuild(f.input()), /release profile/);
  f = fixture(); f.binary.executable = join(f.input().workspaceRoot, 'wrong/nuvex-desktop.exe'); f.binary.filenames = [f.binary.executable]; assert.throws(() => analyzeNativeBuild(f.input()), /explicit target release/);
  f = fixture(); f.messages.find((entry) => entry.package_id === f.tauri.id).features = []; assert.throws(() => analyzeNativeBuild(f.input()), /custom-protocol/);
});

test('first-party paths and missing license metadata fail closed', () => {
  let f = fixture(); const path = join(f.input().workspaceRoot, 'unexpected/Cargo.toml'); f.transport.manifest_path = path;
  f.messages.find((entry) => entry.package_id === f.transport.id).manifest_path = path;
  assert.throws(() => analyzeNativeBuild(f.input()), /Unreviewed local/);
  f = fixture(); f.helper.license = null; assert.throws(() => analyzeNativeBuild(f.input()), /no declared license/);
  f.helper.license_file = 'LICENSE-CUSTOM'; assert.equal(analyzeNativeBuild(f.input()).packages.find((entry) => entry.name === f.helper.name).license, null);
});
