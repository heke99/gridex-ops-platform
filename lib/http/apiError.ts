import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'

export type PublicApiError = {
  error: string
  code: string
  trace_id: string
}

const SCHEMA_CODES = new Set(['42P01', '42703', 'PGRST200', 'PGRST201', 'PGRST204', 'PGRST205'])

export function errorCode(error: unknown): string | null {
  const value = error && typeof error === 'object' ? error as { code?: unknown } : null
  return typeof value?.code === 'string' && value.code.trim() ? value.code.trim() : null
}

export function isSchemaError(error: unknown): boolean {
  const code = errorCode(error)
  const message = error instanceof Error ? error.message : String((error as { message?: unknown } | null)?.message ?? '')
  return Boolean(code && SCHEMA_CODES.has(code)) || /schema cache|relation .* does not exist|column .* does not exist|could not find the table/i.test(message)
}

export function traceApiError(context: string, error: unknown, metadata: Record<string, unknown> = {}) {
  const traceId = randomUUID()
  console.error(`[${context}] failed`, {
    traceId,
    code: errorCode(error),
    error: error instanceof Error ? error.message : String(error),
    ...metadata,
  })
  return traceId
}

export function internalApiError(params: {
  context: string
  error: unknown
  code: string
  message?: string
  status?: number
  metadata?: Record<string, unknown>
}) {
  const traceId = traceApiError(params.context, params.error, params.metadata)
  const body: PublicApiError = {
    error: params.message ?? 'Ett tekniskt fel uppstod. Försök igen senare.',
    code: params.code,
    trace_id: traceId,
  }
  return NextResponse.json(body, { status: params.status ?? 500 })
}
