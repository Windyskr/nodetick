const HEX = '0123456789abcdef';

/** Raised when a streaming request exceeds the application body limit. */
export class RequestBodyTooLargeError extends Error {
  constructor() {
    super('request body too large');
    this.name = 'RequestBodyTooLargeError';
  }
}

const oversizedRequests = new WeakSet<Request>();

/** Check whether a request body exceeded the streaming limit. */
export function isRequestBodyTooLarge(source: unknown): boolean {
  const request = source instanceof Request
    ? source
    : source && typeof source === 'object' && 'raw' in source && (source as { raw?: unknown }).raw instanceof Request
      ? (source as { raw: Request }).raw
      : undefined;
  return request ? oversizedRequests.has(request) : false;
}

/** Generate a TickTick-style id: 24 lowercase hex chars, timestamp-prefixed. */
export function genId(): string {
  const ts = Math.floor(Date.now() / 1000);
  let out = ts.toString(16).padStart(8, '0');
  const random = new Uint8Array(8);
  crypto.getRandomValues(random);
  for (const byte of random) out += HEX[byte >> 4] + HEX[byte & 0x0f];
  return out;
}

/**
 * Wrap a request body with a byte-counting stream. Content-Length is not
 * guaranteed to be present for chunked requests, so checking the header alone
 * does not protect the parsers below from an arbitrarily large body.
 */
export function limitRequestBody(request: Request, maxBytes: number): Request {
  if (!request.body || request.method === 'GET' || request.method === 'HEAD') return request;

  const reader = request.body.getReader();
  let total = 0;
  let limitedRequest: Request | undefined;
  const limitedBody = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        total += value.byteLength;
        if (total > maxBytes) {
          oversizedRequests.add(request);
          if (limitedRequest) oversizedRequests.add(limitedRequest);
          await reader.cancel().catch(() => undefined);
          // Close cleanly after marking the request. The JSON/form helpers
          // turn the marker into RequestBodyTooLargeError, avoiding an
          // unhandled rejected body stream in newer workerd runtimes.
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        controller.error(error);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });

  limitedRequest = new Request(request, { body: limitedBody });
  return limitedRequest;
}

/** State-changing HTTP methods need an origin check when cookie-authenticated. */
export function isStateChangingMethod(method: string): boolean {
  return !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
}

/**
 * Validate browser origin metadata without requiring it from non-browser
 * clients such as the CLI. If a browser sends Origin or Referer, every
 * supplied value must resolve to the request's own origin.
 */
export function isSameOriginRequest(
  requestUrl: string,
  origin: string | undefined,
  referer: string | undefined,
): boolean {
  const expected = new URL(requestUrl).origin;
  for (const candidate of [origin, referer].filter((value): value is string => Boolean(value))) {
    try {
      if (new URL(candidate).origin !== expected) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/** Parse an endpoint JSON object, treating malformed/non-object input as an empty object. */
export async function readJsonObject(request: { json: <T>() => Promise<T>; raw?: Request }): Promise<Record<string, unknown>> {
  try {
    const value = await request.json<unknown>();
    if (isRequestBodyTooLarge(request)) throw new RequestBodyTooLargeError();
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError || isRequestBodyTooLarge(request)) {
      throw new RequestBodyTooLargeError();
    }
    return {};
  }
}

export function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Constant-time string equality. Both sides are hashed first so the
 * comparison length never leaks information about either input, then
 * compared with the Workers-native timingSafeEqual when available.
 */
export async function timingSafeEqualStr(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
  const ab = hexToBytes(ha);
  const bb = hexToBytes(hb);
  const subtle = crypto.subtle as unknown as {
    timingSafeEqual?: (a: ArrayBuffer, b: ArrayBuffer) => boolean;
  };
  if (typeof subtle.timingSafeEqual === 'function') {
    return subtle.timingSafeEqual(ab.buffer as ArrayBuffer, bb.buffer as ArrayBuffer);
  }
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

// Cloudflare's production runtime rejects PBKDF2 iteration counts above
// 100,000 (workerd locally accepts more, which is how 600k slipped through),
// so this is the ceiling, not a free choice.
const PASSWORD_HASH_ITERATIONS = 100_000;

export async function hashPassword(password: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: hexToBytes(salt), iterations: PASSWORD_HASH_ITERATIONS },
    key,
    256,
  );
  const hex = [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
  // Store the iteration count with the hash so future retuning never locks
  // existing users out: `<iterations>$<hex>`. Legacy plain-hex hashes fall
  // back to the current constant in verifyPassword.
  return `${PASSWORD_HASH_ITERATIONS}$${hex}`;
}

/** Constant-time password check against a stored `<iterations>$<hex>` (or
 * legacy plain-hex) hash. */
export async function verifyPassword(
  password: string,
  salt: string,
  stored: string,
): Promise<boolean> {
  const match = /^(\d+)\$([0-9a-f]+)$/.exec(stored);
  const iterations = match ? Number(match[1]) : PASSWORD_HASH_ITERATIONS;
  const expected = match ? match[2] : stored;
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 10_000_000) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: hexToBytes(salt), iterations },
    key,
    256,
  );
  const hex = [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return timingSafeEqualStr(hex, expected);
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function nowIso(): string {
  return new Date().toISOString().replace('Z', '+0000');
}

export function jsonError(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

export function pickDefined<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/** Parse a JSON column value, returning a default when absent/corrupt. */
export function parseJsonArray<T>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** Days in a Gregorian month (month is 1-12). */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// yyyy-MM-dd, optionally with a clock (HH:mm[:ss[.fff]]) and a zone (Z, ±HH:mm
// or ±HHmm). The TickTick Open API format is 2026-04-07T09:00:00+0800.
const API_DATE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * Strict date parsing for API input: a real calendar day plus a valid clock
 * and offset. Date.parse alone accepts free text such as "March 7" and
 * silently rolls "2026-02-30T00:00:00+0000" over to March 2.
 * Returns epoch ms, null when absent/empty, or undefined when invalid.
 */
export function parseApiDate(value: unknown): number | null | undefined {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > 64) return undefined;
  const text = value.trim();
  const m = API_DATE.exec(text);
  if (!m) return undefined;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return undefined;
  if (m[4] != null && (Number(m[4]) > 23 || Number(m[5]) > 59 || Number(m[6] ?? 0) > 59)) return undefined;
  const zone = m[7];
  if (zone && zone !== 'Z') {
    const digits = zone.replace(':', '');
    if (Number(digits.slice(1, 3)) > 14 || Number(digits.slice(3, 5)) > 59) return undefined;
  }
  // Date.parse wants "+08:00"; the API also sends "+0800".
  const parsed = Date.parse(text.replace(' ', 'T').replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** The first listed field that is present but not a string (to reject with 400). */
export function nonStringField(body: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = body[key];
    if (value != null && typeof value !== 'string') return key;
  }
  return null;
}
