import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto'
import { ApiInputError } from '@/lib/api/strictRequest'

export type KeysetCursorV1 = {
  v: 1
  sort: string
  id: string
  source?: string
}

export type KeysetPageInput = {
  limit: number
  cursor: KeysetCursorV1 | null
}

export type KeysetPage = {
  limit: number
  returned: number
  has_more: boolean
  next_cursor: string | null
}

function cursorKey(): Buffer {
  const material =
    process.env.GRIDEX_CURSOR_SECRET ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    (process.env.NODE_ENV !== 'production'
      ? 'gridex-local-development-cursor-secret'
      : '')
  if (!material) {
    throw new ApiInputError(
      'Cursor-kryptering är inte konfigurerad.',
      'cursor_service_unavailable',
      503,
    )
  }
  return createHash('sha256').update(material).digest()
}

export function encodeKeysetCursor(cursor: KeysetCursorV1): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', cursorKey(), iv)
  const plaintext = Buffer.from(JSON.stringify(cursor), 'utf8')
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([Buffer.from([1]), iv, tag, ciphertext]).toString('base64url')
}

export function decodeKeysetCursor(token: string): KeysetCursorV1 {
  try {
    const payload = Buffer.from(token, 'base64url')
    if (payload.length < 30 || payload[0] !== 1) throw new Error('cursor_version')
    const iv = payload.subarray(1, 13)
    const tag = payload.subarray(13, 29)
    const ciphertext = payload.subarray(29)
    const decipher = createDecipheriv('aes-256-gcm', cursorKey(), iv)
    decipher.setAuthTag(tag)
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8')
    const parsed = JSON.parse(plaintext) as Partial<KeysetCursorV1>
    if (
      parsed.v !== 1 ||
      typeof parsed.sort !== 'string' ||
      !parsed.sort ||
      typeof parsed.id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parsed.id) ||
      (parsed.source !== undefined &&
        (typeof parsed.source !== 'string' || !/^[a-z0-9_:-]{1,80}$/i.test(parsed.source)))
    ) {
      throw new Error('cursor_shape')
    }
    return parsed as KeysetCursorV1
  } catch (error) {
    if (error instanceof ApiInputError) throw error
    throw new ApiInputError(
      'Cursor är ogiltig eller har löpt ut.',
      'invalid_cursor',
      422,
      'cursor',
    )
  }
}

export function keysetPageInput(
  searchParams: URLSearchParams,
  options: { defaultLimit?: number; maxLimit?: number } = {},
): KeysetPageInput {
  const defaultLimit = options.defaultLimit ?? 50
  const maxLimit = options.maxLimit ?? 100
  const rawLimit = searchParams.get('limit')
  let limit = defaultLimit
  if (rawLimit !== null) {
    const parsed = Number(rawLimit)
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > maxLimit) {
      throw new ApiInputError(
        `limit måste vara ett heltal mellan 1 och ${maxLimit}.`,
        'invalid_limit',
        422,
        'limit',
      )
    }
    limit = parsed
  }
  const rawCursor = searchParams.get('cursor')?.trim() ?? ''
  return {
    limit,
    cursor: rawCursor ? decodeKeysetCursor(rawCursor) : null,
  }
}

function postgrestLiteral(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

/**
 * PostgREST predicate for ORDER BY <sortColumn> DESC, id DESC.
 * The returned filter is safe only with a trusted, hard-coded sort column.
 */
export function descendingKeysetFilter(
  sortColumn: string,
  cursor: KeysetCursorV1,
): string {
  const sort = postgrestLiteral(cursor.sort)
  return `${sortColumn}.lt.${sort},and(${sortColumn}.eq.${sort},id.lt.${cursor.id})`
}

export function finalizeKeysetPage<T extends Record<string, unknown>, U>(input: {
  rows: T[]
  limit: number
  sortColumn: keyof T & string
  map: (row: T) => U
}): { items: U[]; page: KeysetPage } {
  const hasMore = input.rows.length > input.limit
  const rows = input.rows.slice(0, input.limit)
  const last = rows.at(-1)
  const nextCursor =
    hasMore && last
      ? encodeKeysetCursor({
          v: 1,
          sort: String(last[input.sortColumn] ?? ''),
          id: String(last.id ?? ''),
        })
      : null

  if (hasMore && (!last || !String(last[input.sortColumn] ?? '') || !String(last.id ?? ''))) {
    throw new ApiInputError(
      'Pagination kunde inte skapa en stabil cursor.',
      'pagination_state_invalid',
      503,
    )
  }

  return {
    items: rows.map(input.map),
    page: {
      limit: input.limit,
      returned: rows.length,
      has_more: hasMore,
      next_cursor: nextCursor,
    },
  }
}
