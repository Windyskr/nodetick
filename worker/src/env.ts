export interface Env {
  DB: D1Database;
  /** Secret used to sign CSRF tokens for the web UI. */
  SESSION_SECRET?: string;
  /** Optional invite code required for registration after the first user. */
  INVITE_CODE?: string;
  /** Public VAPID key exposed to browsers when Web Push is configured. */
  VAPID_PUBLIC_KEY?: string;
  /** Private VAPID key. Configure with `wrangler secret put`, never commit it. */
  VAPID_PRIVATE_KEY?: string;
  /** A mailto: or https: contact identifying this push sender. */
  VAPID_SUBJECT?: string;
}

export type Vars = { userId: string };

export type App = import('hono').Hono<{ Bindings: Env; Variables: Vars }>;
