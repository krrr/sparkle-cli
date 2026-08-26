/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import fs from 'node:fs';
import path from 'node:path';

// --- Configuration ---
const cliPackageDir = path.resolve('packages', 'cli'); // Base directory for the CLI package
const buildTimestampPath = path.join(cliPackageDir, 'dist', '.last_build'); // Path to the timestamp file within the CLI package
const sourceDirs = [path.join(cliPackageDir, 'src')]; // Source directory within the CLI package
const filesToWatch = [
  path.join(cliPackageDir, 'package.json'),
  path.join(cliPackageDir, 'tsconfig.json'),
]; // Specific files within the CLI package
const buildDir = path.join(cliPackageDir, 'dist'); // Build output directory within the CLI package
// ---------------------

function getMtime(filePath) {
  try {
    return fs.statSync(filePath).mtimeMs; // Use mtimeMs for higher precision
  } catch (err) {
    if (err.code === 'ENOENT') {
      return null; // File doesn't exist
    }
    console.error(`Error getting stats for ${filePath}:`, err);
    process.exit(1); // Exit on unexpected errors getting stats
  }
}

function findSourceFiles(dir, allFiles = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    // Simple check to avoid recursing into node_modules or build dir itself
    if (
      entry.isDirectory() &&
      entry.name !== 'node_modules' &&
      fullPath !== buildDir
    ) {
      findSourceFiles(fullPath, allFiles);
    } else if (entry.isFile()) {
      allFiles.push(fullPath);
    }
  }
  return allFiles;
}

console.log('Checking build status...');

const buildMtime = getMtime(buildTimestampPath);
if (!buildMtime) {
  // If build is missing, warn and exit(0) so the app can still start
  console.error(
    `ERROR: Build timestamp file (${path.relative(process.cwd(), buildTimestampPath)}) not found. Run \`npm run build\` first.`,
  );
  process.exit(0); // Allow app to start
}

let newerSourceFileFound = false;
const allSourceFiles = [];

// Collect files from specified directories
sourceDirs.forEach((dir) => {
  const dirPath = path.resolve(dir);
  if (fs.existsSync(dirPath)) {
    findSourceFiles(dirPath, allSourceFiles);
  } else {
    console.warn(`Warning: Source directory "${dir}" not found.`);
  }
});

// Add specific files
filesToWatch.forEach((file) => {
  const filePath = path.resolve(file);
  if (fs.existsSync(filePath)) {
    allSourceFiles.push(filePath);
  } else {
    console.warn(`Warning: Watched file "${file}" not found.`);
  }
});

// Check modification times
for (const file of allSourceFiles) {
  const sourceMtime = getMtime(file);
  const relativePath = path.relative(process.cwd(), file);
  const isNewer = sourceMtime && sourceMtime > buildMtime;

  if (isNewer) {
    console.warn(
      `Warning: Source file "${relativePath}" has been modified since the last build.`,
    );
    newerSourceFileFound = true;
    // break; // Uncomment to stop checking after the first newer file
  }
}

if (newerSourceFileFound) {
  console.warn('\nRun "npm run build" to incorporate changes before starting.');
} else {
  console.log('Build is up-to-date.');
}

process.exit(0); // Always exit successfully so the app starts
