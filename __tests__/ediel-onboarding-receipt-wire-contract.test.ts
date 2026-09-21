import { beforeEach, expect, it, vi } from 'vitest'
import type { CanonicalOnboardingCommand } from '@/lib/customers/canonicalOnboarding'
import { createTenantContext } from '@/lib/tenant/context'

const io = vi.hoisted(() => ({ response: null as unknown, wire: [] as Record<string, unknown>[] }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  rpc: async (_name: string, args: Record<string, unknown>) => {
    // Exercise the JSON boundary actually used by the RPC transport, not only
    // JavaScript key presence. This is a transport mock, not a DB transaction.
    io.wire.push(JSON.parse(JSON.stringify(args)) as Record<string, unknown>)
    return { data: io.response, error: null }
  },
} }))
import { onboardCustomerGraph } from '@/lib/customers/canonicalOnboarding'

const correlationId = '00000000-0000-4000-8000-000000000013'
const context = () => createTenantContext({ companyId: 'company-1', actorType: 'system', actorId: 'receipt-wire-test', correlationId, sourceChannel: 'ediel_inbound' })
const command = (): CanonicalOnboardingCommand => ({ company_id: 'company-1', channel: 'ediel_inbound', idempotency_key: 'ediel:wire', customer: { full_name: 'Synthetic wire test' } })
const success = (): Record<string, unknown> => ({ ok: true, code: 'customer_onboarding_committed', operation_id: 'operation-1', correlation_id: correlationId, customer_id: 'customer-1', customer_number: 'DX-100001', application_id: 'application-1', site_id: null, metering_point_id: null })
beforeEach(() => { io.response = success(); io.wire = [] })

for (const field of ['site', 'metering_point'] as const) {
  it(`does not require a ${field} row for an undefined-only payload serialized as an empty object`, async () => {
    const input = { ...command(), [field]: { optional: undefined } }
    expect(Object.keys(input[field]!)).toEqual(['optional'])
    const output = io.response
    expect(await onboardCustomerGraph(input, context())).toBe(output)
    expect(io.wire).toHaveLength(1)
    expect((io.wire[0].p_command as Record<string, unknown>)[field]).toEqual({})
  })
  it(`does require a ${field} row for a null-valued property that remains on the wire`, async () => {
    await expect(onboardCustomerGraph({ ...command(), [field]: { optional: null } }, context())).rejects.toMatchObject({ code: 'canonical_onboarding_incomplete_response', correlationId })
    expect((io.wire[0].p_command as Record<string, unknown>)[field]).toEqual({ optional: null })
  })
}
for (const [label, patch] of [
  ['true paired with ambiguity', { ok: true, code: 'ambiguous_customer_match' }],
  ['false paired with unrelated code', { ok: false, code: 'unrelated' }],
  ['false paired with absent code', { ok: false, code: undefined }],
] as const) it(`rejects ${label}`, async () => {
  io.response = { ...success(), ...patch }
  await expect(onboardCustomerGraph(command(), context())).rejects.toMatchObject({ code: 'canonical_onboarding_invalid_response', correlationId })
  expect(io.wire).toHaveLength(1)
})
it('retains non-Ediel success without application_id instead of broadening the new gate', async () => {
  const output = success()
  delete output.application_id
  io.response = output
  expect(await onboardCustomerGraph({ ...command(), channel: 'website' }, context())).toBe(output)
})
it('rejects zero-row Ediel output', async () => {
  io.response = []
  await expect(onboardCustomerGraph(command(), context())).rejects.toMatchObject({ code: 'canonical_onboarding_invalid_response', correlationId })
  expect(io.wire).toHaveLength(1)
})
