export interface Env {
  DB: D1Database;
  /** Secret used to sign CSRF tokens for the web UI. */
  SESSION_SECRET?: string;
  /** Public VAPID key exposed to browsers when Web Push is configured. */
  VAPID_PUBLIC_KEY?: string;
  /** Private VAPID key. Configure with `wrangler secret put`, never commit it. */
  VAPID_PRIVATE_KEY?: string;
  /** A mailto: or https: contact identifying this push sender. */
  VAPID_SUBJECT?: string;
  /**
   * Application (client) ID of a Microsoft Entra app with public client flows
   * enabled, for the Microsoft To Do import (device code sign-in). Unset means
   * the maintainer's shared app; "off" turns the import off.
   */
  MS_TODO_CLIENT_ID?: string;
  /** Entra authority for that sign-in: common (default), consumers, organizations or a tenant id. */
  MS_TODO_TENANT?: string;
}

export type Vars = { userId: string };

export type App = import('hono').Hono<{ Bindings: Env; Variables: Vars }>;
