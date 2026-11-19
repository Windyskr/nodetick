/**
 * Strict numeric option parsing. `parseInt('high')` / `Number('lots')` give
 * NaN, which JSON.stringify sends as null, and the server reads null as "not
 * provided": a typo would be silently ignored while the CLI reports success.
 */
export function numberOption(
  flag: string,
  raw: unknown,
  { integer = false }: { integer?: boolean } = {},
): number | undefined {
  if (raw == null) return undefined;
  const text = String(raw).trim();
  const value = text === '' ? Number.NaN : Number(text);
  if (!Number.isFinite(value) || (integer && !Number.isInteger(value))) {
    throw new Error(`${flag} must be ${integer ? 'an integer' : 'a number'}, got "${String(raw)}"`);
  }
  return value;
}

/** Comma-separated list of strict numbers, e.g. `--priority 0,3,5`. */
export function numberListOption(
  flag: string,
  raw: unknown,
  options: { integer?: boolean } = {},
): number[] | undefined {
  if (raw == null) return undefined;
  return String(raw).split(',').map((part) => numberOption(flag, part, options) as number);
}
