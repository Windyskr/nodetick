import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const CLI_DIST = path.join(REPO_ROOT, 'cli', 'dist', 'index.js');

export class AssertionError extends Error {}

export function ok(cond, msg) {
  if (!cond) throw new AssertionError(msg);
}

export function eq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new AssertionError(`${msg}\n  expected: ${b}\n  actual:   ${a}`);
}

export function has(str, sub, msg) {
  if (!String(str).includes(sub)) {
    throw new AssertionError(`${msg}\n  expected to contain: ${sub}\n  actual: ${String(str).slice(0, 300)}`);
  }
}

/** Compile the CLI so the suite always tests the current source. */
export function buildCli() {
  console.log('[setup] building the nodetick CLI ...');
  const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (!fs.existsSync(npmCli)) {
    throw new Error(`npm-cli.js not found next to ${process.execPath}; run manually: npm run build -w cli`);
  }
  const r = spawnSync(process.execPath, [npmCli, 'run', 'build', '-w', 'cli'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });
  if (r.status !== 0) throw new Error('failed to build the nodetick CLI');
  if (!fs.existsSync(CLI_DIST)) throw new Error(`CLI build output missing: ${CLI_DIST}`);
  console.log(`[setup] CLI ready: ${CLI_DIST}`);
}

/**
 * Test harness. Every CLI invocation runs with an isolated HOME and with the
 * NODETICK_SERVER / NODETICK_TOKEN env vars stripped, so auth goes through
 * the real config-file path (~/.config/nodetick/config.json) that the
 * `auth token --server` flow exercises.
 */
export class Harness {
  constructor(server) {
    this.server = server.replace(/\/+$/, '');
    this.results = [];
    this.pfx = `e2e-${Date.now().toString(36)}`;
    this.home = fs.mkdtempSync(path.join(tmpdir(), 'nodetick-e2e-'));
    fs.mkdirSync(path.join(this.home, '.config', 'nodetick'), { recursive: true });
  }

  /** Run the nodetick CLI with an isolated HOME. */
  run(args) {
    const env = { ...process.env, USERPROFILE: this.home, HOME: this.home };
    delete env.NODETICK_SERVER;
    delete env.NODETICK_TOKEN;
    const r = spawnSync(process.execPath, [CLI_DIST, ...args.map(String)], {
      encoding: 'utf8',
      env,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  }

  /** Run expecting failure; assert the error text mentions `fragment`. */
  runFails(args, fragment, label) {
    const r = this.run(args);
    ok(r.status !== 0, `${label}: expected non-zero exit, got ${r.status}\nstdout: ${r.stdout.slice(0, 300)}`);
    if (fragment) {
      has(r.stderr + r.stdout, fragment, `${label}: error output`);
    }
    return r;
  }

  /** Run expecting success (exit 0). */
  runOk(args, label) {
    const r = this.run(args);
    ok(r.status === 0, `${label}: expected exit 0, got ${r.status}\nstderr: ${r.stderr.slice(0, 300)}`);
    return r;
  }

  /** Run with --json and return the parsed payload. */
  j(args, label) {
    const r = this.runOk([...args, '--json'], label);
    try {
      return JSON.parse(r.stdout);
    } catch (cause) {
      throw new AssertionError(`${label}: --json output is not valid JSON: ${cause.message}\nstdout: ${r.stdout.slice(0, 300)}`);
    }
  }

  /** Register one test case; the fn runs immediately (suites are sequential). */
  test(name, fn) {
    try {
      const r = fn();
      if (r instanceof Promise) {
        throw new AssertionError('async test fns are not supported; keep E2E steps synchronous');
      }
      this.results.push({ name, ok: true });
      process.stdout.write(`  \x1b[32m✓\x1b[0m ${name}\n`);
    } catch (err) {
      this.results.push({ name, ok: false, error: err });
      process.stdout.write(`  \x1b[31m✗ ${name}\x1b[0m\n    ${String(err.message).split('\n').join('\n    ')}\n`);
    }
  }

  report() {
    const passed = this.results.filter((r) => r.ok).length;
    const failed = this.results.length - passed;
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Total: ${this.results.length}  Passed: ${passed}  Failed: ${failed}`);
    console.log('='.repeat(60));
    return failed;
  }

  cleanup() {
    fs.rmSync(this.home, { recursive: true, force: true });
  }
}

// --- HTTP helpers for setup/teardown (registration, tokens, web-UI data) ---

async function postJson(server, pathname, body, cookie) {
  const res = await fetch(`${server}${pathname}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  return res;
}

export async function httpLogin(server, email, password) {
  const res = await postJson(server, '/api/login', { email, password });
  if (res.status !== 200) {
    throw new Error(`login ${email} failed (${res.status})`);
  }
  return res.headers.get('set-cookie').split(';')[0];
}

/** Mint an API token via /api/tokens; returns { id, token }. */
export async function httpMintToken(server, cookie, name) {
  const res = await postJson(server, '/api/tokens', { name }, cookie);
  if (res.status !== 200) throw new Error(`token mint failed (${res.status})`);
  const { token } = await res.json();
  if (!/^ntk_[0-9a-f]{64}$/.test(token)) throw new Error(`unexpected token shape: ${token}`);
  const list = await (await fetch(`${server}/api/tokens`, { headers: { Cookie: cookie } })).json();
  const row = list.find((t) => t.name === name);
  if (!row) throw new Error('minted token not found in /api/tokens listing');
  return { id: row.id, token };
}

export async function httpRevokeToken(server, cookie, tokenId) {
  const res = await postJson(server, `/api/tokens/${tokenId}/revoke`, {}, cookie);
  if (res.status !== 200) throw new Error(`token revoke failed (${res.status})`);
}

/** Create a countdown through the web session (cross-check with the CLI). */
export async function httpCreateCountdown(server, cookie, name, date) {
  const res = await postJson(server, '/open/v1/countdown', { name, date }, cookie);
  if (res.status !== 200) throw new Error(`countdown create failed (${res.status})`);
}
