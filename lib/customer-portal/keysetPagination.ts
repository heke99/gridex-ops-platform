import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { getSupabaseServiceEnv } from '@/lib/env/supabaseServer'

export type PortalCursorTuple = {
  orderValue: string
  id: string
  sourceRank?: number
}

type CursorPayload = PortalCursorTuple & {
  version: 1
  companyId: string
  customerId: string
  resource: string
}

export class PortalCursorError extends Error {
  readonly code = 'invalid_cursor'
  readonly status = 400
  readonly field = 'cursor'

  constructor() {
    super('Cursor is invalid, expired or belongs to another tenant resource.')
    this.name = 'PortalCursorError'
  }
}

function cursorKey(): Buffer {
  return createHash('sha256')
    .update(`gridex-portal-cursor:v1:${getSupabaseServiceEnv().serviceRoleKey}`)
    .digest()
}

export function encodePortalCursor(input: {
  companyId: string
  customerId: string
  resource: string
  tuple: PortalCursorTuple
}): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', cursorKey(), iv)
  const payload: CursorPayload = {
    version: 1,
    companyId: input.companyId,
    customerId: input.customerId,
    resource: input.resource,
    ...input.tuple,
  }
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ])
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url')
}

export function decodePortalCursor(input: {
  cursor?: string | null
  companyId: string
  customerId: string
  resource: string
}): PortalCursorTuple | null {
  if (!input.cursor) return null
  try {
    const bytes = Buffer.from(input.cursor, 'base64url')
    if (bytes.toString('base64url') !== input.cursor) throw new PortalCursorError()
    if (bytes.length < 29) throw new PortalCursorError()
    const decipher = createDecipheriv('aes-256-gcm', cursorKey(), bytes.subarray(0, 12))
    decipher.setAuthTag(bytes.subarray(12, 28))
    const cleartext = Buffer.concat([
      decipher.update(bytes.subarray(28)),
      decipher.final(),
    ]).toString('utf8')
    const payload = JSON.parse(cleartext) as Partial<CursorPayload>
    if (
      payload.version !== 1 ||
      payload.companyId !== input.companyId ||
      payload.customerId !== input.customerId ||
      payload.resource !== input.resource ||
      typeof payload.orderValue !== 'string' ||
      !payload.orderValue ||
      typeof payload.id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.id)
    ) throw new PortalCursorError()
    return {
      orderValue: payload.orderValue,
      id: payload.id,
      ...(Number.isInteger(payload.sourceRank) ? { sourceRank: payload.sourceRank } : {}),
    }
  } catch (error) {
    if (error instanceof PortalCursorError) throw error
    throw new PortalCursorError()
  }
}

export function portalPageLimit(value?: number | null): number {
  return Math.min(Math.max(Math.trunc(value ?? 50), 1), 100)
}

export function buildPortalDatabasePage<T extends Record<string, unknown>>(
  rows: T[],
  input: {
    limit: number
    companyId: string
    customerId: string
    resource: string
    orderColumn: string
    sourceRankColumn?: string
  },
): {
  items: T[]
  page: {
    limit: number
    offset: number
    returned: number
    has_more: boolean
    next_cursor: string | null
  }
} {
  const hasMore = rows.length > input.limit
  const items = rows.slice(0, input.limit)
  const last = items.at(-1)
  const orderValue = last ? String(last[input.orderColumn] ?? '') : ''
  const id = last ? String(last.id ?? '') : ''
  return {
    items,
    page: {
      limit: input.limit,
      offset: 0,
      returned: items.length,
      has_more: hasMore,
      next_cursor: hasMore && orderValue && id
        ? encodePortalCursor({
            companyId: input.companyId,
            customerId: input.customerId,
            resource: input.resource,
            tuple: {
              orderValue,
              id,
              ...(input.sourceRankColumn
                ? { sourceRank: Number(last?.[input.sourceRankColumn] ?? 0) }
                : {}),
            },
          })
        : null,
    },
  }
}
