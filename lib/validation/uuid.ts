const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class UuidValidationError extends Error {
  readonly fieldName: string;

  constructor(fieldName: string, value: unknown) {
    const rendered = typeof value === "string" ? value.trim() : String(value);
    super(`${fieldName} har ogiltigt UUID-format: ${rendered}`);
    this.name = "UuidValidationError";
    this.fieldName = fieldName;
  }
}

function cleanUuidCandidate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return String(value).trim() || null;
  return value.trim() || null;
}

export function normalizeUuidOrNull(
  value: unknown,
  fieldName = "uuid",
): string | null {
  const candidate = cleanUuidCandidate(value);
  if (!candidate) return null;
  if (!UUID_PATTERN.test(candidate)) {
    throw new UuidValidationError(fieldName, value);
  }
  return candidate.toLowerCase();
}

export function requireUuid(value: unknown, fieldName: string): string {
  const normalized = normalizeUuidOrNull(value, fieldName);
  if (!normalized) {
    throw new UuidValidationError(fieldName, value ?? "");
  }
  return normalized;
}

export function isUuid(value: unknown): boolean {
  try {
    return normalizeUuidOrNull(value) !== null;
  } catch {
    return false;
  }
}
