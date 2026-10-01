import { beforeEach, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const state = vi.hoisted(() => ({
  events: [] as Row[], applications: [] as Array<{name: string; args: Row}>,
  updates: [] as Array<{table: string; patch: Row; predicates: Row}>,
  applyError: null as unknown, markError: null as unknown, writeError: null as unknown,
  writeThrows: false,
}))
vi.mock('server-only', () => ({}))
// Worker readiness is an outer positive adapter in this bounded diagnostic proof.
vi.mock('@/lib/platform/schemaReadiness', () => ({ assertPlatformSchemaReady: async () => undefined }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  rpc: async (name: string, args: Row) => {
    state.applications.push({ name, args: structuredClone(args) })
    if (name === 'gridex_claim_invoice_provider_events') {
      for (const row of state.events) Object.assign(row, { status: 'processing', processing_token: args.p_processing_token })
      return {data: structuredClone(state.events), error: null}
    }
    if (name !== 'gridex_apply_invoice_provider_event_v1') throw new Error('unexpected_rpc')
    return args.p_event_id === state.events[0].id && state.applyError
      ? { data: null, error: state.applyError }
      : { data: {eventId: args.p_event_id, outcome: 'processed'}, error: null }
  },
  from: (table: string) => {
    const predicates: Row = {}
    let patch: Row = {}
    const run = async () => {
      state.updates.push({ table, patch: structuredClone(patch), predicates: structuredClone(predicates) })
      if (table === 'integration_api_write_idempotency') {
        if (state.writeThrows) throw state.writeError
        return {error: state.writeError}
      }
      if (table !== 'invoice_provider_events') throw new Error('unexpected_table')
      if (state.markError) return {data: null, error: state.markError}
      const row = state.events.find(row => Object.entries(predicates).every(([key, value]) => row[key] === value))
      if (row) Object.assign(row, patch)
      return {data: row ? {id: row.id} : null, error: null}
    }
    const query = {
      update: (value: Row) => { patch = value; return query },
      insert: (value: Row) => { patch = value; return query },
      eq: (key: string, value: unknown) => { predicates[key] = value; return query },
      select: () => query,
      maybeSingle: run,
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => run().then(resolve, reject),
    }
    return query
  },
} }))

import { processPendingInvoiceProviderEvents } from '@/lib/billing/providerEventProcessor'
import { claimIntegrationWriteIdempotency, failIntegrationWriteIdempotency } from '@/lib/integrations/writeIdempotency'

beforeEach(() => {
  state.events = [
    { id: 'SYN-EVENT-A', company_id: 'SYN-COMPANY-A', event_type: 'invoice.paid', payload: { invoiceGuid: 'SYN-GUID-A', amount_inc_vat: 125 } },
    { id: 'SYN-EVENT-B', company_id: 'SYN-COMPANY-B', event_type: 'invoice.overdue', payload: { invoiceGuid: 'SYN-GUID-B', amount_inc_vat: 250 } },
  ]
  state.applications = []; state.updates = []
  state.applyError = null; state.markError = null; state.writeError = null; state.writeThrows = false
})

it.each([
  { label: 'free five-letter provider code', error: {code: 'KARIN', message: 'SYN_PRIVATE_MESSAGE'} },
  { label: 'provider-prefixed free message', error: new Error('provider_customer_karin_secret_canary') },
])('actual provider worker omits $label from persisted/result diagnostics and continues the next claimed event', async entry => {
  state.applyError = entry.error
  const payloads = structuredClone(state.events.map(row => row.payload))
  const result = await processPendingInvoiceProviderEvents({limit: 2})
  expect(result).toMatchObject({processed: 1, failed: 1, results: [
    { eventId: 'SYN-EVENT-A', outcome: 'skipped', reason: 'provider_event_persistence_failed' },
    { eventId: 'SYN-EVENT-B', outcome: 'processed' },
  ]})
  expect(state.events[0].failure_reason).toBe('provider_event_persistence_failed')
  expect(state.events.map(row => row.payload)).toEqual(payloads)
  expect(state.updates[0].predicates).toMatchObject({ id: 'SYN-EVENT-A', company_id: 'SYN-COMPANY-A', status: 'processing', processing_token: expect.any(String) })
  expect(state.applications.filter(call => call.name === 'gridex_apply_invoice_provider_event_v1')).toHaveLength(2)
})

it('actual secondary failed-provider marking excludes a provider-prefixed customer canary from its console diagnostic', async () => {
  state.applyError = {code: '23503', message: 'SYN_PRIVATE_PRIMARY'}
  state.markError = new Error('provider_customer_karin_secret_canary')
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  try {
    expect(await processPendingInvoiceProviderEvents({limit: 2})).toMatchObject({processed: 1, failed: 1})
    expect(log).toHaveBeenCalledWith('[invoice-provider-events] failed to mark event', {eventId: 'SYN-EVENT-A', reason: 'provider_event_persistence_failed'})
    expect(JSON.stringify(log.mock.calls)).not.toContain('karin')
  } finally { log.mockRestore() }
})

it('actual provider SQLSTATE control preserves the existing category and token-bound failed status', async () => {
  state.applyError = {code: '23503', message: 'SYN_PRIVATE_NOT_LOGGED'}
  const result = await processPendingInvoiceProviderEvents({limit: 2})
  expect(result).toMatchObject({processed: 1, failed: 1, results: [{reason: 'provider_event_database_23503'}, {outcome: 'processed'}]})
  expect(state.events[0]).toMatchObject({ status: 'failed', failure_reason: 'provider_event_database_23503', processing_token: null })
})

it.each([false, true])('actual integration failed-state writer excludes free database code when thrown=%s', async thrown => {
  state.writeError = {code: 'SYN_CUSTOMER_KARIN_SECRET_CANARY', message: 'SYN_PRIVATE_MESSAGE'}
  state.writeThrows = thrown
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  try {
    expect(await failIntegrationWriteIdempotency({ recordId: 'SYN-RECORD', companyId: 'SYN-COMPANY', errorCode: 'idempotency_conflict' })).toBe(false)
    expect(log.mock.calls[0][1]).toEqual({recordId: 'SYN-RECORD', companyId: 'SYN-COMPANY', errorCode: null})
    expect(JSON.stringify(log.mock.calls)).not.toContain('KARIN')
    expect(state.updates).toEqual([{ table: 'integration_api_write_idempotency',
      predicates: {id: 'SYN-RECORD', company_id: 'SYN-COMPANY', status: 'processing'},
      patch: expect.objectContaining({status: 'failed', error_code: 'idempotency_conflict', response_status: null, response_body: null}),
    }])
  } finally { log.mockRestore() }
})

it('actual integration failure SQLSTATE control preserves the existing diagnostic code and false outcome', async () => {
  state.writeError = {code: '23503', message: 'SYN_PRIVATE_NOT_LOGGED'}
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  try {
    expect(await failIntegrationWriteIdempotency({recordId: 'SYN-RECORD', companyId: 'SYN-COMPANY', errorCode: 'idempotency_conflict'})).toBe(false)
    expect(log.mock.calls[0][1]).toEqual({recordId: 'SYN-RECORD', companyId: 'SYN-COMPANY', errorCode: '23503'})
  } finally { log.mockRestore() }
})

it('actual integration failure success control preserves the existing failed-row business payload with no error log', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  try {
    expect(await failIntegrationWriteIdempotency({recordId: 'SYN-RECORD', companyId: 'SYN-COMPANY', errorCode: 'idempotency_conflict'})).toBe(true)
    expect(log).not.toHaveBeenCalled()
    expect(state.updates[0].patch).toMatchObject({status: 'failed', error_code: 'idempotency_conflict'})
  } finally { log.mockRestore() }
})

it('actual claim retains the exact-code collision boundary instead of promoting padded 23505 into a readback', async () => {
  state.writeError = {code: ' 23505 ', message: 'SYN_PRIVATE_NOT_LOGGED'}
  await expect(claimIntegrationWriteIdempotency({companyId: 'SYN-COMPANY', apiClientId: 'SYN-CLIENT',
    route: '/api/v1/website/quote', idempotencyKey: 'synthetic-local-key-0001', payload: {fixed: true}}))
    .rejects.toMatchObject({code: 'idempotency_store_unavailable', status: 503})
  expect(state.updates).toHaveLength(1)
  expect(state.updates[0].patch).toMatchObject({company_id: 'SYN-COMPANY', api_client_id: 'SYN-CLIENT',
    status: 'processing', idempotency_key: 'synthetic-local-key-0001'})
})
