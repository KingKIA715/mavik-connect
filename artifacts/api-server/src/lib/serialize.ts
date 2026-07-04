/**
 * Drizzle `timestamp` columns are returned as JS `Date` objects, but every
 * API response schema models timestamps as ISO strings. Route handlers must
 * pass Date values through this helper before handing them to a Zod
 * response schema's `.parse()`, or `.parse()` will throw.
 */
export function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

export function toIsoOrNull(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return toIso(value);
}
