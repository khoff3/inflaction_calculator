#!/usr/bin/env node
/**
 * One-time backend setup: create backend/.venv and install requirements_fastapi.txt.
 * Works on Windows and macOS/Linux — the venv layout differs between them, so we
 * resolve the interpreter path per platform rather than shelling out to `activate`.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const MINIMUM = [3, 11];

const isWindows = process.platform === 'win32';
const backendDir = path.join(__dirname, '..', 'backend');
const venvDir = path.join(backendDir, '.venv');
const venvPython = isWindows
  ? path.join(venvDir, 'Scripts', 'python.exe')
  : path.join(venvDir, 'bin', 'python');

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`\nFailed: ${command} ${args.join(' ')}`);
    process.exit(result.status ?? 1);
  }
}

/** Version of an interpreter as [major, minor], or null if it won't run. */
function versionOf(command) {
  const probe = spawnSync(command, ['-c', 'import sys;print(sys.version_info[0],sys.version_info[1])'],
                          { encoding: 'utf8' });
  if (probe.status !== 0 || !probe.stdout) return null;
  const [major, minor] = probe.stdout.trim().split(/\s+/).map(Number);
  return Number.isInteger(major) ? [major, minor] : null;
}

function atLeast(version, floor) {
  return version[0] > floor[0] || (version[0] === floor[0] && version[1] >= floor[1]);
}

/**
 * Pick an interpreter new enough for the pinned dependencies.
 *
 * macOS ships 3.9 as `python3` and Homebrew's versioned formulas install
 * alongside it as `python3.11` rather than replacing it, so the bare name is
 * usually the wrong one on a Mac. Prefer explicit versions, newest first.
 */
function findSystemPython() {
  const candidates = [];
  if (process.env.BACKEND_PYTHON) candidates.push(process.env.BACKEND_PYTHON);
  for (const minor of [13, 12, 11]) {
    candidates.push(isWindows ? `python3.${minor}` : `python3.${minor}`);
  }
  candidates.push(isWindows ? 'python' : 'python3');

  const rejected = [];
  for (const candidate of candidates) {
    const version = versionOf(candidate);
    if (!version) continue;
    if (atLeast(version, MINIMUM)) return { command: candidate, version };
    rejected.push(`${candidate} (${version.join('.')})`);
  }

  console.error(`\nNo Python >= ${MINIMUM.join('.')} found.`);
  if (rejected.length) console.error(`Too old: ${rejected.join(', ')}`);
  console.error('\nInstall one, e.g.  brew install python@3.11');
  console.error('or point BACKEND_PYTHON at an interpreter you already have.\n');
  process.exit(1);
}

if (fs.existsSync(venvPython)) {
  console.log(`Reusing ${venvDir}`);
} else {
  const { command, version } = findSystemPython();
  console.log(`Creating ${venvDir} with ${command} (Python ${version.join('.')})`);
  run(command, ['-m', 'venv', venvDir]);
}

run(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip']);
run(venvPython, ['-m', 'pip', 'install', '-r', path.join(backendDir, 'requirements_fastapi.txt')]);

console.log('\nBackend ready. Start everything with: npm start');
