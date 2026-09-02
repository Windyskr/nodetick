import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface NodeTickConfig {
  server_url?: string;
  access_token?: string;
}

export const CONFIG_PATH = join(homedir(), '.config', 'nodetick', 'config.json');

export async function readConfig(): Promise<NodeTickConfig> {
  try {
    const content = await readFile(CONFIG_PATH, 'utf-8');
    return JSON.parse(content) as NodeTickConfig;
  } catch {
    return {};
  }
}

/**
 * The config file holds a long-lived bearer token, so it must not be
 * readable by other users. Best-effort 0600: no-op on Windows (NTFS ACLs
 * are the user's default home-dir protection there).
 */
async function restrictPermissions(): Promise<void> {
  if (process.platform === 'win32') return;
  try {
    await chmod(CONFIG_PATH, 0o600);
  } catch {
    // older Node / exotic filesystems — best effort
  }
}

export async function writeConfig(config: NodeTickConfig): Promise<void> {
  await mkdir(dirname(CONFIG_PATH), { recursive: true });
  await writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
  await restrictPermissions();
}

export async function updateConfig(partial: Partial<NodeTickConfig>): Promise<void> {
  const existing = await readConfig();
  await writeConfig({ ...existing, ...partial });
}

/** Effective server URL: env override wins, then config. */
export async function getServerUrl(): Promise<string> {
  const fromEnv = process.env.NODETICK_SERVER;
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  const config = await readConfig();
  if (config.server_url) return config.server_url.replace(/\/+$/, '');
  throw new Error(
    'No server configured. Run `nodetick auth login --server https://your-worker.workers.dev` first.',
  );
}
