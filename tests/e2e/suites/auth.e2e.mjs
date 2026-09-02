import { has, ok } from '../lib.mjs';

/**
 * Auth tests. `run` executes FIRST (before any API suite) and installs the
 * freshly-minted token via the CLI itself, together with the server URL that
 * gets persisted into the isolated config file; `runTeardown` executes LAST
 * and verifies logout invalidates the CLI-side token.
 */
export async function run({ h, server, token }) {
  h.test('auth status: not signed in on a fresh profile', () => {
    // The CLI prints "Not signed in" and exits 0.
    const r = h.runOk(['auth', 'status'], 'auth status (fresh)');
    has(r.stdout, 'Not signed in', 'status output');
  });

  h.test('auth token: rejects tokens shorter than 10 chars', () => {
    h.runFails(['auth', 'token', 'short', '--server', server], 'Invalid token', 'auth token (short)');
  });

  h.test('auth token: installs an access token with --server', () => {
    const r = h.runOk(['auth', 'token', token, '--server', server], 'auth token set');
    has(r.stdout, 'Token saved', 'save confirmation');
  });

  h.test('auth status: signed in, shows server and masked token', () => {
    const r = h.runOk(['auth', 'status'], 'auth status');
    has(r.stdout, 'Signed in', 'status output');
    has(r.stdout, `Server: ${server}`, 'server from config');
    has(r.stdout, 'Token: ntk_', 'masked token');
  });

  h.test('auth: server URL from config is honored (round-trip)', () => {
    // No env vars involved: the config file written by `auth token --server`
    // must drive the request target.
    h.runOk(['project', 'list'], 'round-trip via configured server');
  });
}

export async function runTeardown({ h }) {
  h.test('auth logout: clears the stored token', () => {
    h.runOk(['auth', 'logout'], 'auth logout');
    const r = h.runOk(['auth', 'status'], 'auth status (after logout)');
    has(r.stdout, 'Not signed in', 'status output after logout');
  });

  h.test('auth: API call without a token fails cleanly', () => {
    const r = h.runFails(['project', 'list'], null, 'project list after logout');
    has(r.stderr, 'No access token found', 'error message points at auth');
  });
}
