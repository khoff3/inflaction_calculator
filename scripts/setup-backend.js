#!/usr/bin/env node
/**
 * One-time backend setup: create backend/.venv and install requirements_fastapi.txt.
 * Works on Windows and macOS/Linux — the venv layout differs between them, so we
 * resolve the interpreter path per platform rather than shelling out to `activate`.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

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

// Windows ships `python`; macOS and most Linux distros ship `python3`.
const systemPython = isWindows ? 'python' : 'python3';

if (fs.existsSync(venvPython)) {
  console.log(`Reusing ${venvDir}`);
} else {
  console.log(`Creating ${venvDir}`);
  run(systemPython, ['-m', 'venv', venvDir]);
}

run(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip']);
run(venvPython, ['-m', 'pip', 'install', '-r', path.join(backendDir, 'requirements_fastapi.txt')]);

console.log('\nBackend ready. Start everything with: npm start');
