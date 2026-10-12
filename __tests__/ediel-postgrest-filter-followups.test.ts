// Follow-ups to the matching reference fix: every remaining Ediel `or` filter
// that takes a message/caller value quotes it, uuid columns only see UUIDs,
// and UUID-shaped refs are canonical so exact-match scoring agrees with Postgres.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  ors: [] as Array<{ table: string; filter: string }>,
  rows: {} as Record<string, unknown>,
}))

vi.mock('@/lib/supabase/service', () => {
  const make = (table: string) => {
    const chain: Record<string, unknown> = {}
    const result = () => {
      const row = db.rows[table]
      return { data: Array.isArray(row) ? row : row ?? null, error: null }
    }
    Object.assign(chain, {
      select: () => chain, limit: () => chain, in: () => chain, eq: () => chain, order: () => chain, is: () => chain,
      or: (filter: string) => { db.ors.push({ table, filter }); return chain },
      maybeSingle: async () => { const row = db.rows[table]; return { data: Array.isArray(row) ? row[0] ?? null : row ?? null, error: null } },
      then: (resolve: (value: unknown) => unknown) => resolve(result()),
    })
    return chain
  }
  return { supabaseService: { from: (table: string) => make(table) } }
})

import { canonicalUuidOrText, postgrestEq, postgrestEqAny, quotePostgrestValue } from '@/lib/ediel/matching/postgrestFilter'
import { matchProcessForAutomation } from '@/lib/ediel/matching/processMatcher'
import { resolveEdielDispatchState } from '@/lib/ediel/intent/dispatchState'
import type { EdielMessageRow } from '@/lib/ediel/types'

const COMPANY = '11111111-1111-4111-8111-111111111111'
const UUID = 'abcdef12-3456-4abc-8def-abcdef123456'

beforeEach(() => { db.ors.length = 0; db.rows = {} })

describe('postgrestFilter helpers', () => {
  it('quotes values so reserved characters stay inside one condition', () => {
    expect(quotePostgrestValue('a,b.c(d):e')).toBe('"a,b.c(d):e"')
    expect(quotePostgrestValue('x"y\\z')).toBe('"x\\"y\\\\z"')
    expect(postgrestEq('meter_point_id', '735,id.neq.0')).toBe('meter_point_id.eq."735,id.neq.0"')
  })

  it('only compares UUID-shaped values with uuid columns', () => {
    expect(postgrestEqAny(['business_code'], ['id'], ['Z02'])).toBe('business_code.eq."Z02"')
    expect(postgrestEqAny([], ['id'], [UUID])).toBe(`id.eq."${UUID}"`)
  })

  it('lower-cases UUID-shaped values only', () => {
    expect(canonicalUuidOrText(UUID.toUpperCase())).toBe(UUID)
    expect(canonicalUuidOrText('Z02-ABC')).toBe('Z02-ABC')
  })
})

describe('processMatcher UUID canonicalisation', () => {
  it('scores an upper-case UUID reference as an exact supplier switch match', async () => {
    db.rows.supplier_switch_requests = [{ id: UUID, company_id: COMPANY, external_reference: null }]
    const message = { id: 'm', company_id: COMPANY, external_reference: UUID.toUpperCase() } as unknown as EdielMessageRow
    const candidates = await matchProcessForAutomation({ message, companyId: COMPANY })
    const sw = candidates.find((c) => c.details?.processType === 'supplier_switch')!
    expect(sw.reason).toBe('supplier_switch_reference_exact')
    expect(db.ors.find((o) => o.table === 'supplier_switch_requests')!.filter).toContain(`id.eq."${UUID}"`)
  })
})

describe('dispatchState outbox lookup', () => {
  it('quotes both uuid values in the outbox filter', async () => {
    db.rows.ediel_message_intents = { id: UUID, ediel_message_id: COMPANY }
    await resolveEdielDispatchState({ companyId: COMPANY, intentId: UUID })
    expect(db.ors.find((o) => o.table === 'ediel_outbox')!.filter).toBe(`intent_id.eq."${UUID}",ediel_message_id.eq."${COMPANY}"`)
  })

  it('never builds an or filter with a non-UUID message id (falls back to intent_id equality)', async () => {
    db.rows.ediel_message_intents = { id: UUID, ediel_message_id: 'not-a-uuid,id.neq.0' }
    await resolveEdielDispatchState({ companyId: COMPANY, intentId: UUID })
    expect(db.ors.filter((o) => o.table === 'ediel_outbox')).toEqual([])
  })
})
