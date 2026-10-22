import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { API_DOCUMENTATION_VERSION } from '@/lib/integrations/websiteIntegrationContract'

/**
 * Tenantservice P4a: customer support conversation over customer_cases.
 * In-memory PostgREST stand-in that stores rows and applies eq/in/json-path filters, so tests
 * assert real visibility and tenant/customer scoping instead of call shapes.
 */

const rpc = vi.hoisted(() => vi.fn())

type Row = Record<string, unknown>
const db: Record<string, Row[]> = {}
let idCounter = 0
const nextId = () => `00000000-0000-4000-8000-${String(++idCounter).padStart(12, '0')}`

function readPath(row: Row, field: string): unknown {
  const json = /^(\w+)->>(\w+)$/.exec(field)
  if (json) {
    const value = (row[json[1]] as Row | null)?.[json[2]]
    return value === undefined || value === null ? null : String(value)
  }
  return row[field]
}

function builder(table: string) {
  const filters: Array<(row: Row) => boolean> = []
  let mode: 'select' | 'insert' | 'update' = 'select'
  let pending: Row[] = []
  let patch: Row = {}
  let limit: number | null = null
  let ascending = true
  let head = false
  const api: Record<string, unknown> = {
    select: (_columns?: string, options?: { head?: boolean }) => { head = Boolean(options?.head); return api },
    gte: (field: string, value: string) => { filters.push((row) => String(readPath(row, field)) >= value); return api },
    eq: (field: string, value: unknown) => { filters.push((row) => readPath(row, field) === value); return api },
    in: (field: string, values: unknown[]) => { filters.push((row) => values.includes(readPath(row, field))); return api },
    contains: (field: string, value: Row) => {
      filters.push((row) => Object.entries(value).every(([key, v]) => (row[field] as Row | null)?.[key] === v))
      return api
    },
    or: () => api,
    order: (_field: string, options?: { ascending?: boolean }) => { ascending = options?.ascending ?? true; return api },
    limit: (value: number) => { limit = value; return api },
    insert: (value: Row | Row[]) => {
      mode = 'insert'
      pending = (Array.isArray(value) ? value : [value]).map((row) => ({
        id: nextId(), created_at: new Date(Date.now() + idCounter).toISOString(), updated_at: new Date().toISOString(), metadata: {}, ...row,
      }))
      db[table] = [...(db[table] ?? []), ...pending]
      return api
    },
    update: (value: Row) => { mode = 'update'; patch = value; return api },
    rows(): Row[] {
      if (mode === 'insert') return pending
      const matched = (db[table] ?? []).filter((row) => filters.every((filter) => filter(row)))
      if (mode === 'update') { matched.forEach((row) => Object.assign(row, patch)); return matched }
      const sorted = [...matched].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) * (ascending ? 1 : -1))
      return limit === null ? sorted : sorted.slice(0, limit)
    },
    single: async () => ({ data: (api.rows as () => Row[])()[0] ?? null, error: null }),
    maybeSingle: async () => ({ data: (api.rows as () => Row[])()[0] ?? null, error: null }),
    then: (resolve: (value: unknown) => unknown) => {
      const rows = (api.rows as () => Row[])()
      return resolve({ data: head ? null : rows, count: rows.length, error: null })
    },
  }
  return api
}

vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: (table: string) => builder(table), rpc } }))
vi.mock('@/lib/customer-portal/keysetPagination', () => ({
  portalPageLimit: (value?: number | null) => Math.min(Math.max(Math.trunc(value ?? 50), 1), 100),
  decodePortalCursor: () => null,
  buildPortalDatabasePage: (rows: Row[], input: { limit: number }) => ({
    items: rows.slice(0, input.limit),
    page: { limit: input.limit, offset: 0, returned: Math.min(rows.length, input.limit), has_more: rows.length > input.limit, next_cursor: null },
  }),
}))

const TENANT_A = '0000000a-0000-4000-8000-000000000000'
const TENANT_B = '0000000b-0000-4000-8000-000000000000'
const CUSTOMER_A1 = '000000a1-0000-4000-8000-000000000000'
const CUSTOMER_A2 = '000000a2-0000-4000-8000-000000000000'
const CUSTOMER_B1 = '000000b1-0000-4000-8000-000000000000'
const STAFF_A = '0000057a-0000-4000-8000-000000000000'

beforeEach(() => {
  for (const key of Object.keys(db)) delete db[key]
  db.customers = [
    { id: CUSTOMER_A1, company_id: TENANT_A },
    { id: CUSTOMER_A2, company_id: TENANT_A },
    { id: CUSTOMER_B1, company_id: TENANT_B },
  ]
  db.customer_cases = []
  db.customer_case_events = []
  db.audit_logs = []
  // Synthetic transaction port for application/visibility tests. It delegates
  // ordinary case defaults to the unchanged shared command. Quota decisions
  // are injected responses here, never a second fake quota implementation;
  // real enforcement/rollback lives in customer-support-quota-sql.test.ts.
  rpc.mockReset().mockImplementation(async (name: string, args: Row) => {
    if (name === 'gridex_create_customer_support_case_v1') {
      const { createTenantSupportCase } = await import('@/lib/customer-cases/support')
      const { publicReference } = await import('@/lib/integrations/publicReferences')
      const created = await createTenantSupportCase({
        companyId: String(args.p_company_id), customerId: String(args.p_customer_id),
        title: String(args.p_title), description: String(args.p_message), category: String(args.p_category),
        channel: 'customer_portal', idempotencyKey: String(args.p_idempotency_key), actorUserId: null,
        metadata: { description_visibility: 'customer', opened_by: 'customer',
          api_client_id: args.p_api_client_id, portal_identity_id: args.p_portal_identity_id },
      })
      const row = db.customer_cases.find(value => value.id === created.case.id)!
      row.metadata = { ...(row.metadata as Row), support_public_reference: publicReference('support_case', String(args.p_company_id), row.id) }
      if (!db.customer_case_events.some(value => value.customer_case_id === row.id && value.event_type === 'support_customer_message')) {
        (builder('customer_case_events').insert as (row: Row) => unknown)({ company_id: args.p_company_id, customer_id: args.p_customer_id,
          customer_case_id: row.id, event_type: 'support_customer_message', event_status: 'info', message: row.description,
          created_by: null, payload: { visibility: 'customer', author_type: 'customer', channel: 'customer_portal',
            api_client_id: args.p_api_client_id, portal_identity_id: args.p_portal_identity_id } })
      }
      return { data: { case: row, reused: created.reused }, error: null }
    }
    if (name === 'gridex_add_customer_support_message_v1') {
      const query = builder('customer_case_events')
      ;(query.insert as (row: Row) => unknown)({ company_id: args.p_company_id, customer_id: args.p_customer_id,
        customer_case_id: args.p_case_id, event_type: 'support_customer_message', event_status: 'info', message: args.p_message,
        created_by: null, payload: { visibility: 'customer', author_type: 'customer', channel: 'customer_portal',
          api_client_id: args.p_api_client_id, portal_identity_id: args.p_portal_identity_id } })
      return (query.single as () => Promise<{ data: Row; error: null }>)()
    }
    throw new Error('Unexpected synthetic transaction port')
  })
})

const scopeA1 = { companyId: TENANT_A, customerId: CUSTOMER_A1 }

async function openCase(key = 'key-1') {
  const support = await import('@/lib/customer-service/supportConversation')
  return support.createCustomerSupportCase({
    ...scopeA1, apiClientId: 'client-a', portalIdentityId: 'ident-a1', title: 'Fel på fakturan', message: 'Jag har fått fel belopp.', idempotencyKey: key,
  })
}

describe('scenario A: web case → OPS reply → customer sees only customer-visible content', () => {
  it('customer creates a case; staff reply is visible, internal note and phone log are not', async () => {
    const support = await import('@/lib/customer-service/supportConversation')
    const created = await openCase()
    expect(created.case.case_reference).toMatch(/^support_case_/)
    expect(created.case.description).toBe('Jag har fått fel belopp.')

    const caseRow = db.customer_cases[0]
    const staffScope = { ...scopeA1, caseId: String(caseRow.id), actorUserId: STAFF_A }
    await support.addInternalNote({ ...staffScope, message: 'Kunden verkar ha dubbla avtal — kontrollera.' })
    await support.recordPhoneInteraction({
      ...staffScope, direction: 'inbound', summary: 'Kunden ringde om beloppet.', verificationMethod: 'strong_eid', verificationReference: 'eid-tx-123',
    })
    await support.replyToCustomer({ ...staffScope, message: 'Vi har rättat fakturan.' })

    const messages = await support.listCustomerSupportMessages(scopeA1, String(caseRow.id))
    expect(messages.map((message) => message.body)).toEqual(['Jag har fått fel belopp.', 'Vi har rättat fakturan.'])
    expect(messages.map((message) => message.author_type)).toEqual(['customer', 'staff'])
    const serialized = JSON.stringify(messages)
    expect(serialized).not.toContain('dubbla avtal')
    expect(serialized).not.toContain('Kunden ringde')
    expect(serialized).not.toContain('eid-tx-123')
    expect(serialized).not.toContain(STAFF_A)
  })

  it('a technical/status event with visibility customer but non-public type is still hidden', async () => {
    const support = await import('@/lib/customer-service/supportConversation')
    await openCase()
    const caseId = String(db.customer_cases[0].id)
    db.customer_case_events.push({
      id: nextId(), company_id: TENANT_A, customer_id: CUSTOMER_A1, customer_case_id: caseId, event_type: 'status_changed',
      message: 'intern statusorsak', payload: { visibility: 'customer' }, created_at: new Date().toISOString(),
    })
    const messages = await support.listCustomerSupportMessages(scopeA1, caseId)
    expect(JSON.stringify(messages)).not.toContain('intern statusorsak')
  })
})

describe('scenario D: phone summary is published explicitly and labelled as staff', () => {
  it('phone summary appears only after explicit publication, as staff phone_summary', async () => {
    const support = await import('@/lib/customer-service/supportConversation')
    await openCase()
    const staffScope = { ...scopeA1, caseId: String(db.customer_cases[0].id), actorUserId: STAFF_A }
    await support.recordPhoneInteraction({ ...staffScope, direction: 'inbound', summary: 'Samtal om faktura.', verificationMethod: 'callback_registered_number' })
    let messages = await support.listCustomerSupportMessages(scopeA1, staffScope.caseId)
    expect(messages).toHaveLength(1)
    await support.replyToCustomer({ ...staffScope, message: 'Sammanfattning av samtalet: fakturan rättas.', kind: 'phone_summary' })
    messages = await support.listCustomerSupportMessages(scopeA1, staffScope.caseId)
    expect(messages.at(-1)).toMatchObject({ author_type: 'staff', kind: 'phone_summary' })
  })

  it('records an unidentified caller as limited intake without customer access', async () => {
    const support = await import('@/lib/customer-service/supportConversation')
    await openCase()
    const staffScope = { ...scopeA1, caseId: String(db.customer_cases[0].id), actorUserId: STAFF_A }
    await support.recordPhoneInteraction({ ...staffScope, direction: 'inbound', summary: 'Okänd uppringare.', verificationMethod: 'unverified' })
    const log = db.customer_case_events.find((row) => row.event_type === 'support_phone_interaction') as Row
    expect((log.payload as Row).visibility).toBe('internal')
    expect(((log.payload as Row).verification as Row).grants_customer_access).toBe(false)
    expect(support.phoneVerificationAllowsCustomerAccess('unverified')).toBe(false)
  })
})

describe('tenant and customer isolation', () => {
  it('another customer in the same tenant, or another tenant, cannot read or write the case', async () => {
    const support = await import('@/lib/customer-service/supportConversation')
    const created = await openCase()
    const reference = created.case.case_reference

    await expect(support.findCustomerSupportCase({ companyId: TENANT_A, customerId: CUSTOMER_A2 }, reference)).rejects.toMatchObject({ code: 'support_case_not_found' })
    await expect(support.findCustomerSupportCase({ companyId: TENANT_B, customerId: CUSTOMER_B1 }, reference)).rejects.toMatchObject({ code: 'support_case_not_found' })
    await expect(support.addCustomerSupportMessage({
      companyId: TENANT_A, customerId: CUSTOMER_A2, caseReference: reference, apiClientId: 'client-a', portalIdentityId: null, message: 'hej',
    })).rejects.toMatchObject({ code: 'support_case_not_found' })
    expect((await support.listCustomerSupportCases({ companyId: TENANT_A, customerId: CUSTOMER_A2 }, {})).items).toEqual([])
  })

  it('staff of tenant B cannot act on tenant A case by id', async () => {
    const support = await import('@/lib/customer-service/supportConversation')
    await openCase()
    const caseId = String(db.customer_cases[0].id)
    await expect(support.replyToCustomer({ companyId: TENANT_B, customerId: CUSTOMER_A1, caseId, actorUserId: STAFF_A, message: 'x' }))
      .rejects.toMatchObject({ code: 'support_case_not_found' })
  })

  it('non-support (internal) cases of the customer are not listed', async () => {
    const support = await import('@/lib/customer-service/supportConversation')
    db.customer_cases.push({ id: nextId(), company_id: TENANT_A, customer_id: CUSTOMER_A1, title: 'Ångerrätt intern', status: 'open', metadata: {}, created_at: new Date().toISOString() })
    expect((await support.listCustomerSupportCases(scopeA1, {})).items).toEqual([])
  })
})

describe('idempotency and lifecycle', () => {
  it('same idempotency key does not duplicate the case or the first message', async () => {
    await openCase('same-key')
    await openCase('same-key')
    expect(db.customer_cases).toHaveLength(1)
    expect(db.customer_case_events.filter((row) => row.event_type === 'support_customer_message')).toHaveLength(1)
  })

  it('retry after a crash between case insert and first message completes the missing message once', async () => {
    await openCase('crash-key')
    db.customer_case_events = []
    await openCase('crash-key')
    await openCase('crash-key')
    expect(db.customer_cases).toHaveLength(1)
    expect(db.customer_case_events.filter((row) => row.event_type === 'support_customer_message')).toHaveLength(1)
  })

  it('a closed case refuses new customer messages', async () => {
    const support = await import('@/lib/customer-service/supportConversation')
    const created = await openCase()
    db.customer_cases[0].status = 'closed'
    await expect(support.addCustomerSupportMessage({
      ...scopeA1, caseReference: created.case.case_reference, apiClientId: 'client-a', portalIdentityId: null, message: 'en till',
    })).rejects.toMatchObject({ code: 'support_case_closed' })
  })

  it('maps internal statuses to the customer-visible status vocabulary', async () => {
    const { publicSupportStatus } = await import('@/lib/customer-service/supportConversation')
    expect(publicSupportStatus('open')).toBe('received')
    expect(publicSupportStatus('billing_blocked')).toBe('in_progress')
    expect(publicSupportStatus('resolved')).toBe('resolved')
    expect(publicSupportStatus('cancelled')).toBe('closed')
  })
})

describe('atomic quota transaction boundary (T10)', () => {
  it('delegates case admission and creation together, with no client-controlled limits or time', async () => {
    const created = await openCase('rpc-case')
    expect(created.case.description).toBe('Jag har fått fel belopp.')
    expect(rpc).toHaveBeenCalledExactlyOnceWith('gridex_create_customer_support_case_v1', {
      p_company_id: TENANT_A, p_customer_id: CUSTOMER_A1, p_api_client_id: 'client-a', p_portal_identity_id: 'ident-a1',
      p_title: 'Fel på fakturan', p_message: 'Jag har fått fel belopp.', p_category: 'support', p_idempotency_key: 'rpc-case',
    })
  })

  it('maps the authoritative case quota rejection to 429 without a fallback write', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'support_case_quota_exceeded' } })
    await expect(openCase('denied')).rejects.toMatchObject({ code: 'support_quota_exceeded', status: 429 })
    expect(db.customer_cases).toEqual([])
    expect(db.customer_case_events).toEqual([])
  })

  it('maps message quota rejection to 429 without a separate event insert', async () => {
    const support = await import('@/lib/customer-service/supportConversation')
    const created = await openCase('message-quota')
    const before = db.customer_case_events.length
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'support_message_quota_exceeded' } })
    await expect(support.addCustomerSupportMessage({
      ...scopeA1, caseReference: created.case.case_reference, apiClientId: 'client-a', portalIdentityId: null, message: 'ping',
    })).rejects.toMatchObject({ code: 'support_quota_exceeded', status: 429 })
    expect(db.customer_case_events).toHaveLength(before)
  })

  it('does not fall back to non-atomic writes during an RPC outage', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: '08006', message: 'synthetic transaction unavailable' } })
    await expect(openCase('outage')).rejects.toMatchObject({ code: '08006' })
    expect(db.customer_cases).toEqual([])
    expect(db.customer_case_events).toEqual([])
  })

  it('rejects malformed or foreign transaction results without exposing them', async () => {
    rpc.mockResolvedValueOnce({ data: { case: { id: nextId(), company_id: TENANT_B, customer_id: CUSTOMER_A1 } }, error: null })
    await expect(openCase('foreign-result')).rejects.toThrow('support_customer_case_result_invalid')
  })

  it('preserves the closed-case response if the SQL admission recheck loses a race with closing', async () => {
    const support = await import('@/lib/customer-service/supportConversation')
    const created = await openCase('close-race')
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'support_case_closed' } })
    await expect(support.addCustomerSupportMessage({
      ...scopeA1, caseReference: created.case.case_reference, apiClientId: 'client-a', portalIdentityId: null, message: 'ping',
    })).rejects.toMatchObject({ code: 'support_case_closed', status: 409 })
  })

  it('keeps the published quota values and API error contract', async () => {
    const { toSupportApiError } = await import('@/lib/customer-service/supportApi')
    const { SupportConversationError, SUPPORT_CUSTOMER_QUOTAS } = await import('@/lib/customer-service/supportConversation')
    expect(SUPPORT_CUSTOMER_QUOTAS).toEqual({ newCasesPerDay: 50, messagesPerHour: 150 })
    expect(toSupportApiError(new SupportConversationError('support_quota_exceeded', 'x', 429))).toMatchObject({ status: 429, code: 'support_quota_exceeded' })
  })
})

describe('OPS adapters', () => {
  const actions = readFileSync('app/admin/customer-cases/actions.ts', 'utf8')
  it('every support action requires cases.write and refuses a tenant switched in another tab', () => {
    expect(actions).toContain("supportCaseScope(formData, 'cases.write')")
    expect(actions).toContain('expected_company_id')
    expect(actions.match(/assertFormTenant\(/g)?.length).toBeGreaterThanOrEqual(3)
  })
  it('API routes are thin adapters mounted with the current contract release', async () => {
    const route = readFileSync('app/api/v1/customer/support/cases/route.ts', 'utf8')
    expect(route).toContain("from '@/lib/customer-service/supportApiHandlers'")
    const spec = JSON.parse(readFileSync('docs/openapi/customer-portal-v1.json', 'utf8'))
    expect(spec.info.version).toBe(API_DOCUMENTATION_VERSION)
    expect(Object.keys(spec.paths)).toEqual(expect.arrayContaining([
      '/api/v1/customer/support/cases',
      '/api/v1/customer/support/cases/{reference}',
      '/api/v1/customer/support/cases/{reference}/messages',
      '/api/v1/customer/support/cases/{reference}/attachments',
      '/api/v1/customer/support/cases/{reference}/attachments/{attachmentReference}',
    ]))
    const serialized = JSON.stringify(spec.components.schemas.CustomerSupportMessage)
    expect(serialized).not.toContain('internal')
  })
})
