export function formatErrorMessage(error: unknown, fallback = "Ett okänt fel inträffade."): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error.trim();

  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const rawMessage = record.message ?? record.error_description ?? record.error;
    const message = typeof rawMessage === "string" && rawMessage.trim()
      ? rawMessage.trim()
      : null;
    const code = typeof record.code === "string" && record.code.trim()
      ? ` · kod: ${record.code.trim()}`
      : "";
    const details = typeof record.details === "string" && record.details.trim()
      ? ` · ${record.details.trim()}`
      : "";
    const hint = typeof record.hint === "string" && record.hint.trim()
      ? ` · tips: ${record.hint.trim()}`
      : "";

    if (message) return `${message}${code}${details}${hint}`;

    try {
      const serialized = JSON.stringify(record);
      if (serialized && serialized !== "{}") return serialized;
    } catch {
      // Fall through to fallback.
    }
  }

  return fallback;
}
