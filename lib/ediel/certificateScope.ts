function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function upper(value: unknown): string | null {
  const output = clean(value)
  return output ? output.toUpperCase() : null
}

export function certificateMessageScopeBlocker(
  certificate: { message_family?: unknown; message_type?: unknown },
  message: { message_family?: unknown; message_code?: unknown },
): 'receiver_certificate_message_family_mismatch' | 'receiver_certificate_message_code_mismatch' | null {
  const certificateFamily = upper(certificate.message_family)
  const certificateType = upper(certificate.message_type)
  const messageFamily = upper(message.message_family)
  const messageCode = upper(message.message_code)

  if (certificateFamily && certificateFamily !== messageFamily) {
    return 'receiver_certificate_message_family_mismatch'
  }

  if (!certificateType) return null

  // Production recipient certificates are historically materialized with the
  // message family duplicated into message_type (for example PRODAT/PRODAT).
  // Treat that shape as family scope. A genuinely specific message_type such
  // as Z01 remains code-scoped and must match the actual message code.
  if (certificateType === messageFamily || (certificateFamily && certificateType === certificateFamily)) {
    return null
  }

  if (certificateType !== messageCode) {
    return 'receiver_certificate_message_code_mismatch'
  }

  return null
}
