import { beforeEach, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const fixture = vi.hoisted(() => ({
  events: [] as Row[], results: {} as Record<string, { data: unknown; error: unknown }>,
  calls: [] as Array<{ name: string; args: Row }>, tables: [] as string[],
  markError: null as unknown,
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/platform/schemaReadiness', () => ({ assertPlatformSchemaReady: async () => undefined }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  rpc: async (name: string, args: Row) => {
    fixture.calls.push({ name, args: structuredClone(args) })
    if (name === 'gridex_claim_invoice_provider_events') {
      fixture.events.forEach(row => { row.processing_token = args.p_processing_token; row.status = 'processing' })
      return { data: structuredClone(fixture.events), error: null }
    }
    if (name !== 'gridex_apply_invoice_provider_event_v1') throw new Error('unexpected_provider_boundary')
    return fixture.results[String(args.p_event_id)]
  },
  from: (table: string) => {
    fixture.tables.push(table)
    if (table !== 'invoice_provider_events') throw new Error('legacy_provider_writer_reached')
    const predicates: Array<(row: Row) => boolean> = []
    let patch: Row = {}
    const chain = {
      update: (value: Row) => { patch = value; return chain }, select: () => chain,
      eq: (key: string, value: unknown) => { predicates.push(row => row[key] === value); return chain },
      maybeSingle: async () => {
        if (fixture.markError) return { data: null, error: fixture.markError }
        const row = fixture.events.find(row => predicates.every(predicate => predicate(row)))
        if (row) Object.assign(row, patch)
        return { data: row ? { id: row.id } : null, error: null }
      },
    }
    return chain
  },
} }))
import { processPendingInvoiceProviderEvents } from '@/lib/billing/providerEventProcessor'

beforeEach(() => {
  fixture.events = [
    { id: 'synthetic-event-a', company_id: 'synthetic-company-a', event_type: 'invoice.paid',
      payload: { invoice_number: 'SYNTHETIC-1', finance_status: '2' } },
    { id: 'synthetic-event-b', company_id: 'synthetic-company-b', event_type: 'invoice.overdue', payload: {} },
  ]
  fixture.results = Object.fromEntries(fixture.events.map(row => [String(row.id),
    { data: { eventId: row.id, outcome: 'processed', reason: null }, error: null }]))
  fixture.calls = []; fixture.tables = []; fixture.markError = null
})

it('classifies with existing mapper and delegates each claimed snapshot to one atomic current-row command', async () => {
  expect(await processPendingInvoiceProviderEvents({ limit: 2 })).toMatchObject({ processed: 2, failed: 0 })
  const writes = fixture.calls.filter(call => call.name === 'gridex_apply_invoice_provider_event_v1')
  expect(writes).toHaveLength(2)
  expect(writes[0].args).toMatchObject({ p_company_id: 'synthetic-company-a', p_event_id: 'synthetic-event-a',
    p_event_type: 'invoice.paid', p_payload: fixture.events[0].payload, p_state: 'paid', p_finance_status: 'purchased_without_recourse' })
  expect(writes[1].args).toMatchObject({ p_company_id: 'synthetic-company-b', p_state: 'overdue', p_finance_status: null })
  expect(writes.every(call => call.args.p_processing_token === fixture.events[0].processing_token)).toBe(true)
  expect(fixture.tables).toEqual([])
})

it('persists a safe SQLSTATE category from a plain Supabase error and continues the next tenant', async () => {
  fixture.results['synthetic-event-a'] = { data: null, error: { code: '23503', message: 'synthetic private detail' } }
  expect(await processPendingInvoiceProviderEvents({ limit: 2 })).toMatchObject({ processed: 1, failed: 1 })
  expect(fixture.events[0]).toMatchObject({ status: 'failed', processing_token: null, failure_reason: 'provider_event_database_23503' })
  expect(fixture.calls.filter(call => call.name === 'gridex_apply_invoice_provider_event_v1')).toHaveLength(2)
  expect(fixture.tables).toEqual(['invoice_provider_events'])
})

it('retains existing finite-number precedence while passing the exact payload snapshot', async () => {
  const cases = [
    { payload: { amount_inc_vat: '125,50', amountIncVat: 999, currency: ' SEK ' }, amount: 125.5, currency: 'SEK' },
    { payload: { amount_inc_vat: 'invalid', amountIncVat: '0x7d', currency: 123 }, amount: 125, currency: null },
    { payload: { amount_inc_vat: 'Infinity', amountIncVat: true, total_amount: 125 }, amount: 125, currency: null },
  ]
  for (const entry of cases) {
    fixture.events[0].payload = entry.payload
    await processPendingInvoiceProviderEvents({ limit: 2 })
    const calls = fixture.calls.filter(call => call.name === 'gridex_apply_invoice_provider_event_v1')
    expect(calls.at(-2)?.args).toMatchObject({ p_payload: entry.payload, p_amount: entry.amount, p_currency: entry.currency })
  }
})

it('plain persistence errors get an actionable safe category rather than unknown_error or raw details', async () => {
  fixture.results['synthetic-event-a'] = { data: null, error: { message: 'synthetic_invoice_projection_unavailable' } }
  await processPendingInvoiceProviderEvents({ limit: 2 })
  expect(fixture.events[0].failure_reason).toBe('provider_event_persistence_failed')
})

it('a failure-record write error emits only a safe category and still processes the next tenant', async () => {
  fixture.results['synthetic-event-a'] = { data: null, error: { code: '23503', message: 'synthetic private application detail' } }
  fixture.markError = { code: '22P02', message: 'synthetic private customer detail', details: 'synthetic credential detail' }
  const output = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  try {
    expect(await processPendingInvoiceProviderEvents({ limit: 2 })).toMatchObject({ processed: 1, failed: 1 })
    expect(output).toHaveBeenCalledWith('[invoice-provider-events] failed to mark event', {
      eventId: 'synthetic-event-a', reason: 'provider_event_database_22P02',
    })
    expect(JSON.stringify(output.mock.calls)).not.toContain('private')
    expect(JSON.stringify(output.mock.calls)).not.toContain('credential')
  } finally { output.mockRestore() }
})

it('missing atomic schema fails closed without reaching legacy item or portal writers', async () => {
  fixture.results['synthetic-event-a'] = { data: null, error: { code: 'PGRST202', message: 'missing atomic command' } }
  expect(await processPendingInvoiceProviderEvents({ limit: 2 })).toMatchObject({ processed: 1, failed: 1 })
  expect(fixture.tables).toEqual(['invoice_provider_events'])
})

it('rejects an incorrectly bound command result and retains the claimed event as failed', async () => {
  fixture.results['synthetic-event-a'] = { data: { eventId: 'another-event', outcome: 'processed' }, error: null }
  await processPendingInvoiceProviderEvents({ limit: 2 })
  expect(fixture.events[0]).toMatchObject({ status: 'failed', failure_reason: 'provider_event_atomic_result_invalid' })
})
