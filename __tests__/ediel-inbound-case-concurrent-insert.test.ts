import { describe, expect, it, vi } from 'vitest'

// Concurrent processing of one inbound message: the unique ediel_message_id
// index lets only one case insert win; the loser must continue from that row.
const state = vi.hoisted(() => ({ selects: 0, inserts: 0, winner: null as Record<string, unknown> | null, insertError: null as unknown }))
function chain(table: string) {
  const result = () => {
    if (table !== 'ediel_inbound_cases') return { data: null, error: null }
    return { data: state.selects++ === 0 ? null : state.winner, error: null }
  }
  const builder: Record<string, unknown> = {}
  for (const name of ['select', 'eq', 'is', 'ilike', 'or', 'in', 'limit', 'order', 'neq', 'not']) builder[name] = () => builder
  builder.maybeSingle = async () => result()
  builder.insert = () => { state.inserts++; return { select: () => ({ single: async () => ({ data: null, error: state.insertError }) }) } }
  builder.then = (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null })
  return builder
}
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: (table: string) => chain(table), rpc: async () => ({ data: null, error: null }) } }))

import { createOrUpdateInboundProdatCase } from '@/lib/ediel/inboundCases'
import { ownerSource } from './helpers/sourceOwnerFixtures'

const message = () => ({ ...ownerSource(), id: '11111111-1111-4111-8111-111111111111', company_id: '22222222-2222-4222-8222-222222222222', direction: 'inbound' }) as never

describe('createOrUpdateInboundProdatCase concurrent insert', () => {
  it('continues from the winning case when the unique message slot is taken', async () => {
    Object.assign(state, { selects: 0, inserts: 0, insertError: { code: '23505', message: 'duplicate key value' },
      winner: { id: 'winner-case', company_id: '22222222-2222-4222-8222-222222222222', ediel_message_id: '11111111-1111-4111-8111-111111111111', status: 'new' } })
    await expect(createOrUpdateInboundProdatCase({ actorUserId: 'actor', message: message() })).resolves.toMatchObject({ id: 'winner-case' })
    expect(state.inserts).toBe(1)
  })
  it('refuses a winning case from another tenant', async () => {
    Object.assign(state, { selects: 0, inserts: 0, insertError: { code: '23505', message: 'duplicate key value' },
      winner: { id: 'foreign-case', company_id: '33333333-3333-4333-8333-333333333333', ediel_message_id: '11111111-1111-4111-8111-111111111111', status: 'new' } })
    await expect(createOrUpdateInboundProdatCase({ actorUserId: 'actor', message: message() })).rejects.toThrow('TENANT_CONTEXT_MISMATCH')
  })
  it('still throws other insert errors', async () => {
    Object.assign(state, { selects: 0, inserts: 0, insertError: { code: '23503', message: 'fk' }, winner: null })
    await expect(createOrUpdateInboundProdatCase({ actorUserId: 'actor', message: message() })).rejects.toMatchObject({ code: '23503' })
  })
})
