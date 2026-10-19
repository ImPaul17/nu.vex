// Private build analysis. Callers must construct an explicit public schema;
// Cargo IDs, manifest paths and build-script output can contain private paths.
import { dirname, isAbsolute, normalize, relative, resolve, sep } from 'node:path';

export const WINDOWS_TARGET = 'x86_64-pc-windows-msvc';
const REGISTRY = 'registry+https://github.com/rust-lang/crates.io-index';
const NAME = /^[A-Za-z0-9_-]{1,128}$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/;
const HASH = /^[a-f0-9]{64}$/;
const KIND = new Set(['lib', 'rlib', 'dylib', 'cdylib', 'staticlib', 'bin', 'proc-macro', 'custom-build']);
const ensure = (value, message) => {
  if (!value) {
    const error = new Error(message);
    error.code = 'NUVEX_BUILD_EVIDENCE_INVALID'; // All messages here are constant, never input values.
    throw error;
  }
};
const sorted = (values) => [...new Set(values)].sort();
const canonical = (value) => process.platform === 'win32' ? normalize(value).toLowerCase() : normalize(value);
const samePath = (a, b) => typeof a === 'string' && typeof b === 'string' && canonical(resolve(a)) === canonical(resolve(b));

function boundedString(value, maximum, message) {
  ensure(typeof value === 'string' && value.length > 0 && value.length <= maximum && !/[\x00-\x1f\x7f]/.test(value), message);
  return value;
}

// Cargo-generated lockfile v4 has simple quoted identity fields. Accept only
// that subset rather than silently interpreting arbitrary TOML or new sources.
export function readCargoLock(text) {
  ensure(typeof text === 'string' && Buffer.byteLength(text) <= 4 * 1024 * 1024, 'Cargo lockfile exceeds the supported bound.');
  const sections = text.replaceAll('\r\n', '\n').split(/^\[\[package\]\]\s*$/m);
  ensure(sections.length > 1 && /^version = 4\s*$/m.test(sections[0]), 'Expected a Cargo-generated version-4 lockfile.');
  ensure(!/^\s*\[/.test(sections[0].replace(/^#.*$/gm, '').trim()), 'Unexpected lockfile header.');
  const identities = new Set();
  return sections.slice(1).map((section) => {
    ensure(!/^\s*\[/m.test(section), 'Unsupported extra lockfile table.');
    function field(key, required) {
      const matches = [...section.matchAll(new RegExp(`^${key} = ("[^"\\\\\\r\\n]*")\\s*$`, 'gm'))];
      const declarations = [...section.matchAll(new RegExp(`^${key}\\s*=`, 'gm'))];
      ensure(matches.length === declarations.length && matches.length <= 1 && (!required || matches.length === 1), 'Missing, duplicate or noncanonical lockfile identity field.');
      return matches.length ? JSON.parse(matches[0][1]) : null;
    }
    const name = field('name', true); const version = field('version', true);
    const source = field('source', false); const checksum = field('checksum', false);
    ensure(NAME.test(name) && VERSION.test(version), 'Unsupported lockfile package identity.');
    ensure(source === null || source === REGISTRY, 'Unreviewed Cargo package source.');
    ensure(source ? HASH.test(checksum ?? '') : checksum === null, 'Expected a locked registry checksum.');
    const key = `${source ?? 'local'}|${name}|${version}`;
    ensure(!identities.has(key), 'Duplicate locked package identity.'); identities.add(key);
    return { name, version, source, checksum };
  });
}

function readMessages(text) {
  ensure(typeof text === 'string' && Buffer.byteLength(text) <= 64 * 1024 * 1024, 'Cargo build output exceeds the supported bound.');
  const messages = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('{')) continue; // npm, Vite and procedural-macro output is not Cargo JSON.
    let value;
    try { value = JSON.parse(line); } catch { ensure(false, 'Malformed JSON line in captured Cargo output.'); }
    if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.reason !== 'string') continue;
    ensure(['compiler-artifact', 'compiler-message', 'build-script-executed', 'build-finished'].includes(value.reason), 'Unknown Cargo build message kind.');
    messages.push(value);
  }
  const finished = messages.filter((item) => item.reason === 'build-finished');
  ensure(finished.length === 1 && finished[0].success === true && messages.at(-1) === finished[0], 'Expected one complete successful Cargo build stream.');
  return messages;
}

export function analyzeNativeBuild({ cargoOutput, metadata, lockText, expectedTarget, rootManifestPath, workspaceRoot }) {
  ensure(expectedTarget === WINDOWS_TARGET, 'This native distribution milestone requires the explicit Windows MSVC target.');
  ensure(typeof rootManifestPath === 'string' && typeof workspaceRoot === 'string' && isAbsolute(rootManifestPath) && isAbsolute(workspaceRoot), 'Explicit absolute build roots are required.');
  ensure(samePath(rootManifestPath, resolve(workspaceRoot, 'apps/desktop/src-tauri/Cargo.toml')), 'Unexpected desktop manifest.');
  ensure(metadata?.version === 1 && Array.isArray(metadata.packages) && metadata.packages.length <= 2000 && metadata.resolve && Array.isArray(metadata.resolve.nodes), 'Incomplete Cargo metadata format.');
  ensure(samePath(metadata.workspace_root, dirname(rootManifestPath)), 'Metadata describes a different Cargo workspace.');
  const lock = new Map(readCargoLock(lockText).map((entry) => [`${entry.source ?? 'local'}|${entry.name}|${entry.version}`, entry]));
  const packages = new Map(); const nodes = new Map();
  for (const entry of metadata.packages) {
    boundedString(entry.id, 8192, 'Invalid Cargo metadata package ID.');
    ensure(!packages.has(entry.id), 'Duplicate metadata package ID.'); packages.set(entry.id, entry);
  }
  for (const entry of metadata.resolve.nodes) {
    ensure(packages.has(entry.id) && !nodes.has(entry.id) && Array.isArray(entry.deps), 'Incomplete or duplicate Cargo resolve node.');
    nodes.set(entry.id, entry);
  }
  const rootId = metadata.resolve.root; const root = packages.get(rootId);
  ensure(root?.name === 'nuvex-desktop' && samePath(root.manifest_path, rootManifestPath) && metadata.workspace_members?.includes(rootId), 'Cargo metadata root does not match the desktop application.');
  const messages = readMessages(cargoOutput);
  const artifacts = messages.filter((item) => item.reason === 'compiler-artifact');
  const buildScripts = messages.filter((item) => item.reason === 'build-script-executed');
  ensure(artifacts.length > 0 && artifacts.length <= 20_000 && buildScripts.length <= 2000, 'Missing or excessive Cargo artifact evidence.');
  const observed = new Set(); const byPackage = new Map(); const macroPackages = new Set();
  for (const artifact of artifacts) {
    const entry = packages.get(artifact.package_id);
    ensure(entry && samePath(entry.manifest_path, artifact.manifest_path), 'An artifact has unknown or mismatched package provenance.');
    ensure(artifact.profile?.test === false && typeof artifact.fresh === 'boolean', 'Expected ordinary release compilation, including fresh artifacts.');
    ensure(Array.isArray(artifact.target?.kind) && artifact.target.kind.length > 0 && artifact.target.kind.every((kind) => KIND.has(kind)), 'Unexpected release artifact target kind.');
    ensure(Array.isArray(artifact.features) && artifact.features.length <= 1000 && artifact.features.every((feature) => typeof feature === 'string' && /^[A-Za-z0-9_+./:-]{1,256}$/.test(feature)), 'Invalid observed artifact feature.');
    if (artifact.target.kind.includes('proc-macro')) macroPackages.add(entry.id);
    observed.add(entry.id);
    if (!byPackage.has(entry.id)) byPackage.set(entry.id, []);
    byPackage.get(entry.id).push(artifact);
  }
  for (const script of buildScripts) {
    ensure(packages.has(script.package_id), 'A build script has unknown package provenance.'); observed.add(script.package_id);
  }

  // Metadata is filtered to the explicit target. Normal edges preserve target
  // roles; build edges and proc-macro closures belong to the build host. A
  // package may serve both roles. Dev-only edges never establish release use.
  const roles = new Map(); const queue = [[rootId, 'target']];
  for (let index = 0; index < queue.length; index++) {
    const [id, proposedRole] = queue[index]; const role = macroPackages.has(id) ? 'host-build' : proposedRole;
    ensure(nodes.has(id), 'A selected dependency has no resolve node.');
    if (!roles.has(id)) roles.set(id, new Set());
    if (roles.get(id).has(role)) continue;
    roles.get(id).add(role);
    for (const dependency of nodes.get(id).deps) {
      ensure(nodes.has(dependency.pkg) && Array.isArray(dependency.dep_kinds) && dependency.dep_kinds.length > 0, 'Incomplete dependency edge metadata.');
      for (const kind of dependency.dep_kinds) {
        ensure([null, 'build', 'dev'].includes(kind.kind), 'Unknown dependency edge kind.');
        if (kind.kind !== 'dev') queue.push([dependency.pkg, kind.kind === 'build' ? 'host-build' : role]);
      }
    }
    ensure(queue.length <= 100_000, 'Cargo dependency traversal exceeds the supported bound.');
  }
  for (const id of observed) ensure(roles.has(id), 'A compiled package is outside the selected non-dev dependency graph.');
  // cargo metadata's resolve graph also lists optional dependencies that this
  // build never activated (for example tauri's disabled `tray-icon` edge), so it
  // over-approximates the compiled set. Captured artifacts stay authoritative:
  // the difference is excluded from the inventory and counted for the record.
  const metadataOnly = [...roles.keys()].filter((id) => !observed.has(id));
  // A package's own build.rs is a host compilation, without turning its normal
  // target dependencies into build-script dependencies.
  for (const artifact of artifacts) {
    if (artifact.target.kind.includes('custom-build')) roles.get(artifact.package_id).add('host-build');
  }

  const binaries = artifacts.filter((entry) => entry.package_id === rootId && entry.target.kind.length === 1 && entry.target.kind[0] === 'bin' && entry.target.name === 'nuvex-desktop');
  ensure(binaries.length === 1, 'Expected exactly one desktop executable artifact.');
  const binary = binaries[0]; const executablePath = binary.executable;
  ensure(typeof executablePath === 'string' && isAbsolute(executablePath) && Array.isArray(binary.filenames) && binary.filenames.some((file) => samePath(file, executablePath)), 'The executable is absent from its Cargo artifact.');
  ensure(binary.profile.debug_assertions === false && binary.profile.opt_level === '3', 'The application artifact does not use the expected release profile.');
  ensure(typeof metadata.target_directory === 'string' && isAbsolute(metadata.target_directory), 'Expected the explicit Cargo target directory.');
  const targetDirectory = resolve(metadata.target_directory);
  const outputPath = relative(resolve(targetDirectory, expectedTarget, 'release'), resolve(executablePath));
  ensure(outputPath === 'nuvex-desktop.exe' && !outputPath.includes(sep), 'The executable is outside the explicit target release directory.');

  const localManifests = new Map([
    ['nuvex-desktop', rootManifestPath],
    ['nuvex-transport', resolve(workspaceRoot, 'apps/desktop/transport/Cargo.toml')],
  ]);
  const selected = [...observed].map((id) => {
    const entry = packages.get(id);
    ensure(NAME.test(entry.name) && VERSION.test(entry.version), 'Invalid selected package identity.');
    const source = entry.source ?? null;
    ensure(source === null || source === REGISTRY, 'A compiled package uses an unreviewed source.');
    const locked = lock.get(`${source ?? 'local'}|${entry.name}|${entry.version}`);
    ensure(locked, 'Compiled package identity is absent from the lockfile.');
    ensure(isAbsolute(entry.manifest_path), 'Expected an absolute selected package manifest.');
    if (source === null) ensure(samePath(entry.manifest_path, localManifests.get(entry.name)) && entry.license === 'Apache-2.0', 'Unreviewed local package provenance or license.');
    const license = entry.license ?? null; const licenseFile = entry.license_file ?? null;
    if (license !== null) boundedString(license, 8192, 'Invalid declared package license.');
    if (licenseFile !== null) boundedString(licenseFile, 4096, 'Invalid declared package license file.');
    ensure(license || licenseFile, 'Selected package has no declared license information.');
    const ownArtifacts = byPackage.get(id) ?? [];
    return {
      id, name: entry.name, version: entry.version, source, checksum: locked.checksum,
      license, licenseFile, packageRoot: dirname(entry.manifest_path),
      features: sorted(ownArtifacts.flatMap((item) => item.features)), roles: sorted(roles.get(id)),
      artifactKinds: sorted(ownArtifacts.flatMap((item) => item.target.kind)),
      hasBuildScript: buildScripts.some((item) => item.package_id === id),
    };
  }).sort((a, b) => a.name.localeCompare(b.name, 'en') || a.version.localeCompare(b.version, 'en'));
  ensure(selected.some((entry) => entry.name === 'tauri' && entry.features.includes('custom-protocol')), 'The captured build is missing Tauri custom-protocol.');
  return {
    target: expectedTarget, rootId, executablePath, packages: selected, buildScripts,
    metadataOnlyPackages: metadataOnly.length,
    freshArtifacts: artifacts.filter((entry) => entry.fresh).length,
    compiledArtifacts: artifacts.filter((entry) => !entry.fresh).length,
  };
}
