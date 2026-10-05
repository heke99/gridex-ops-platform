import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WEBSITE_INTEGRATION_CONTRACT_VERSION } from '@/lib/integrations/websiteIntegrationContract'

/**
 * Tenantservice P4a: customer support conversation over customer_cases.
 * In-memory PostgREST stand-in that stores rows and applies eq/in/json-path filters, so tests
 * assert real visibility and tenant/customer scoping instead of call shapes.
 */

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

vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: (table: string) => builder(table) } }))
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

describe('per-customer quotas (T10)', () => {
  it('refuses the 11th new case in a day with 429, but replays an existing idempotency key', async () => {
    const support = await import('@/lib/customer-service/supportConversation')
    for (let i = 0; i < support.SUPPORT_CUSTOMER_QUOTAS.newCasesPerDay; i += 1) await openCase(`quota-${i}`)
    await expect(openCase('quota-over')).rejects.toMatchObject({ code: 'support_quota_exceeded', status: 429 })
    const replay = await openCase('quota-0')
    expect(replay.reused).toBe(true)
    expect(db.customer_cases).toHaveLength(support.SUPPORT_CUSTOMER_QUOTAS.newCasesPerDay)
  })

  it('cases older than the window and other customers do not count', async () => {
    const support = await import('@/lib/customer-service/supportConversation')
    for (let i = 0; i < support.SUPPORT_CUSTOMER_QUOTAS.newCasesPerDay; i += 1) await openCase(`old-${i}`)
    for (const row of db.customer_cases) row.created_at = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
    await expect(openCase('fresh')).resolves.toBeTruthy()
    await expect(support.createCustomerSupportCase({
      companyId: TENANT_A, customerId: CUSTOMER_A2, apiClientId: 'client-a', portalIdentityId: null, title: 'Annan kund', message: 'Hej', idempotencyKey: 'a2-1',
    })).resolves.toBeTruthy()
  })

  it('refuses customer messages above the hourly quota with 429', async () => {
    const support = await import('@/lib/customer-service/supportConversation')
    const created = await openCase('msg-quota')
    const send = () => support.addCustomerSupportMessage({
      ...scopeA1, caseReference: created.case.case_reference, apiClientId: 'client-a', portalIdentityId: null, message: 'ping',
    })
    for (let i = 1; i < support.SUPPORT_CUSTOMER_QUOTAS.messagesPerHour; i += 1) await send()
    await expect(send()).rejects.toMatchObject({ code: 'support_quota_exceeded', status: 429 })
  })

  it('the API maps the quota error to HTTP 429', async () => {
    const { toSupportApiError } = await import('@/lib/customer-service/supportApi')
    const { SupportConversationError } = await import('@/lib/customer-service/supportConversation')
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
    expect(spec.info.version).toBe(WEBSITE_INTEGRATION_CONTRACT_VERSION)
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
