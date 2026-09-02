export interface Env {
  DB: D1Database;
  /** Secret used to sign CSRF tokens for the web UI. */
  SESSION_SECRET?: string;
  /** Optional invite code required for registration after the first user. */
  INVITE_CODE?: string;
}

export type Vars = { userId: string };

export type App = import('hono').Hono<{ Bindings: Env; Variables: Vars }>;
