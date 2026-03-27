import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

function candidateNames() {
  return process.platform === 'win32'
    ? ['cargo.exe', 'cargo.cmd', 'cargo']
    : ['cargo'];
}

function pathCandidates() {
  const candidates = [];
  const seen = new Set();
  const pathEntries = (process.env.PATH ?? '')
    .split(path.delimiter)
    .filter(Boolean);
  const cargoHome = process.env.CARGO_HOME ?? path.join(os.homedir(), '.cargo');
  pathEntries.push(path.join(cargoHome, 'bin'));

  for (const entry of pathEntries) {
    for (const name of candidateNames()) {
      const candidate = path.join(entry, name);
      if (seen.has(candidate)) {
        continue;
      }
      seen.add(candidate);
      candidates.push(candidate);
    }
  }

  return candidates;
}

const executable = pathCandidates().find((candidate) => existsSync(candidate));

if (!executable) {
  console.error(
    'Unable to find cargo. Install Rust from https://rustup.rs or add cargo to PATH.'
  );
  process.exit(1);
}

const result = spawnSync(executable, process.argv.slice(2), {
  stdio: 'inherit',
  env: {
    ...process.env,
    PATH: `${path.dirname(executable)}${path.delimiter}${process.env.PATH ?? ''}`
  }
});

if (result.error) {
  console.error(result.error.message);
}

process.exit(result.status ?? 1);
