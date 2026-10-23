// reality-defects: F97
// A production Z01 outbox row stored last_error = '[object Object]': supabase-js
// returns PostgREST failures as plain objects ({code,message,details,hint}) and
// `if (error) throw error` rethrows them, so String(error) lost the cause. The
// real outbox worker and the real manual production guard run here against
// substituted ports; every row value below is synthetic.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EdielMessageRow } from '@/lib/ediel/types'

const port = vi.hoisted(() => ({
  rows: new Map<string, Record<string, unknown>>(),
  messages: new Map<string, EdielMessageRow>(),
  lockReadError: null as Record<string, unknown> | null,
  sendFailure: null as unknown,
  postSendReadFailure: null as unknown,
  messageReads: 0,
  guardFailure: null as unknown,
  events: [] as Array<Record<string, unknown>>,
  statusUpdates: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  rpc: async (name: string, args: Record<string, unknown>) => {
    if (name !== 'claim_ediel_outbox_items') throw new Error(`Unexpected RPC: ${name}`)
    const claimedAt = new Date().toISOString()
    const rows = [...port.rows.values()].filter(row => row.status === 'queued')
    rows.forEach(row => { row.status = 'sending'; row.locked_by = args.p_worker_id; row.locked_at = claimedAt })
    return { data: rows.map(row => ({ ...row })), error: null }
  },
  from: (table: string) => {
    const filters: Array<[string, unknown]> = []
    let patch: Record<string, unknown> | null = null
    const result = () => {
      if (table === 'ediel_send_locks') return port.lockReadError ? { data: null, error: port.lockReadError } : { data: [], error: null }
      const row = [...port.rows.values()].find(row => filters.every(([field, value]) => row[field] === value))
      if (row && patch) Object.assign(row, patch)
      return { data: row ? { ...row } : null, error: null }
    }
    const query = {
      select: () => query, update: (value: Record<string, unknown>) => { patch = value; return query },
      eq: (field: string, value: unknown) => { filters.push([field, value]); return query },
      limit: async () => result(), maybeSingle: async () => result(),
    }
    return query
  },
} }))
vi.mock('@/lib/ediel/db', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/ediel/db')>(),
  getEdielMessageById: async (id: string) => {
    port.messageReads += 1
    if (port.messageReads > 1 && port.postSendReadFailure) throw port.postSendReadFailure
    return port.messages.get(id) ?? null
  },
  createEdielMessageEvent: async (input: Record<string, unknown>) => { port.events.push(input); return null },
  updateEdielMessageStatus: async (input: Record<string, unknown>) => { port.statusUpdates.push(input); return null },
}))
vi.mock('@/lib/ediel/transport', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/ediel/transport')>(),
  sendEdielMessageViaSmtp: async () => {
    if (port.sendFailure) throw port.sendFailure
    return { messageId: '<synthetic@example.invalid>', dispatchObservedAt: new Date().toISOString() }
  },
}))
vi.mock('@/lib/ediel/transport/acceptedProjection', () => ({ readAcceptedEdielTransportProjection: async () => null }))
vi.mock('@/lib/ediel/outbox/readinessGuard', () => ({ getEdielOutboundReadinessBlocker: async () => null }))
vi.mock('@/lib/ediel/outbox/routeContract', () => ({ evaluateEdielRouteContract: async () => ({ ok: true, fingerprint: 'fixture-route' }) }))
vi.mock('@/lib/ediel/outbox/projectSentSources', () => ({ projectSentEdielSourceState: async () => undefined }))
vi.mock('@/lib/tenant/operationPolicy', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/tenant/operationPolicy')>(),
  getTenantOperationDecision: async () => ({ allowed: true }),
}))
// Manual-send ports before the production guard (sendQueuedEdielMessage).
vi.mock('@/lib/ediel/production/sendValidationSources', () => ({ readFreshEdielSendValidationSources: async () => ({}) }))
vi.mock('@/lib/ediel/production/dateEventContext', () => ({ loadProdatDateEventValidationContext: async () => undefined }))
vi.mock('@/lib/ediel/recovery/reportingContext', () => ({ loadRecoveryReportingValidationContext: async () => null }))
vi.mock('@/lib/ediel/testing/tgtReportingPermissionContext', () => ({ loadTgtReportingValidationContext: async () => undefined }))
vi.mock('@/lib/ediel/testing/negativeFixtureAuthority', () => ({
  resolveSourceQualifiedNegativeFixtureForMessage: async () => null, sourceQualifiedNegativeFixtureAllowsPreflight: () => false,
}))
vi.mock('@/lib/ediel/core/messageBuilder', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/ediel/core/messageBuilder')>(),
  preflightEdielMessageRow: () => ({ blocking: false, issues: [] }),
}))
vi.mock('@/lib/ediel/core/productionGuards', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/ediel/core/productionGuards')>(),
  evaluateEdielProductionSendLock: () => ({ status: 'ok', locked: false, issues: [] }),
}))
vi.mock('@/lib/ediel/productionReadiness', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/ediel/productionReadiness')>(),
  assertCompanyCanSendProductionEdiel: async () => { throw port.guardFailure },
}))

import { processEdielOutbox } from '@/lib/ediel/outbox/processEdielOutbox'
import { edielStoredErrorMessage, EDIEL_UNREADABLE_ERROR } from '@/lib/ediel/outbox/storedErrorMessage'
import { sendQueuedEdielMessage } from '@/lib/ediel/orchestrator'

const company = '00000000-0000-4000-8000-000000000097'
// Synthetic private values that a PostgREST `details`/`hint` can carry.
const privateDetails = 'Failing row contains (synthetic.customer@example.invalid, 199001011234, 735999000000000097).'
const privateHint = 'Key (customer_ref)=(SYNTHETIC-CUSTOMER-97) already exists.'
const pgError = (code: string, message: string) => ({ code, message, details: privateDetails, hint: privateHint })

function expectReadable(stored: unknown, code: string, message: string) {
  expect(stored).toEqual(expect.stringContaining(code))
  expect(stored).toEqual(expect.stringContaining(message))
  expect(stored).not.toContain('[object Object]')
  expect(stored).not.toContain('synthetic.customer@example.invalid')
  expect(stored).not.toContain('199001011234')
  expect(stored).not.toContain('SYNTHETIC-CUSTOMER-97')
}

beforeEach(() => {
  port.rows.clear(); port.messages.clear(); port.events.length = 0; port.statusUpdates.length = 0
  port.lockReadError = null; port.sendFailure = null; port.postSendReadFailure = null; port.guardFailure = null; port.messageReads = 0
  port.messages.set('Z01', { id: 'Z01', company_id: company, environment: 'production', direction: 'outbound', status: 'prepared',
    message_family: 'PRODAT', message_code: 'Z01', raw_payload: "UNB+UNOC:3+1:14+2:14+261023:1200+F97'" } as EdielMessageRow)
  port.rows.set('Z01', { id: 'Z01', company_id: company, environment: 'production', ediel_message_id: 'Z01', status: 'queued', current_send_attempt_id: 'attempt-Z01' })
})

describe('F97: outbox worker stores a readable cause for PostgREST errors', () => {
  it('stores code and message when the transport rethrows a PostgREST error object', async () => {
    port.sendFailure = pgError('42501', 'permission denied for function wire_v1')
    const run = await processEdielOutbox({ actorUserId: 'worker-actor', limit: 25 })
    expect(run).toMatchObject({ processed: 1, failed: 1, sent: 0 })
    const row = port.rows.get('Z01')!
    expect(row.status).toBe('failed')
    expect(row.last_error).toBe('42501: permission denied for function wire_v1')
    expectReadable(row.last_error, '42501', 'permission denied for function wire_v1')
    expect(run.results[0].error).toBe(row.last_error)
  })

  it('stores a readable cause when the send-lock read itself fails', async () => {
    port.lockReadError = pgError('57014', 'canceling statement due to statement timeout')
    await processEdielOutbox({ actorUserId: 'worker-actor', limit: 25 })
    const row = port.rows.get('Z01')!
    expect(row.status).toBe('failed')
    expectReadable(row.last_error, '57014', 'canceling statement due to statement timeout')
  })

  it('keeps the readable cause after provider acceptance (delivery_uncertain)', async () => {
    port.postSendReadFailure = pgError('PGRST301', 'JWT expired')
    const run = await processEdielOutbox({ actorUserId: 'worker-actor', limit: 25 })
    expect(run).toMatchObject({ processed: 1, deliveryUncertain: 1 })
    const row = port.rows.get('Z01')!
    expect(row.status).toBe('delivery_uncertain')
    expect(row.last_error).toBe('delivery_uncertain_after_smtp_send: PGRST301: JWT expired')
    expectReadable(row.last_error, 'PGRST301', 'JWT expired')
  })

  it('stores a closed token, never [object Object], for an object without code or message', async () => {
    port.sendFailure = { details: privateDetails }
    await processEdielOutbox({ actorUserId: 'worker-actor', limit: 25 })
    const row = port.rows.get('Z01')!
    expect(row).toMatchObject({ status: 'failed', last_error: EDIEL_UNREADABLE_ERROR })
  })

  it('redacts personal data in a server message and drops a non code-shaped code', async () => {
    port.sendFailure = { code: 'not a code; synthetic.customer@example.invalid', message: 'duplicate contact synthetic.customer@example.invalid', details: privateDetails }
    await processEdielOutbox({ actorUserId: 'worker-actor', limit: 25 })
    const stored = String(port.rows.get('Z01')!.last_error)
    expect(stored).toBe('duplicate contact [REDACTED_EMAIL]')
  })

  it('leaves thrown Error messages and literal reasons unchanged', () => {
    expect(edielStoredErrorMessage(new Error('ediel_message_not_found'))).toBe('ediel_message_not_found')
    expect(edielStoredErrorMessage('outbox_item_missing_message')).toBe('outbox_item_missing_message')
    expect(edielStoredErrorMessage(null)).toBe(EDIEL_UNREADABLE_ERROR)
    const hostile = { get code(): string { throw new Error('getter') } }
    expect(edielStoredErrorMessage(hostile)).toBe(EDIEL_UNREADABLE_ERROR)
  })
})

describe('F97: manual production guard records a readable cause', () => {
  it('writes code and message to the event and failure_reason when the guard throws a PostgREST error', async () => {
    port.messages.set('Z01', { ...port.messages.get('Z01')!, status: 'queued' } as EdielMessageRow)
    const auditError = pgError('23503', 'insert or update on table "ediel_go_live_events" violates foreign key constraint "ediel_go_live_events_company_id_fkey"')
    port.guardFailure = auditError
    await expect(sendQueuedEdielMessage({ actorUserId: 'operator', edielMessageId: 'Z01' })).rejects.toBe(auditError)
    const guardEvent = port.events.find(event => (event.payload as Record<string, unknown> | undefined)?.phase === 'production_outbound_guard')
    expect(guardEvent).toBeDefined()
    expectReadable(guardEvent!.message, '23503', 'violates foreign key constraint')
    expectReadable((guardEvent!.payload as Record<string, unknown>).errorMessage, '23503', 'violates foreign key constraint')
    const failed = port.statusUpdates.find(update => update.status === 'failed')
    expectReadable(failed?.failureReason, '23503', 'violates foreign key constraint')
  })
})
