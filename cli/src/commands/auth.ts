import { randomBytes } from 'node:crypto';
import chalk from 'chalk';
import open from 'open';
import { updateConfig } from '../lib/config.js';
import { clearAccessToken, getAccessToken, saveAccessToken } from '../lib/auth.js';
import { startCallbackServer } from '../lib/oauth-server.js';
import {
  buildAuthorizationUrl,
  exchangeCodeForToken,
  generatePkceChallenge,
} from '../lib/oauth.js';

export function normalizeServerUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(trimmed)) {
    throw new Error('Server URL must start with http:// or https://');
  }
  return trimmed;
}

async function loginWithOAuth(options: { server?: string }) {
  if (options.server) {
    await updateConfig({ server_url: normalizeServerUrl(options.server) });
  }
  const state = randomBytes(16).toString('hex');
  const { codeVerifier, codeChallenge } = generatePkceChallenge();
  const authUrl = await buildAuthorizationUrl(state, codeChallenge);
  console.log('Opening browser for NodeTick sign-in...');
  console.log(chalk.dim(`If the browser does not open, visit: ${authUrl}`));
  const { promise: callbackPromise, cleanup } = startCallbackServer(state, async (code) => {
    console.log(chalk.dim('Exchanging authorization code for token...'));
    const accessToken = await exchangeCodeForToken(code, codeVerifier);
    await saveAccessToken(accessToken);
  });
  try {
    await open(authUrl);
    console.log(chalk.dim('Waiting for you to authorize in the browser...'));
    await callbackPromise;
    console.log(chalk.green('✓'), 'Signed in successfully');
  } catch (error) {
    cleanup();
    throw error;
  }
}

async function showStatus() {
  const config = await (await import('../lib/config.js')).readConfig();
  const server = process.env.NODETICK_SERVER ?? config.server_url;
  try {
    const token = await getAccessToken();
    console.log(chalk.green('✓'), 'Signed in');
    if (server) console.log(`  Server: ${server}`);
    console.log(`  Token: ${token.slice(0, 8)}...${token.slice(-4)}`);
  } catch {
    console.log(chalk.yellow('Not signed in'));
    if (server) console.log(`  Server: ${server}`);
    console.log(chalk.dim('Run `nodetick auth login` to sign in'));
  }
}

async function logout() {
  await clearAccessToken();
  console.log(chalk.green('✓'), 'Token cleared');
}

async function setToken(token: string, options: { server?: string }) {
  if (options.server) {
    await updateConfig({ server_url: normalizeServerUrl(options.server) });
  }
  await saveAccessToken(token);
  console.log(chalk.green('✓'), 'Token saved');
}

export function registerAuthCommand(program: import('commander').Command) {
  const auth = program.command('auth').description('OAuth and token storage');
  auth
    .command('login')
    .description('Sign in via OAuth (PKCE, opens browser)')
    .option('--server <url>', 'NodeTick server URL, e.g. https://nodetick.example.workers.dev')
    .action(loginWithOAuth);
  auth
    .command('token')
    .description('Set access token directly')
    .argument('<token>', 'access token string')
    .option('--server <url>', 'NodeTick server URL')
    .action(setToken);
  auth.command('status').description('Print whether a token is stored').action(showStatus);
  auth.command('logout').description('Delete stored token').action(logout);
}
