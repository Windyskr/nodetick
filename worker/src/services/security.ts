import { Env } from '../env.js';
import { sha256Hex } from '../util.js';

/**
 * D1-backed login rate limiting, NodeWarden-style: per-IP failed-attempt
 * counter with a temporary lockout, atomic UPSERT for concurrency safety,
 * lazy periodic cleanup. Login is low-volume and security-critical, so the
 * extra D1 write on failures is acceptable.
 *
 * Tables live in schema.sql (auto-initialized with the rest), so this module
 * never creates tables at request time.
 */
export const LOGIN_MAX_ATTEMPTS = 10;
export const LOGIN_LOCKOUT_MINUTES = 2;
export const REGISTRATION_MAX_ATTEMPTS = 5;
export const REGISTRATION_WINDOW_MINUTES = 15;
const CLEANUP_PROBABILITY = 0.05;
const CLEANUP_MIN_INTERVAL_MS = 10 * 60 * 1000;
const RETENTION_MS = 24 * 60 * 60 * 1000;

let lastCleanupAt = 0;

export interface LoginAttemptCheck {
  allowed: boolean;
  retryAfterSeconds?: number;
}

export async function checkLoginAttempt(db: D1Database, ip: string, email?: string): Promise<LoginAttemptCheck> {
  const now = Date.now();
  // Two keys per attempt: the IP (broad net) and an IP-independent account
  // key (targeted account attack). IP-only keys let an attacker rotate IPs to
  // skip the lockout.
  for (const key of await loginAttemptKeys(ip, email)) {
    const row = await db
      .prepare('SELECT locked_until FROM login_attempts_ip WHERE ip = ?')
      .bind(key)
      .first<{ locked_until: number | null }>();
    if (row?.locked_until && row.locked_until > now) {
      return { allowed: false, retryAfterSeconds: Math.ceil((row.locked_until - now) / 1000) };
    }
  }
  return { allowed: true };
}

/** Return the broad IP key and, when available, an IP-independent account key. */
async function loginAttemptKeys(ip: string, email?: string): Promise<string[]> {
  const base = normalizeIp(ip);
  const keys = [`ip:${base}`];
  const normalizedEmail = email?.toLowerCase().trim();
  // Keep the account dimension independent of the source IP: otherwise an
  // attacker can reset the targeted account's counter simply by rotating IPs.
  // Hashing also keeps email addresses out of the rate-limit table.
  if (normalizedEmail && normalizedEmail.length <= 320) {
    keys.push(`account:${await sha256Hex(normalizedEmail)}`);
  }
  return keys;
}

export async function recordFailedLogin(db: D1Database, ip: string, email?: string): Promise<LoginAttemptCheck> {
  const now = Date.now();
  let lock: LoginAttemptCheck = { allowed: true };
  for (const key of await loginAttemptKeys(ip, email)) {
    // Single atomic UPSERT — concurrency-safe because the row is keyed.
    await db
      .prepare(
        'INSERT INTO login_attempts_ip(ip, attempts, locked_until, updated_at) VALUES(?, 1, NULL, ?) ' +
          'ON CONFLICT(ip) DO UPDATE SET ' +
          'attempts = CASE WHEN login_attempts_ip.locked_until IS NOT NULL AND login_attempts_ip.locked_until <= excluded.updated_at ' +
          'THEN 1 ELSE login_attempts_ip.attempts + 1 END, ' +
          'locked_until = CASE WHEN login_attempts_ip.locked_until IS NOT NULL AND login_attempts_ip.locked_until <= excluded.updated_at ' +
          'THEN NULL ELSE login_attempts_ip.locked_until END, ' +
          'updated_at = excluded.updated_at',
      )
      .bind(key, now)
      .run();
    const row = await db
      .prepare('SELECT attempts FROM login_attempts_ip WHERE ip = ?')
      .bind(key)
      .first<{ attempts: number }>();
    const attempts = row?.attempts ?? 1;
    if (attempts >= LOGIN_MAX_ATTEMPTS) {
      const lockedUntil = now + LOGIN_LOCKOUT_MINUTES * 60 * 1000;
      await db.prepare('UPDATE login_attempts_ip SET locked_until = ?, updated_at = ? WHERE ip = ?')
        .bind(lockedUntil, now, key)
        .run();
      lock = { allowed: false, retryAfterSeconds: LOGIN_LOCKOUT_MINUTES * 60 };
    }
  }
  void maybeCleanup(db, now).catch(() => undefined);
  return lock;
}

export async function clearLoginAttempts(db: D1Database, ip: string, email?: string): Promise<void> {
  for (const key of await loginAttemptKeys(ip, email)) {
    await db.prepare('DELETE FROM login_attempts_ip WHERE ip = ?').bind(key).run();
  }
}

/**
 * Consume one registration attempt for an IP. This is intentionally counted
 * before validation and password hashing so malformed requests and invite
 * probing cannot be used to consume unbounded Worker CPU.
 */
export async function consumeRegistrationAttempt(db: D1Database, ip: string): Promise<LoginAttemptCheck> {
  const now = Date.now();
  const normalizedIp = normalizeIp(ip);
  const windowMs = REGISTRATION_WINDOW_MINUTES * 60 * 1000;
  await db
    .prepare(
      'INSERT INTO registration_attempts_ip(ip, attempts, window_started_at, locked_until, updated_at) VALUES(?, 1, ?, NULL, ?) ' +
        'ON CONFLICT(ip) DO UPDATE SET ' +
        'attempts = CASE ' +
        'WHEN registration_attempts_ip.locked_until IS NOT NULL AND registration_attempts_ip.locked_until > excluded.updated_at THEN registration_attempts_ip.attempts ' +
        'WHEN (registration_attempts_ip.locked_until IS NOT NULL AND registration_attempts_ip.locked_until <= excluded.updated_at) ' +
        'OR registration_attempts_ip.window_started_at <= excluded.updated_at - ? THEN 1 ' +
        'ELSE registration_attempts_ip.attempts + 1 END, ' +
        'window_started_at = CASE ' +
        'WHEN registration_attempts_ip.locked_until IS NOT NULL AND registration_attempts_ip.locked_until > excluded.updated_at THEN registration_attempts_ip.window_started_at ' +
        'WHEN (registration_attempts_ip.locked_until IS NOT NULL AND registration_attempts_ip.locked_until <= excluded.updated_at) ' +
        'OR registration_attempts_ip.window_started_at <= excluded.updated_at - ? THEN excluded.window_started_at ' +
        'ELSE registration_attempts_ip.window_started_at END, ' +
        'locked_until = CASE ' +
        'WHEN registration_attempts_ip.locked_until IS NOT NULL AND registration_attempts_ip.locked_until > excluded.updated_at THEN registration_attempts_ip.locked_until ' +
        'WHEN (registration_attempts_ip.locked_until IS NOT NULL AND registration_attempts_ip.locked_until <= excluded.updated_at) ' +
        'OR registration_attempts_ip.window_started_at <= excluded.updated_at - ? THEN NULL ' +
        'ELSE registration_attempts_ip.locked_until END, ' +
        'updated_at = excluded.updated_at',
      )
    .bind(normalizedIp, now, now, windowMs, windowMs, windowMs)
    .run();

  const row = await db
    .prepare('SELECT attempts, locked_until FROM registration_attempts_ip WHERE ip = ?')
    .bind(normalizedIp)
    .first<{ attempts: number; locked_until: number | null }>();
  if (row?.locked_until && row.locked_until > now) {
    return { allowed: false, retryAfterSeconds: Math.ceil((row.locked_until - now) / 1000) };
  }
  if ((row?.attempts ?? 1) > REGISTRATION_MAX_ATTEMPTS) {
    const lockedUntil = now + windowMs;
    await db
      .prepare('UPDATE registration_attempts_ip SET locked_until = ?, updated_at = ? WHERE ip = ?')
      .bind(lockedUntil, now, normalizedIp)
      .run();
    return { allowed: false, retryAfterSeconds: REGISTRATION_WINDOW_MINUTES * 60 };
  }
  void maybeCleanupRegistrationAttempts(db, now).catch(() => undefined);
  return { allowed: true };
}

async function maybeCleanup(db: D1Database, nowMs: number): Promise<void> {
  if (nowMs - lastCleanupAt < CLEANUP_MIN_INTERVAL_MS) return;
  if (Math.random() >= CLEANUP_PROBABILITY) return;
  lastCleanupAt = nowMs;
  const cutoff = nowMs - RETENTION_MS;
  await db
    .prepare(
      'DELETE FROM login_attempts_ip WHERE ip LIKE ? OR (updated_at < ? AND (locked_until IS NULL OR locked_until < ?))',
    )
    // Older versions stored the raw email after a '#'. Remove those legacy
    // keys as soon as the lazy cleanup runs so PII does not linger.
    .bind('%#%', cutoff, nowMs)
    .run();
}

let lastRegistrationCleanupAt = 0;
async function maybeCleanupRegistrationAttempts(db: D1Database, nowMs: number): Promise<void> {
  if (nowMs - lastRegistrationCleanupAt < CLEANUP_MIN_INTERVAL_MS) return;
  if (Math.random() >= CLEANUP_PROBABILITY) return;
  lastRegistrationCleanupAt = nowMs;
  await db
    .prepare('DELETE FROM registration_attempts_ip WHERE updated_at < ?')
    .bind(nowMs - RETENTION_MS)
    .run();
}

/** Best-effort client IP for rate limiting (Cloudflare provides these). */
export function clientIp(cfIp: string | undefined, _forwardedFor?: string): string {
  // X-Forwarded-For is client-controlled unless a trusted proxy is explicitly
  // configured. Cloudflare overwrites CF-Connecting-IP at the edge, so use it
  // and deliberately ignore the spoofable fallback.
  const value = cfIp?.trim();
  return value && value.length <= 128 ? value : 'unknown';
}

function normalizeIp(ip: string): string {
  const value = String(ip ?? '').trim();
  return value && value.length <= 128 ? value : 'unknown';
}

/**
 * Security audit log: append-only record of auth-relevant events
 * (login success/failure, lockouts, token create/revoke). Sensitive keys in
 * metadata are redacted before persistence.
 */
export interface AuditEventInput {
  userId?: string | null;
  action: string;
  level?: 'info' | 'warn' | 'security';
  metadata?: Record<string, unknown> | null;
}

const SENSITIVE_KEY_RE = /(token|secret|password|key|hash|code|cookie|authorization)/i;
const MAX_METADATA_BYTES = 2048;

export async function writeAuditEvent(db: D1Database, input: AuditEventInput, ip?: string): Promise<void> {
  try {
    await db
      .prepare(
        'INSERT INTO audit_events (user_id, action, level, ip, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .bind(input.userId ?? null, input.action, input.level ?? 'info', ip ?? null, metadataOf(input), Date.now())
      .run();
    void maybeTrimAuditLog(db).catch((error) => console.error('audit cleanup failed:', error));
  } catch (e) {
    // Audit must never break the request path.
    console.error('audit write failed:', e);
  }
}

function metadataOf(input: AuditEventInput): string | null {
  if (!input.metadata) return null;
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input.metadata)) {
    if (!SENSITIVE_KEY_RE.test(k)) safe[k] = v;
  }
  let metadata = JSON.stringify(safe);
  if (metadata.length > MAX_METADATA_BYTES) metadata = metadata.slice(0, MAX_METADATA_BYTES);
  return metadata;
}

/** Trim the audit log to a bounded size (called lazily on writes). */
let lastAuditCleanupAt = 0;
export async function maybeTrimAuditLog(db: D1Database): Promise<void> {
  const now = Date.now();
  if (now - lastAuditCleanupAt < 6 * 60 * 60 * 1000) return;
  if (Math.random() >= 0.02) return;
  lastAuditCleanupAt = now;
  await db
    .prepare('DELETE FROM audit_events WHERE id NOT IN (SELECT id FROM audit_events ORDER BY id DESC LIMIT 5000)')
    .run();
}
