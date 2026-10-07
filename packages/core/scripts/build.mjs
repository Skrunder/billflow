// Builds @skr/core twice — ES modules (Vite / web / Android) and CommonJS
// (the Node backend) — plus one set of type declarations.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
const run = (project) => execFileSync(process.execPath, [tsc, '-p', project], { cwd: root, stdio: 'inherit' });

rmSync(path.join(root, 'dist'), { recursive: true, force: true });
run('tsconfig.esm.json');
run('tsconfig.cjs.json');

// Tell Node how to interpret each output folder.
for (const [dir, type] of [['esm', 'module'], ['cjs', 'commonjs']]) {
  mkdirSync(path.join(root, 'dist', dir), { recursive: true });
  writeFileSync(path.join(root, 'dist', dir, 'package.json'), `${JSON.stringify({ type })}\n`);
}
