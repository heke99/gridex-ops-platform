export type ApiBlocker = {
  code: string
  message: string
  field?: string | null
  resource_type?: string | null
  resource_id?: string | null
  count?: number | null
  recommended_action?: string | null
  metadata?: Record<string, unknown>
}

export type ApiErrorBody = {
  error: {
    code: string
    message: string
    stage?: string
    field?: string
    hint?: string
    retryable: boolean
    blockers?: ApiBlocker[]
    details?: unknown
  }
  request_id: string
  correlation_id?: string
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function normalizeApiBlockers(value: unknown): ApiBlocker[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (typeof item === 'string' && item.trim()) {
      return [{ code: item.trim(), message: item.trim() }]
    }
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const row = item as Record<string, unknown>
    const code = text(row.code) ?? text(row.reason) ?? 'request_blocked'
    const message = text(row.message) ?? text(row.reason) ?? code
    return [{
      code,
      message,
      field: text(row.field),
      resource_type: text(row.resource_type) ?? text(row.resourceType),
      resource_id: text(row.resource_id) ?? text(row.resourceId),
      count: typeof row.count === 'number' ? row.count : null,
      recommended_action: text(row.recommended_action) ?? text(row.recommendedAction),
      metadata: row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
        ? row.metadata as Record<string, unknown>
        : undefined,
    }]
  })
}

export function canonicalApiError(input: {
  code: string
  message: string
  requestId: string
  correlationId?: string | null
  field?: string | null
  blockers?: unknown
  details?: unknown
  stage?: string | null
  action?: string | null
  hint?: string | null
  retryable?: boolean
}): ApiErrorBody {
  const correlationId = text(input.correlationId) ?? input.requestId
  const blockers = normalizeApiBlockers(input.blockers)
  const field = text(input.field)
  const retryable = input.retryable === true
  return {
    error: {
      code: input.code,
      message: input.message,
      retryable,
      ...(input.stage ? { stage: input.stage } : {}),
      ...(field ? { field } : {}),
      ...(input.hint ? { hint: input.hint } : {}),
      ...(blockers.length > 0 ? { blockers } : {}),
      ...(input.details !== undefined ? { details: input.details } : {}),
    },
    request_id: input.requestId,
    ...(correlationId !== input.requestId ? { correlation_id: correlationId } : {}),
  }
}
