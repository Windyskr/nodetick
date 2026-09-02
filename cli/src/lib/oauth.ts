import { createHash, randomBytes } from 'node:crypto';
import { OAUTH_REDIRECT_URI } from './oauth-server.js';
import { getServerUrl } from './config.js';

export const OAUTH_SCOPES = 'tasks:read tasks:write';
/** Public client id understood by the NodeTick server's OAuth endpoints. */
export const CLIENT_ID = 'nodetick-cli';

export interface PkceChallenge {
  codeVerifier: string;
  codeChallenge: string;
}

export function generatePkceChallenge(): PkceChallenge {
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge };
}

export async function buildAuthorizationUrl(state: string, codeChallenge: string): Promise<string> {
  const server = await getServerUrl();
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    scope: OAUTH_SCOPES,
    state,
    redirect_uri: OAUTH_REDIRECT_URI,
    response_type: 'code',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${server}/oauth/authorize?${params.toString()}`;
}

export async function exchangeCodeForToken(code: string, codeVerifier: string): Promise<string> {
  const server = await getServerUrl();
  const body = new URLSearchParams({
    code,
    client_id: CLIENT_ID,
    code_verifier: codeVerifier,
    grant_type: 'authorization_code',
    scope: OAUTH_SCOPES,
    redirect_uri: OAUTH_REDIRECT_URI,
  });
  const response = await fetch(`${server}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token exchange failed: ${response.status} ${text}`);
  }
  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error('Token exchange returned no access_token');
  }
  return data.access_token;
}
