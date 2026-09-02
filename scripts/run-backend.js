#!/usr/bin/env node
/**
 * Cross-platform launcher for the enhanced FastAPI backend.
 *
 * The old npm script ran `source venv/bin/activate`, which is a POSIX-only
 * shell builtin and pointed at a venv that isn't in the repo — so it failed on
 * Windows and macOS alike. This finds a Python that can actually import the
 * backend's dependencies, on either OS, and runs the server with it.
 *
 * Resolution order:
 *   1. $BACKEND_PYTHON, if set
 *   2. backend/.venv, then backend/venv  (bin/python on POSIX, Scripts/python.exe on Windows)
 *   3. python3, then python, from PATH
 */

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const isWindows = process.platform === 'win32';
const backendDir = path.join(__dirname, '..', 'backend');

function venvPython(venvDir) {
  return isWindows
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python');
}

function candidates() {
  const found = [];
  if (process.env.BACKEND_PYTHON) found.push(process.env.BACKEND_PYTHON);
  for (const name of ['.venv', 'venv']) {
    const python = venvPython(path.join(backendDir, name));
    if (fs.existsSync(python)) found.push(python);
  }
  // Windows ships `python`; macOS and most Linux distros ship `python3`.
  found.push(isWindows ? 'python' : 'python3', isWindows ? 'py' : 'python');
  return found;
}

/** A Python is only usable if it can import what the server needs. */
function canRunBackend(python) {
  const probe = spawnSync(python, ['-c', 'import fastapi, uvicorn, pandas, sklearn, fuzzywuzzy'], {
    stdio: 'ignore',
  });
  return probe.status === 0;
}

const tried = [];
let python = null;
for (const candidate of candidates()) {
  tried.push(candidate);
  if (canRunBackend(candidate)) {
    python = candidate;
    break;
  }
}

if (!python) {
  console.error('\nCould not find a Python with the backend dependencies installed.');
  console.error('Tried: ' + tried.join(', '));
  console.error('\nRun `npm run setup:backend` once to create backend/.venv and install them,');
  console.error('or set BACKEND_PYTHON to a Python that already has them.\n');
  process.exit(1);
}

console.log(`Starting backend with ${python}`);
const server = spawn(python, ['start_enhanced_backend.py'], {
  cwd: backendDir,
  stdio: 'inherit',
  env: process.env,
});
server.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => server.kill(sig));
}
