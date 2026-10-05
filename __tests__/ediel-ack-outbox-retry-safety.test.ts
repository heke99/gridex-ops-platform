// masterplan: ACK-07, AT-ACK-07
import { beforeEach, expect, it, vi } from 'vitest'
import type { EdielMessageRow } from '@/lib/ediel/types'

const state = vi.hoisted(() => ({ rows: new Map<string, Record<string, unknown>>(), events: [] as string[], transitionOnUpdate: false }))
vi.mock('@/lib/ediel/db', () => ({ createEdielMessageEvent: async (event: { eventType: string }) => { state.events.push(event.eventType) } }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from: (table: string) => {
    if (table !== 'ediel_outbox') throw new Error(`unexpected table ${table}`)
    return {
      upsert(row: Record<string, unknown>, options: { ignoreDuplicates?: boolean }) {
        const key = String(row.lock_key)
        const prior = state.rows.get(key)
        const saved = prior && options?.ignoreDuplicates ? null : { ...prior, ...row, id: prior?.id ?? 'outbox-1' }
        if (saved) state.rows.set(key, saved)
        return { select: () => ({ single: async () => ({ data: saved, error: null }), maybeSingle: async () => ({ data: saved, error: null }) }) }
      },
      select() {
        const filters = new Map<string, unknown>()
        const matching = () => [...state.rows.values()].filter(row => [...filters].every(([field,value]) => row[field] === value))
        return { eq(field: string, value: unknown) { filters.set(field,value); return this },
          limit: async (count: number) => ({data:matching().slice(0,count),error:null}),
          maybeSingle: async () => ({ data: matching()[0] ?? null, error: null }) }
      },
      update(patch: Record<string, unknown>) {
        let key = ''
        let statuses: string[] = []
        return { eq(_field: string, value: string) { key = value; return this }, in(_field: string, values: string[]) { statuses = values; return this },
          select() { return { maybeSingle: async () => {
            const prior = [...state.rows.values()].find(row => row.id === key)
            if (prior && state.transitionOnUpdate) {
              state.rows.set(String(prior.lock_key), { ...prior, status: 'sent' })
              return { data: null, error: null }
            }
            if (!prior || !statuses.includes(String(prior.status))) return { data: null, error: null }
            const saved = { ...prior, ...patch }; state.rows.set(String(saved.lock_key), saved)
            return { data: saved, error: null }
          } } },
        }
      },
    }
  },
} }))

import { createOutboxItem } from '@/lib/ediel/outbox/createOutboxItem'

const message = {
  id: 'ack-1', company_id: 'tenant-A', environment: 'test', related_message_id: 'source-1',
  message_family: 'APERAK', message_code: 'E01', ack_outcome: 'negative', route_profile_id: 'route-A',
} as EdielMessageRow
const input = { actorUserId: 'actor-A', message, sourceMessageId: 'source-1', status: 'queued' as const }
const lockKey = 'tenant-A:test:source-1:APERAK:negative'

beforeEach(() => { state.rows.clear(); state.events.length = 0; state.transitionOnUpdate = false })

for (const status of ['sending', 'sent', 'delivery_uncertain', 'superseded'] as const) {
  it(`does not requeue an existing ${status} ACK when inbound is retried`, async () => {
    state.rows.set(lockKey, { id: 'outbox-1', lock_key: lockKey, status, company_id: 'tenant-A',
      environment: 'test', ediel_message_id: 'ack-1', source_message_id: 'source-1', route_profile_id: 'route-A',
      current_send_attempt_id: 'attempt-1', sent_at: '2026-09-26T14:00:00Z' })
    await createOutboxItem(input)
    expect(state.rows.get(lockKey)).toMatchObject({ status, current_send_attempt_id: 'attempt-1', sent_at: '2026-09-26T14:00:00Z' })
    expect(state.events).toEqual([])
  })
}

it('queues a new ACK and allows a known failed ACK to be retried under the same lock', async () => {
  await createOutboxItem(input)
  const newKey = 'tenant-A:test:ack:ack-1'
  expect(state.rows.get(newKey)).toMatchObject({ status: 'queued', company_id: 'tenant-A', ediel_message_id: 'ack-1' })
  state.rows.set(newKey, { ...state.rows.get(newKey), status: 'failed' })
  await createOutboxItem(input)
  expect(state.rows.get(newKey)).toMatchObject({ status: 'queued', ediel_message_id: 'ack-1' })
  expect(state.rows.size).toBe(1)
})

it('does not resurrect a failed ACK that a worker finishes during the conditional retry', async () => {
  state.rows.set(lockKey, { id: 'outbox-1', lock_key: lockKey, status: 'failed', company_id: 'tenant-A',
    environment: 'test', ediel_message_id: 'ack-1', source_message_id: 'source-1', route_profile_id: 'route-A' })
  state.transitionOnUpdate = true
  const result = await createOutboxItem(input)
  expect(result?.status).toBe('sent')
  expect(state.rows.get(lockKey)?.status).toBe('sent')
  expect(state.events).toEqual([])
})

it('two immutable own responses to one inbound source have separate ACK-id outbox identities', async () => {
  await createOutboxItem({...input,queueOnlyIfInserted:true})
  await createOutboxItem({...input,message:{...message,id:'ack-2'},queueOnlyIfInserted:true})
  expect(state.rows.size).toBe(2)
  expect(state.rows.get('tenant-A:test:ack:ack-1')).toMatchObject({ediel_message_id:'ack-1',status:'queued'})
  expect(state.rows.get('tenant-A:test:ack:ack-2')).toMatchObject({ediel_message_id:'ack-2',status:'queued'})
})

it('retains the exact failed legacy ACK entry and lock before considering the new key', async () => {
  const prior={id:'legacy-outbox',lock_key:lockKey,status:'failed',company_id:'tenant-A',environment:'test',ediel_message_id:'ack-1',source_message_id:'source-1',route_profile_id:'route-A',current_send_attempt_id:'fixed-attempt'}
  state.rows.set(lockKey,prior)
  expect(await createOutboxItem({...input,lockKey:'another-caller-namespace',queueOnlyIfInserted:true})).toBe(prior)
  expect(state.rows.size).toBe(1)
  expect(state.rows.get(lockKey)).toEqual(prior)
  expect(state.events).toEqual([])
})

it('holds ambiguous old entries rather than choosing an old lock or inserting a third entry', async () => {
  const prior={id:'old-one',lock_key:lockKey,status:'failed',company_id:'tenant-A',environment:'test',ediel_message_id:'ack-1',source_message_id:'source-1',route_profile_id:'route-A'}
  state.rows.set(lockKey,prior)
  state.rows.set('legacy-two',{...prior,id:'old-two',lock_key:'legacy-two'})
  await expect(createOutboxItem({...input,queueOnlyIfInserted:true})).rejects.toThrow('ediel_outbox_message_identity_ambiguous')
  expect(state.rows.size).toBe(2)
  expect(state.events).toEqual([])
})

it('same actual ACK callers share one key without resetting an established failed state', async () => {
  await createOutboxItem({...input,queueOnlyIfInserted:true})
  const key='tenant-A:test:ack:ack-1',prior={...state.rows.get(key),status:'failed',current_send_attempt_id:'attempt-old'}
  state.rows.set(key,prior)
  await Promise.all([
    createOutboxItem({...input,queueOnlyIfInserted:true,lockKey:'caller-one'}),
    createOutboxItem({...input,queueOnlyIfInserted:true,lockKey:'caller-two'}),
  ])
  expect(state.rows.size).toBe(1)
  expect(state.rows.get(key)).toEqual(prior)
})

it('refuses a legacy exact-message entry with a changed source/route identity', async () => {
  state.rows.set(lockKey,{id:'old-one',lock_key:lockKey,status:'failed',company_id:'tenant-A',environment:'test',ediel_message_id:'ack-1',source_message_id:'foreign-source',route_profile_id:'route-A'})
  await expect(createOutboxItem({...input,queueOnlyIfInserted:true})).rejects.toThrow('ediel_outbox_lock_identity_conflict')
  expect(state.rows.size).toBe(1)
})
