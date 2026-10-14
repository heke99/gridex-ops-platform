import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { getSupabaseServiceEnv } from '@/lib/env/supabaseServer'
import { InvalidReadModelResponseError } from '@/lib/read-models/readResult'

export type AdminPageTuple = { createdAt: string | null; id: string }
export type AdminPageContext = { companyId: string | null; resource: string; predicateVersion: string }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export class AdminCursorError extends Error {
  readonly code = 'invalid_cursor'
  readonly status = 400
  readonly field = 'cursor'
  constructor() { super('Sidvalet är ogiltigt eller hör till ett annat urval.'); this.name = 'AdminCursorError' }
}

function cursorKey(): Buffer {
  return createHash('sha256').update(`gridex-admin-cursor:v1:${getSupabaseServiceEnv().serviceRoleKey}`).digest()
}

function tuple(value: unknown): AdminPageTuple {
  if (!value || typeof value !== 'object') throw new InvalidReadModelResponseError()
  const row = value as Record<string, unknown>
  if (typeof row.id !== 'string' || !UUID.test(row.id)) throw new InvalidReadModelResponseError()
  let createdAt: string | null = null
  if (row.createdAt !== null) {
    if (typeof row.createdAt !== 'string' || !Number.isFinite(Date.parse(row.createdAt))) throw new InvalidReadModelResponseError()
    const match = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.(\d{1,6}))?(?:Z|[+-]\d{2}:\d{2})$/.exec(row.createdAt)
    if (!match) throw new InvalidReadModelResponseError()
    // JS Date is millisecond-only; preserve the PostgreSQL microsecond key.
    createdAt = `${new Date(row.createdAt).toISOString().slice(0, 19)}.${(match[1] ?? '').padEnd(6, '0')}Z`
  }
  return { id: row.id.toLowerCase(), createdAt }
}

function encode(context: AdminPageContext, last: AdminPageTuple): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', cursorKey(), iv)
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify({ version: 1, ...context, sort: 'created_at.desc.nullslast,id.desc', ...last }), 'utf8'), cipher.final(),
  ])
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url')
}

export function decodeAdminCursor(cursor: string | null | undefined, context: AdminPageContext): AdminPageTuple | null {
  // Check the existing server-key contract even on an initial/empty page.
  const key = cursorKey()
  if (!cursor) return null
  try {
    if (cursor.length > 2048) throw new AdminCursorError()
    const bytes = Buffer.from(cursor, 'base64url')
    if (bytes.toString('base64url') !== cursor || bytes.length < 29) throw new AdminCursorError()
    const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12))
    decipher.setAuthTag(bytes.subarray(12, 28))
    const payload = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'))
    if (payload.version !== 1 || payload.companyId !== context.companyId || payload.resource !== context.resource
      || payload.predicateVersion !== context.predicateVersion || payload.sort !== 'created_at.desc.nullslast,id.desc') {
      throw new AdminCursorError()
    }
    return tuple(payload)
  } catch {
    throw new AdminCursorError()
  }
}

function follows(next: AdminPageTuple, previous: AdminPageTuple): boolean {
  if (previous.createdAt === null) return next.createdAt === null && next.id < previous.id
  if (next.createdAt === null) return true
  return next.createdAt < previous.createdAt || (next.createdAt === previous.createdAt && next.id < previous.id)
}

export type AdminCandidatePage<T> = {
  items: T[]
  page: { limit: number; hasMore: boolean; nextCursor: string | null; coverage: 'complete' | 'partial'; scanned: number; notReady: number }
}

/** Bounded candidate scan. A transport cap or scan budget never certifies exhaustion. */
export async function scanAdminCandidates<T extends { id: string; created_at: string | null }>(input: {
  context: AdminPageContext
  cursor?: string | null
  load: (after: AdminPageTuple | null, limit: number) => Promise<{ rows: T[]; count: number }>
  eligible: (row: T) => boolean
  limit?: number
}): Promise<AdminCandidatePage<T>> {
  let after = decodeAdminCursor(input.cursor, input.context)
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? 50), 1), 100)
  const scanBudget = 1000
  const maximumBatches = 10
  const batchSize = 100
  const items: T[] = []
  let scanned = 0
  let notReady = 0
  const result = (hasMore: boolean, coverage: 'complete' | 'partial'): AdminCandidatePage<T> => ({
    items,
    page: { limit, hasMore, nextCursor: hasMore && after ? encode(input.context, after) : null, coverage, scanned, notReady },
  })
  for (let batch = 0; batch < maximumBatches && scanned < scanBudget; batch++) {
    const maximum = Math.min(batchSize, scanBudget - scanned)
    const { rows, count } = await input.load(after, maximum + 1)
    if (!Array.isArray(rows) || !Number.isInteger(count) || count < rows.length || count < 0 || rows.length > maximum + 1) {
      throw new InvalidReadModelResponseError()
    }
    if (rows.length === 0) {
      if (count !== 0) throw new InvalidReadModelResponseError()
      return result(false, 'complete')
    }
    const consumed = Math.min(rows.length, maximum)
    for (let index = 0; index < consumed; index++) {
      const row = rows[index]
      const next = tuple({ id: row?.id, createdAt: row?.created_at })
      if (after && !follows(next, after)) throw new InvalidReadModelResponseError()
      const eligible = input.eligible(row)
      if (eligible && items.length === limit) return result(true, 'complete')
      scanned++
      if (eligible) items.push(row)
      else notReady++
      after = next
    }
    if (count <= consumed) return result(false, 'complete')
  }
  return result(true, 'partial')
}
