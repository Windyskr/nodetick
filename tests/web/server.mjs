// Starts NodeTick the way production serves it (the built SPA as static
// assets in front of the worker) on an empty, throwaway D1 database.
// Playwright runs this as its webServer; pnpm test:web builds the SPA first.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const port = Number(process.env.E2E_PORT ?? 8798);
const dir = mkdtempSync(join(tmpdir(), 'nodetick-web-e2e-'));
const child = spawn(
  'pnpm',
  ['--filter', 'worker', 'exec', 'wrangler', 'dev', '--port', String(port), '--inspector-port', String(port + 1000), '--persist-to', dir, '--log-level', 'warn'],
  { stdio: 'inherit', detached: false },
);

let stopping = false;
const stop = (code = 0) => {
  if (stopping) return;
  stopping = true;
  child.kill('SIGTERM');
  setTimeout(() => {
    rmSync(dir, { recursive: true, force: true });
    process.exit(code);
  }, 500);
};
process.on('SIGTERM', () => stop());
process.on('SIGINT', () => stop());
child.on('exit', (code) => stop(code ?? 0));
