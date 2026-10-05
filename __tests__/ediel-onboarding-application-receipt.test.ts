import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTenantContext } from '@/lib/tenant/context'
import type { CanonicalOnboardingCommand } from '@/lib/customers/canonicalOnboarding'

const io = vi.hoisted(() => ({ response: null as unknown, error: null as unknown, calls: [] as Array<{ name: string; args: Record<string, unknown> }> }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  rpc: async (name: string, args: Record<string, unknown>) => {
    io.calls.push({ name, args })
    return { data: io.response, error: io.error }
  },
} }))
import { onboardCustomerGraph } from '@/lib/customers/canonicalOnboarding'

const companyId = '00000000-0000-4000-8000-000000000001'
const actorId = '00000000-0000-4000-8000-000000000002'
const correlationId = '00000000-0000-4000-8000-000000000003'
const context = () => createTenantContext({ companyId, actorType: 'user', actorId, correlationId, sourceChannel: 'ediel_inbound', permissions: ['ediel.inbound.apply'] })
const success = () => ({
  ok: true, code: 'customer_onboarding_committed', operation_id: 'operation-1',
  correlation_id: correlationId, customer_id: 'customer-1', customer_number: 'DX-100001',
  application_id: 'application-1', site_id: 'site-1', metering_point_id: 'point-1',
})
const command = (): CanonicalOnboardingCommand => ({
  company_id: companyId, actor_user_id: actorId, channel: 'ediel_inbound',
  idempotency_key: 'ediel_inbound:source-case', customer: { full_name: 'Synthetic receipt fixture' },
  site: { facility_id: '735123456789012345' }, metering_point: { meter_point_id: '735123456789012345' },
  application: { source_record_type: 'ediel_inbound_case', source_record_id: 'source-case', payload_snapshot: { edielMessageId: 'source-message', prodatObjects: [], prodatRegisters: [] } },
})
beforeEach(() => { io.response = success(); io.error = null; io.calls = [] })

// These witnesses exercise the public client, not a new helper or missing export.
// Bad RPC output is synthetic; no claim is made that current SQL emits it.
for (const field of ['application_id', 'site_id', 'metering_point_id'] as const) {
  for (const [label, value] of [['missing', undefined], ['null', null], ['empty', ''], ['blank', ' \t '], ['number', 0], ['object', {}], ['array', []]] as const) {
    it(`rejects ${label} ${field} in an otherwise successful Ediel application`, async () => {
      io.response = { ...success(), [field]: value }
      await expect(onboardCustomerGraph(command(), context())).rejects.toMatchObject({ code: 'canonical_onboarding_incomplete_response', correlationId })
      expect(io.calls).toHaveLength(1)
      expect(io.calls[0].name).toBe('canonical_onboard_customer_graph')
    })
  }
}

it.each([
  ['string ok', { ok: 'true' }], ['numeric ok', { ok: 1 }],
  ['missing ok', { ok: undefined }], ['null ok', { ok: null }],
  ['unknown success code', { code: 'unrelated_success' }], ['false with success code', { ok: false }],
])('rejects malformed discriminants: %s', async (_label, patch) => {
  io.response = { ...success(), ...patch }
  await expect(onboardCustomerGraph(command(), context())).rejects.toMatchObject({ code: 'canonical_onboarding_invalid_response', correlationId })
  expect(io.calls).toHaveLength(1)
})
it('does not arbitrarily adopt the first of multiple Ediel receipts', async () => {
  io.response = [success(), { ...success(), application_id: 'other-application' }]
  await expect(onboardCustomerGraph(command(), context())).rejects.toMatchObject({ code: 'canonical_onboarding_invalid_response', correlationId })
  expect(io.calls).toHaveLength(1)
})

for (const shape of ['object', 'one-row'] as const) it(`preserves a complete ${shape} receipt and the exact source command`, async () => {
  const output = success(), input = command(), before = JSON.stringify(input)
  io.response = shape === 'object' ? output : [output]
  expect(await onboardCustomerGraph(input, context())).toBe(output)
  expect(io.calls).toHaveLength(1)
  expect(io.calls[0]).toMatchObject({ name: 'canonical_onboard_customer_graph', args: { p_command: { ...input, correlation_id: correlationId, matching_policy: 'link_unique' } } })
  expect(JSON.stringify(input)).toBe(before)
})
it('preserves an actual ambiguity result without inventing an application receipt', async () => {
  const output = { ok: false, code: 'ambiguous_customer_match', operation_id: 'operation-1', correlation_id: correlationId, candidate_customer_ids: ['customer-1', 'customer-2'] }
  io.response = output
  expect(await onboardCustomerGraph(command(), context())).toBe(output)
})
it('accepts the original correlation returned by idempotent replay', async () => {
  const output = { ...success(), correlation_id: '00000000-0000-4000-8000-000000000099' }
  io.response = output
  expect(await onboardCustomerGraph(command(), context())).toBe(output)
  expect(await onboardCustomerGraph(command(), context())).toBe(output)
  expect(io.calls.map(call => (call.args.p_command as CanonicalOnboardingCommand).idempotency_key)).toEqual(['ediel_inbound:source-case', 'ediel_inbound:source-case'])
})
for (const optional of [undefined, null, {}]) it(`does not require unrequested optional graph rows (${String(optional)})`, async () => {
  const input = { ...command(), site: optional, metering_point: optional }
  const output = { ...success(), site_id: null, metering_point_id: null }
  io.response = output
  expect(await onboardCustomerGraph(input, context())).toBe(output)
})
it('requires only the site when no meter payload was requested', async () => {
  const output = { ...success(), metering_point_id: null }
  io.response = output
  expect(await onboardCustomerGraph({ ...command(), metering_point: null }, context())).toBe(output)
})
it('requires only the meter when no site payload was requested', async () => {
  const output = { ...success(), site_id: null }
  io.response = output
  expect(await onboardCustomerGraph({ ...command(), site: null }, context())).toBe(output)
})
it('keeps a valid non-Ediel customer-only intake unchanged', async () => {
  const output = { ...success(), site_id: null, metering_point_id: null }
  io.response = output
  expect(await onboardCustomerGraph({ ...command(), channel: 'website', site: null, metering_point: null }, context())).toBe(output)
})
it('preserves the correlated RPC error and never retries automatically', async () => {
  io.error = { code: 'PGRST202', message: 'Could not find the function' }
  await expect(onboardCustomerGraph(command(), context())).rejects.toMatchObject({ code: 'canonical_onboarding_rpc_missing', correlationId })
  expect(io.calls).toHaveLength(1)
})
it('keeps the company boundary ahead of every RPC call', async () => {
  await expect(onboardCustomerGraph({ ...command(), company_id: 'other-company' }, context())).rejects.toMatchObject({ code: 'TENANT_CONTEXT_MISMATCH' })
  expect(io.calls).toEqual([])
})
it('keeps the actor boundary ahead of every RPC call', async () => {
  await expect(onboardCustomerGraph({ ...command(), actor_user_id: 'other-actor' }, context())).rejects.toMatchObject({ code: 'canonical_onboarding_actor_mismatch' })
  expect(io.calls).toEqual([])
})
