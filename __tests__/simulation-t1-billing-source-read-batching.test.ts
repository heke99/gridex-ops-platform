// simulation: T1/010, MAIN03.03
// Exercises the real source reader through its finite RPC port. These are
// component checks; they do not certify SQL performance or native acceptance.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Call = { company: string; ids: string[] }
const io = vi.hoisted(() => ({
  calls: [] as Call[],
  reply: null as null | ((ids: string[]) => unknown),
  error: null as unknown,
}))

vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  rpc: async (name: string, args: { p_company_id: string; p_value_ids: string[] }) => {
    expect(name).toBe('gridex_read_billing_source_values_v1')
    io.calls.push({ company: args.p_company_id, ids: [...args.p_value_ids] })
    return { data: io.reply ? io.reply(args.p_value_ids) : args.p_value_ids.map(row), error: io.error }
  },
} }))

import { loadQualifiedBillingValues } from '@/lib/billing/sourceBasis'

function row(id: string) {
  return { id, quantity_kwh: '1.25', billing_source_basis: {
    version: 1, normalizedValueId: id, quantityKwh: '1.25', qualified: true,
    sourceMessageId: `source-${id}`, sourcePayloadHash: 'a'.repeat(64),
  } }
}

const ids = (n: number) => Array.from({ length: n }, (_, i) => `value-${String(i).padStart(5, '0')}`)

beforeEach(() => { io.calls = []; io.reply = null; io.error = null })

describe('T1/010 bounded qualified billing-source reads', () => {
  it.each([0, 1, 250, 251, 1001, 2688])('reads all %i values without an RPC larger than 250', async n => {
    const requested = ids(n)
    const result = await loadQualifiedBillingValues('tenant-a', requested)
    expect(io.calls.map(call => call.ids.length)).toEqual(
      Array.from({ length: Math.ceil(n / 250) }, (_, i) => Math.min(250, n - i * 250)),
    )
    expect(io.calls.flatMap(call => call.ids)).toEqual(requested)
    expect(io.calls.every(call => call.company === 'tenant-a')).toBe(true)
    expect([...result.keys()]).toEqual(requested)
  })

  it('deduplicates input IDs across chunk boundaries and keeps every distinct result', async () => {
    const requested = ids(501)
    const result = await loadQualifiedBillingValues('tenant-b', [...requested, requested[0], requested[250]])
    expect(io.calls.flatMap(call => call.ids)).toEqual(requested)
    expect(io.calls.every(call => call.company === 'tenant-b')).toBe(true)
    expect(result.size).toBe(501)
  })

  it('groups interleaved sources while retaining exact ID-to-row identity and caller inputs', async () => {
    const requested = ids(701).reverse()
    const before = [...requested]
    const sourceOf = new Map(requested.map((id, i) => [id, `source-${i % 4}`]))
    const hintsBefore = [...sourceOf]
    // The database need not return rows in request order.
    io.reply = chunk => [...chunk].reverse().map(row)
    const result = await loadQualifiedBillingValues('tenant-a', requested, sourceOf)
    const expected = [...requested].sort((a, b) => sourceOf.get(a)!.localeCompare(sourceOf.get(b)!) || a.localeCompare(b))
    expect(io.calls.flatMap(call => call.ids)).toEqual(expected)
    expect(io.calls.every(call => call.ids.length <= 250)).toBe(true)
    for (const id of requested) expect(result.get(id)).toEqual(row(id))
    expect(requested).toEqual(before)
    expect([...sourceOf]).toEqual(hintsBefore)
  })

  it('treats missing or extra source hints only as ordering information', async () => {
    const requested = ['value-z', 'value-a', 'value-m']
    const result = await loadQualifiedBillingValues('tenant-a', requested, new Map([
      ['value-z', 'source-z'], ['outside-request', 'source-a'],
    ]))
    expect(io.calls.flatMap(call => call.ids)).toEqual(['value-a', 'value-m', 'value-z'])
    expect([...result.keys()].sort()).toEqual([...requested].sort())
  })

  const invalid: Array<{ name: string; reply: (id: string) => unknown }> = [
    { name: 'non-array response', reply: () => null },
    { name: 'duplicate result', reply: id => [row(id), row(id)] },
    { name: 'unrequested result', reply: () => [row('outside-request')] },
    { name: 'missing basis', reply: id => [{ id, quantity_kwh: '1.25' }] },
    { name: 'wrong basis version', reply: id => [{ ...row(id), billing_source_basis: { ...row(id).billing_source_basis, version: 2 } }] },
    { name: 'wrong basis identity', reply: id => [{ ...row(id), billing_source_basis: { ...row(id).billing_source_basis, normalizedValueId: 'other' } }] },
    { name: 'noncanonical quantity', reply: id => [{ ...row(id), quantity_kwh: '1.250', billing_source_basis: { ...row(id).billing_source_basis, quantityKwh: '1.250' } }] },
    { name: 'mismatched exact quantity', reply: id => [{ ...row(id), quantity_kwh: '2' }] },
  ]
  it.each(invalid)('still refuses $name', async ({ reply }) => {
    io.reply = chunk => reply(chunk[0])
    await expect(loadQualifiedBillingValues('tenant-a', ['value-a']))
      .rejects.toThrow('billing_source_basis_result_invalid')
  })

  it('still refuses a missing requested value', async () => {
    io.reply = () => []
    await expect(loadQualifiedBillingValues('tenant-a', ['value-a']))
      .rejects.toThrow('billing_source_basis_value_missing')
  })

  it('propagates the original RPC failure without masking its SQLSTATE', async () => {
    const error = { code: '57014', message: 'canceling statement due to statement timeout', details: 'original detail' }
    io.error = error
    await expect(loadQualifiedBillingValues('tenant-a', ids(251))).rejects.toBe(error)
    expect(io.calls).toHaveLength(1)
  })

  it('performs fresh qualification for a later call instead of reusing a cache', async () => {
    await loadQualifiedBillingValues('tenant-a', ['value-a'])
    const error = { code: '42501', message: 'source no longer available' }
    io.error = error
    await expect(loadQualifiedBillingValues('tenant-a', ['value-a'])).rejects.toBe(error)
    expect(io.calls).toHaveLength(2)
  })
})
