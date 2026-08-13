/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawnSync } from 'node:child_process';
import {
  cpSync,
  rmSync,
  mkdirSync,
  existsSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
  chmodSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { globSync } from 'glob';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const distDir = join(root, 'dist');
const bundleDir = join(root, 'bundle');
const stagingDir = join(bundleDir, 'native_modules');
const seaConfigPath = join(root, 'sea-config.json');
const manifestPath = join(bundleDir, 'manifest.json');

// --- Helper Functions ---

/**
 * Safely executes a command using spawnSync.
 * @param {string} command
 * @param {string[]} args
 * @param {object} options
 */
function runCommand(command, args, options = {}) {
  let finalCommand = command;
  let useShell = options.shell || false;

  // On Windows, npm/npx are batch files and need a shell
  if (
    process.platform === 'win32' &&
    (command === 'npm' || command === 'npx')
  ) {
    finalCommand = `${command}.cmd`;
    useShell = true;
  }

  const finalOptions = {
    stdio: 'inherit',
    cwd: root,
    shell: useShell,
    ...options,
  };

  const result = spawnSync(finalCommand, args, finalOptions);

  if (result.status !== 0) {
    if (result.error) {
      throw result.error;
    }
    throw new Error(
      `Command failed with exit code ${result.status}: ${command}`,
    );
  }

  return result;
}

/**
 * Removes existing digital signatures from a binary.
 * @param {string} filePath
 */
function removeSignature(filePath) {
  console.log(`Removing signature from ${filePath}...`);
  const platform = process.platform;
  try {
    if (platform === 'darwin') {
      spawnSync('codesign', ['--remove-signature', filePath], {
        stdio: 'ignore',
      });
    } else if (platform === 'win32') {
      spawnSync('signtool', ['remove', '/s', filePath], {
        stdio: 'ignore',
      });
    }
  } catch {
    // Best effort: Ignore failures
  }
}

console.log('Build Binary Script Started...');

// 1. Clean dist
if (existsSync(distDir)) {
  console.log('Cleaning dist directory...');
  rmSync(distDir, { recursive: true, force: true });
}
mkdirSync(distDir, { recursive: true });

// 2. Build Bundle
console.log('Running npm clean, install, and bundle...');
try {
  // runCommand('npm', ['run', 'clean']);
  // runCommand('npm', ['install']);
  runCommand('npm', ['run', 'bundle']);
} catch (e) {
  console.error('Build step failed:', e.message);
  process.exit(1);
}

// 2b. Copy host-platform ripgrep binary into the bundle for the SEA.
// (npm tarballs omit these to stay under the registry upload limit.)
const ripgrepVendorSrc = join(root, 'packages/core/vendor/ripgrep');
const ripgrepVendorDest = join(bundleDir, 'vendor', 'ripgrep');
if (existsSync(ripgrepVendorSrc)) {
  const rgBinName = `rg-${process.platform}-${process.arch}${
    process.platform === 'win32' ? '.exe' : ''
  }`;
  const rgSrc = join(ripgrepVendorSrc, rgBinName);
  if (existsSync(rgSrc)) {
    mkdirSync(ripgrepVendorDest, { recursive: true });
    cpSync(rgSrc, join(ripgrepVendorDest, rgBinName), { dereference: true });
    console.log(`Copied ${rgBinName} to bundle/vendor/ripgrep/`);
  } else {
    console.warn(
      `Warning: bundled ripgrep binary not found for ${process.platform}/${process.arch} at ${rgSrc}. ` +
        `The SEA will fall back to system grep at runtime.`,
    );
  }
}

// 3. Stage & Sign Native Modules
const includeNativeModules = process.env.BUNDLE_NATIVE_MODULES !== 'false';
console.log(`Include Native Modules: ${includeNativeModules}`);

if (!includeNativeModules) {
  console.log('Skipping native modules bundling (BUNDLE_NATIVE_MODULES=false)');
}

// 4. Generate SEA Configuration and Manifest
console.log('Generating SEA configuration and manifest...');
const packageJson = JSON.parse(
  readFileSync(join(root, 'package.json'), 'utf8'),
);

// Helper to calc hash
const sha256 = (content) => createHash('sha256').update(content).digest('hex');

const assets = {
  'manifest.json': 'bundle/manifest.json',
};

const manifest = {
  main: 'sparkle.mjs',
  mainHash: '',
  version: packageJson.version,
  files: [],
};

// Add all javascript chunks from the bundle directory
const jsFiles = globSync('*.js', { cwd: bundleDir });
for (const jsFile of jsFiles) {
  const fsPath = join(bundleDir, jsFile);
  const content = readFileSync(fsPath);
  const hash = sha256(content);

  // Node SEA requires the main entry point to be explicitly mapped
  if (jsFile === 'sparkle.js') {
    assets['sparkle.mjs'] = fsPath;
    manifest.mainHash = hash;
  } else {
    // Other chunks need to be mapped exactly as they are named so dynamic imports find them
    assets[jsFile] = fsPath;
    manifest.files.push({ key: jsFile, path: jsFile, hash: hash });
  }
}

// Helper to recursively find files from STAGING
function addAssetsFromDir(baseDir, runtimePrefix) {
  const fullDir = join(stagingDir, baseDir);
  if (!existsSync(fullDir)) return;

  const items = globSync('**/*', { cwd: fullDir, nodir: true });
  for (const item of items) {
    const relativePath = join(runtimePrefix, item);
    const assetKey = `files:${relativePath}`;
    const fsPath = join(fullDir, item);

    // Calc hash
    const content = readFileSync(fsPath);
    const hash = sha256(content);

    assets[assetKey] = fsPath;
    manifest.files.push({ key: assetKey, path: relativePath, hash: hash });
  }
}

// Add policy files
const policyDir = join(bundleDir, 'policies');
if (existsSync(policyDir)) {
  const policyFiles = globSync('*.toml', { cwd: policyDir });
  for (const policyFile of policyFiles) {
    const fsPath = join(policyDir, policyFile);
    const relativePath = join('policies', policyFile);
    const content = readFileSync(fsPath);
    const hash = sha256(content);
    // Use a unique key to avoid collision if filenames overlap (though unlikely here)
    // But sea-launch writes to 'path', so key is just for lookup.
    const assetKey = `policies:${policyFile}`;
    assets[assetKey] = fsPath;
    manifest.files.push({ key: assetKey, path: relativePath, hash: hash });
  }
}

// Add ripgrep binary (copied in step 2b). Must be registered here so that
// sea-launch.cjs extracts it to runtimeDir/vendor/ripgrep/ on startup; the
// runtime resolver in packages/core/src/tools/ripGrep.ts uses __dirname-
// relative paths to find it.
if (existsSync(ripgrepVendorDest)) {
  const rgFiles = globSync('*', { cwd: ripgrepVendorDest, nodir: true });
  for (const rgFile of rgFiles) {
    const fsPath = join(ripgrepVendorDest, rgFile);
    const relativePath = join('vendor', 'ripgrep', rgFile);
    const content = readFileSync(fsPath);
    const hash = sha256(content);
    const assetKey = `vendor:${rgFile}`;
    assets[assetKey] = fsPath;
    manifest.files.push({ key: assetKey, path: relativePath, hash: hash });
  }
}

// Add assets from Staging
if (includeNativeModules) {
  addAssetsFromDir('node_modules/@lydell', 'node_modules/@lydell');
  addAssetsFromDir('node_modules/@github', 'node_modules/@github');
}

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

const seaConfig = {
  main: 'sea/sea-launch.cjs',
  output: 'dist/sea-prep.blob',
  disableExperimentalSEAWarning: true,
  assets: assets,
};

writeFileSync(seaConfigPath, JSON.stringify(seaConfig, null, 2));
console.log(`Configured ${Object.keys(assets).length} embedded assets.`);

// 5. Generate SEA Blob
console.log('Generating SEA blob...');
try {
  runCommand('node', ['--experimental-sea-config', 'sea-config.json']);
} catch (e) {
  console.error('Failed to generate SEA blob:', e.message);
  // Cleanup
  if (existsSync(seaConfigPath)) rmSync(seaConfigPath);
  if (existsSync(manifestPath)) rmSync(manifestPath);
  if (existsSync(stagingDir))
    rmSync(stagingDir, { recursive: true, force: true });
  process.exit(1);
}

// Check blob existence
const blobPath = join(distDir, 'sea-prep.blob');
if (!existsSync(blobPath)) {
  console.error('Error: sea-prep.blob not found in dist/');
  process.exit(1);
}

// 6. Identify Target & Prepare Binary
const platform = process.platform;
const arch = process.arch;
const targetName = `${platform}-${arch}`;
console.log(`Targeting: ${targetName}`);

const targetDir = join(distDir, targetName);
mkdirSync(targetDir, { recursive: true });

const nodeBinary = process.execPath;
const binaryName = platform === 'win32' ? 'sparkle.exe' : 'sparkle';
const targetBinaryPath = join(targetDir, binaryName);

console.log(`Copying node binary from ${nodeBinary} to ${targetBinaryPath}...`);
copyFileSync(nodeBinary, targetBinaryPath);

if (platform === 'darwin') {
  console.log(`Thinning universal binary for ${arch}...`);
  try {
    // Attempt to thin the binary. Will fail safely if it's not a fat binary.
    runCommand('lipo', [
      targetBinaryPath,
      '-thin',
      arch,
      '-output',
      targetBinaryPath,
    ]);
  } catch (e) {
    console.log(`Skipping lipo thinning: ${e.message}`);
  }
}

// Remove existing signature using helper
removeSignature(targetBinaryPath);

// Copy standard bundle assets (policies)
console.log('Copying additional resources...');
if (existsSync(bundleDir)) {
  cpSync(bundleDir, targetDir, { recursive: true });
}

// Clean up source JS files from output (we only want embedded)
const filesToRemove = [
  'sparkle.mjs',
  'sparkle.mjs.map',
  'sparkle-sea.cjs',
  'sea-launch.cjs',
  'manifest.json',
  'native_modules',
  'policies',
];

filesToRemove.forEach((f) => {
  const p = join(targetDir, f);
  if (existsSync(p)) rmSync(p, { recursive: true, force: true });
});

// Remove all chunk and entry .js/.js.map files
const jsFilesToRemove = globSync('*.{js,js.map}', { cwd: targetDir });
for (const f of jsFilesToRemove) {
  rmSync(join(targetDir, f));
}

// 7. Inject Blob
console.log('Injecting SEA blob...');
const sentinelFuse = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

try {
  chmodSync(targetBinaryPath, 0o755);
  const args = [
    'postject',
    targetBinaryPath,
    'NODE_SEA_BLOB',
    blobPath,
    '--sentinel-fuse',
    sentinelFuse,
  ];

  if (platform === 'darwin') {
    args.push('--macho-segment-name', 'NODE_SEA');
  }

  runCommand('npx', ['--yes', ...args]);
  console.log('Injection successful.');
} catch (e) {
  console.error('Postject failed:', e.message);
  process.exit(1);
}

// 8. Cleanup
console.log('Cleaning up artifacts...');
rmSync(blobPath);
if (existsSync(seaConfigPath)) rmSync(seaConfigPath);
if (existsSync(manifestPath)) rmSync(manifestPath);
if (existsSync(stagingDir))
  rmSync(stagingDir, { recursive: true, force: true });

console.log(`Binary built successfully in ${targetDir}`);
