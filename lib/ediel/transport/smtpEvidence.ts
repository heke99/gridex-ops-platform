type SmtpResult = { accepted: unknown[]; rejected: unknown[]; messageId?: string; response?: string }

function statusCode(response: string | null, explicit?: unknown): number | null {
  if (typeof explicit === 'number' && Number.isInteger(explicit) && explicit >= 100 && explicit < 600) return explicit
  const match = response?.match(/^([1-5]\d{2})(?:[ -]|$)/)
  return match ? Number(match[1]) : null
}

/** Preserve provider evidence; a recognizable queue label is observation, never delivery proof. */
export function smtpResultEvidence(result: SmtpResult) {
  const response = typeof result.response === 'string' ? result.response : null
  const smtpCode = statusCode(response)
  const labels = smtpCode !== null && smtpCode >= 200 && smtpCode < 300
    ? [...(response ?? '').matchAll(/\bqueued as ([A-Za-z0-9._-]+)(?=$|\s)/gi)].map(match => match[1]) : []
  return { accepted: result.accepted, rejected: result.rejected, messageId: result.messageId ?? null,
    response, smtpCode, queueId: labels.length === 1 ? labels[0] : null }
}

export function smtpErrorEvidence(error: unknown) {
  const e = error as { message?: unknown; code?: unknown; command?: unknown; responseCode?: unknown; response?: unknown; syscall?: unknown } | null
  const response = typeof e?.response === 'string' ? e.response : null
  return { smtpCode: statusCode(response, e?.responseCode), queueId: null,
    error: { message: String(e?.message ?? error), code: e?.code ?? null, command: e?.command ?? null,
      responseCode: e?.responseCode ?? null, response, syscall: e?.syscall ?? null } }
}
