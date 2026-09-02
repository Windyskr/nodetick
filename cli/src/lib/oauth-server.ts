import { createServer } from 'node:http';

const PORT = 8765;
const TIMEOUT_MS = 3 * 60 * 1000;
const LOOPBACK_HOST = '127.0.0.1';

export const OAUTH_REDIRECT_URI = `http://${LOOPBACK_HOST}:${PORT}/callback`;

export interface CallbackServer {
  promise: Promise<void>;
  cleanup: () => void;
}

/**
 * Minimal loopback OAuth callback receiver: waits for the browser redirect,
 * validates state, then hands the authorization code to `exchangeCode`.
 */
export function startCallbackServer(
  expectedState: string,
  exchangeCode: (code: string) => Promise<void>,
): CallbackServer {
  let server: ReturnType<typeof createServer> | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let processing = false;

  const cleanup = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    if (server) {
      server.close();
      server = null;
    }
  };

  const promise = new Promise<void>((resolve, reject) => {
    const fail = (res: import('node:http').ServerResponse, error: Error) => {
      cleanup();
      reject(error);
      try {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end(`NodeTick CLI sign-in failed: ${error.message}`);
      } catch {
        /* response may already be closed */
      }
    };

    const handleRequest = async (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => {
      const url = new URL(req.url || '/', OAUTH_REDIRECT_URI);
      if (url.pathname !== '/callback') {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');
      if (error) {
        fail(res, new Error(`OAuth error: ${error}`));
        return;
      }
      if (!code || !state) {
        fail(res, new Error('Missing code or state parameter'));
        return;
      }
      if (state !== expectedState) {
        fail(res, new Error('Invalid state parameter'));
        return;
      }
      if (processing) {
        res.writeHead(409);
        res.end('OAuth callback is already being processed');
        return;
      }
      processing = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      try {
        await exchangeCode(code);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h1>✓ NodeTick CLI signed in</h1><p>You can close this tab.</p>');
        cleanup();
        resolve();
      } catch (cause) {
        fail(res, cause instanceof Error ? cause : new Error(String(cause)));
      }
    };

    server = createServer(handleRequest);
    server.on('error', (err) => {
      cleanup();
      reject(err);
    });
    // The callback carries a one-time authorization code. Keep the listener
    // on loopback so other machines cannot reach it on a shared network.
    server.listen(PORT, LOOPBACK_HOST, () => {
      timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error('OAuth callback timed out'));
      }, TIMEOUT_MS);
    });
  });

  return { promise, cleanup };
}
