import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * F12: personal / organization number changes. In-memory tables; the decision RPC is modelled on
 * gridex_decide_customer_identity_change_v1 (state checks + customer update + events).
 */

type Row = Record<string, unknown>
const db: Record<string, Row[]> = {}
const sent: Array<Record<string, unknown>> = []
const rpcCalls: Array<Record<string, unknown>> = []
let emailFails = false
let n = 0

function query(table: string) {
  const filters: Array<(row: Row) => boolean> = []
  let pending: Row[] | null = null
  let head = false
  const api: Record<string, unknown> = {
    select: (_c?: string, options?: { head?: boolean }) => { if (options?.head) head = true; return api },
    eq: (f: string, v: unknown) => { filters.push((r) => r[f] === v); return api },
    in: (f: string, v: unknown[]) => { filters.push((r) => v.includes(r[f])); return api },
    order: () => api,
    limit: () => api,
    insert: (value: Row) => {
      const row: Row = { id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, created_at: new Date().toISOString(), ...value }
      if (table === 'customer_identity_change_requests' && (db[table] ?? []).some((r) => r.status === 'pending_customer_approval' && r.customer_id === row.customer_id && r.field === row.field)) {
        pending = []
        ;(api as { conflict?: boolean }).conflict = true
        return api
      }
      db[table] = [...(db[table] ?? []), row]
      pending = [row]
      return api
    },
    rows: () => pending ?? (db[table] ?? []).filter((r) => filters.every((f) => f(r))),
    single: async () => ((api as { conflict?: boolean }).conflict ? { data: null, error: { code: '23505' } } : { data: (api.rows as () => Row[])()[0] ?? null, error: null }),
    maybeSingle: async () => ({ data: (api.rows as () => Row[])()[0] ?? null, error: null }),
    then: (resolve: (v: unknown) => unknown) => {
      const rows = (api.rows as () => Row[])()
      return resolve({ data: head ? null : rows, count: rows.length, error: null })
    },
  }
  return api
}

function decideRpc(params: Row) {
  rpcCalls.push(params)
  const request = (db.customer_identity_change_requests ?? []).find((r) => r.id === params.p_request_id && r.company_id === params.p_company_id)
  if (!request) return { data: null, error: { message: 'identity_change_not_found' } }
  if (request.status !== 'pending_customer_approval') return { data: null, error: { message: 'identity_change_not_pending' } }
  if (params.p_outcome === 'applied' && request.approval_required && params.p_decided_by !== 'customer') return { data: null, error: { message: 'identity_change_requires_customer_approval' } }
  if (params.p_outcome === 'applied' && request.takeover_required) {
    const acceptance = params.p_acceptance as { snapshot_sha256?: string; confirmations?: Record<string, boolean> } | null
    const c = acceptance?.confirmations
    if (!acceptance || acceptance.snapshot_sha256 !== request.takeover_snapshot_sha256 || !c?.identity || !c.contracts || !c.terms) {
      return { data: null, error: { message: 'identity_change_takeover_acceptance_required' } }
    }
    request.acceptance_evidence = acceptance
  }
  if (params.p_outcome === 'applied') {
    const customer = db.customers.find((c) => c.id === request.customer_id && c.company_id === request.company_id) as Row
    if ((customer[request.field as string] ?? null) !== request.previous_value) return { data: null, error: { message: 'identity_change_stale' } }
    customer[request.field as string] = request.new_value
  }
  request.status = params.p_outcome
  db.customer_identity_change_events.push({ id: `e${++n}`, request_id: request.id, event_type: params.p_outcome, actor_kind: params.p_decided_by, customer_id: request.customer_id, company_id: request.company_id })
  return { data: { status: params.p_outcome, request_id: request.id }, error: null }
}

vi.mock('@/lib/supabase/tenantQuery', () => ({
  tenantSelect: (companyId: string, table: string, columns: string, options?: { head?: boolean }) =>
    ((query(table).select as (c: string, o?: unknown) => unknown)(columns, options) as { eq: (f: string, v: unknown) => unknown }).eq('company_id', companyId),
  tenantInsert: (companyId: string, table: string, values: Row) => (query(table).insert as (v: Row) => unknown)({ company_id: companyId, ...values }),
}))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from: (table: string) => query(table),
    rpc: async (name: string, params: Row) => name === 'gridex_find_customer_identity_change_by_token_v1'
      ? { data: (db.customer_identity_change_requests ?? []).filter((r) => r.token_hash === params.p_token_hash), error: null }
      : decideRpc(params),
  },
}))
vi.mock('@/lib/tenant/emailBranding', () => ({
  queueAndTrySendTenantEmail: async (input: Record<string, unknown>) => {
    if (emailFails) throw new Error('sender not ready')
    sent.push(input)
    return { outboxId: 'o1', ok: true }
  },
}))
vi.mock('@/lib/auth/urls', () => ({ getBaseAppUrl: () => 'https://app.example.test' }))

const A = '0000000a-0000-4000-8000-000000000000'
const B = '0000000b-0000-4000-8000-000000000000'
const CUSTOMER = '000000c1-0000-4000-8000-000000000000'
const STAFF = '000000f1-0000-4000-8000-000000000000'

beforeEach(() => {
  for (const key of Object.keys(db)) delete db[key]
  db.customers = [{ id: CUSTOMER, company_id: A, customer_type: 'private', customer_number: 'K-1001', personal_number: '19121212-1212', org_number: null, email: 'Kund@Example.test', full_name: 'Test Kund', status: 'active' }]
  db.legal_bundle_versions = [{ id: 'lb1', company_id: A }, { id: 'lbX', company_id: B }]
  db.legal_bundle_version_documents = [
    { legal_bundle_version_id: 'lb1', title: 'Allmänna avtalsvillkor', content_sha256: 'a'.repeat(64), sort_order: 1, rendered_body: 'Villkorstext A' },
    { legal_bundle_version_id: 'lbX', title: 'Annan tenants villkor', content_sha256: 'b'.repeat(64), sort_order: 1, rendered_body: 'Får inte visas' },
  ]
  db.companies = [{ id: A, name: 'Elbolaget' }]
  db.customer_contracts = []
  db.customer_identity_change_requests = []
  db.customer_identity_change_events = []
  sent.length = 0
  rpcCalls.length = 0
  emailFails = false
})

const base = { companyId: A, customerId: CUSTOMER, field: 'personal_number' as const, reason: 'Felregistrerat vid avtal', actorUserId: STAFF }

describe('F12 identity change', () => {
  it('validates the number, the reason and that it actually changes', async () => {
    const { requestCustomerIdentityChange } = await import('@/lib/customer-service/identityChange')
    await expect(requestCustomerIdentityChange({ ...base, newValue: '19900101-1234' })).rejects.toMatchObject({ code: 'personal_number_invalid' })
    await expect(requestCustomerIdentityChange({ ...base, newValue: '811218-9876', reason: 'x' })).rejects.toMatchObject({ code: 'identity_change_reason_required' })
    await expect(requestCustomerIdentityChange({ ...base, newValue: '121212-1212' })).rejects.toMatchObject({ code: 'identity_change_unchanged' })
    await expect(requestCustomerIdentityChange({ ...base, field: 'org_number', newValue: '556016-0680' })).rejects.toMatchObject({ code: 'identity_field_mismatch' })
    expect(db.customer_identity_change_requests).toHaveLength(0)
  })

  it('without contracts: applied at once by staff, with history and no e-mail', async () => {
    const { requestCustomerIdentityChange } = await import('@/lib/customer-service/identityChange')
    const result = await requestCustomerIdentityChange({ ...base, newValue: '811218-9876' })
    expect(result.status).toBe('applied')
    expect(db.customers[0].personal_number).toBe('19811218-9876')
    expect(sent).toHaveLength(0)
    expect(db.customer_identity_change_events.map((e) => e.event_type)).toEqual(['requested', 'applied'])
    const requested = db.customer_identity_change_events[0]
    expect(requested).toMatchObject({ actor_kind: 'staff', actor_user_id: STAFF, previous_value_masked: '••••1212', new_value_masked: '••••9876' })
    expect(JSON.stringify(db.customer_identity_change_events)).not.toContain('19811218')
  })

  it('retains durable staff API origin and client attribution without exposing identity values in events', async () => {
    const { requestCustomerIdentityChange } = await import('@/lib/customer-service/identityChange')
    await requestCustomerIdentityChange({ ...base, newValue: '811218-9876', channel: 'staff_api', apiClientId: 'client-1' })
    expect(db.customer_identity_change_requests[0]).toMatchObject({ source_channel: 'staff_api', api_client_id: 'client-1', requested_by: STAFF })
    expect(db.customer_identity_change_events[0]).toMatchObject({ actor_user_id: STAFF, detail: expect.objectContaining({ channel: 'staff_api', api_client_id: 'client-1' }) })
    expect(JSON.stringify(db.customer_identity_change_events)).not.toContain('19811218')
  })

  it('with contracts: nothing changes until the customer approves via the e-mailed single-use link', async () => {
    db.customer_contracts = [{ id: 'k1', company_id: A, customer_id: CUSTOMER, status: 'active' }]
    const mod = await import('@/lib/customer-service/identityChange')
    const result = await mod.requestCustomerIdentityChange({ ...base, newValue: '811218-9876' })
    expect(result).toMatchObject({ status: 'pending_customer_approval', contractCount: 1, recipientMasked: 'k•••@example.test' })
    expect(db.customers[0].personal_number).toBe('19121212-1212')

    // E-mail goes to the customer's own address and carries the token; only its hash is stored.
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ companyId: A, customerId: CUSTOMER, toEmail: 'kund@example.test', emailType: 'customer_identity_change_approval' })
    const token = /\/confirm\/identity\/([0-9a-f]{64})/.exec(String(sent[0].htmlBody))?.[1] as string
    expect(token).toBeTruthy()
    const request = db.customer_identity_change_requests[0]
    expect(request.token_hash).toBe(createHash('sha256').update(token).digest('hex'))
    expect(JSON.stringify(request)).not.toContain(token)
    expect(String(sent[0].htmlBody)).not.toContain('19811218')
    expect(String(sent[0].htmlBody)).toContain('bifogad PDF')

    // Staff cannot apply it on the customer's behalf.
    await expect(mod.cancelCustomerIdentityChange).toBeDefined()
    expect(decideRpc({ p_company_id: A, p_request_id: request.id, p_outcome: 'applied', p_decided_by: 'staff' }).error).toBeTruthy()

    const view = await mod.loadIdentityChangeForApproval(token)
    expect(view).toMatchObject({ status: 'pending', previousMasked: '••••1212', newValue: '19811218-9876', contractCount: 1, companyName: 'Elbolaget' })

    expect(await mod.decideIdentityChangeByToken(token, 'approve')).toBe('applied')
    expect(db.customers[0].personal_number).toBe('19811218-9876')
    await expect(mod.decideIdentityChangeByToken(token, 'approve')).rejects.toMatchObject({ code: 'identity_change_not_pending' })
  })

  it('the customer can decline; the number stays unchanged', async () => {
    db.customer_contracts = [{ id: 'k1', company_id: A, customer_id: CUSTOMER, status: 'signed' }]
    const mod = await import('@/lib/customer-service/identityChange')
    await mod.requestCustomerIdentityChange({ ...base, newValue: '811218-9876' })
    const token = /\/confirm\/identity\/([0-9a-f]{64})/.exec(String(sent[0].htmlBody))?.[1] as string
    expect(await mod.decideIdentityChangeByToken(token, 'reject')).toBe('rejected')
    expect(db.customers[0].personal_number).toBe('19121212-1212')
  })

  it('refuses without a customer e-mail, a second open request, and cancels when the e-mail cannot be sent', async () => {
    db.customer_contracts = [{ id: 'k1', company_id: A, customer_id: CUSTOMER, status: 'active' }]
    const mod = await import('@/lib/customer-service/identityChange')
    db.customers[0].email = null
    await expect(mod.requestCustomerIdentityChange({ ...base, newValue: '811218-9876' })).rejects.toMatchObject({ code: 'identity_change_email_missing' })
    db.customers[0].email = 'kund@example.test'

    emailFails = true
    await expect(mod.requestCustomerIdentityChange({ ...base, newValue: '811218-9876' })).rejects.toMatchObject({ code: 'identity_change_email_failed' })
    expect(db.customer_identity_change_requests[0].status).toBe('cancelled')
    emailFails = false

    await mod.requestCustomerIdentityChange({ ...base, newValue: '811218-9876' })
    await expect(mod.requestCustomerIdentityChange({ ...base, newValue: '811218-9876' })).rejects.toMatchObject({ code: 'identity_change_already_pending' })
  })

  it('a draft or cancelled contract does not require approval; another tenant sees nothing', async () => {
    db.customer_contracts = [{ id: 'k1', company_id: A, customer_id: CUSTOMER, status: 'draft' }, { id: 'k2', company_id: A, customer_id: CUSTOMER, status: 'cancelled' }]
    const mod = await import('@/lib/customer-service/identityChange')
    expect((await mod.requestCustomerIdentityChange({ ...base, newValue: '811218-9876' })).status).toBe('applied')
    await expect(mod.requestCustomerIdentityChange({ ...base, companyId: B, newValue: '121212-1212' })).rejects.toMatchObject({ code: 'customer_not_found' })
  })

  it('rejects malformed approval tokens', async () => {
    const mod = await import('@/lib/customer-service/identityChange')
    await expect(mod.loadIdentityChangeForApproval('../../etc')).rejects.toMatchObject({ code: 'identity_change_link_invalid' })
    await expect(mod.decideIdentityChangeByToken('a'.repeat(64), 'approve')).rejects.toMatchObject({ code: 'identity_change_link_invalid' })
  })
})

describe('F12 takeover of binding contracts, PDF and recipient', () => {
  const binding = { id: 'k1', company_id: A, customer_id: CUSTOMER, status: 'active', contract_type: 'variable_monthly', contract_number: 'AV-1', binding_months: 24, notice_months: 1, actual_start_at: '2026-09-01', legal_bundle_version_id: 'lb1' }

  it('sends the e-mail only to the customer card address, with a PDF built from the customer card', async () => {
    db.customer_contracts = [{ ...binding, binding_months: null, notice_months: null }]
    const mod = await import('@/lib/customer-service/identityChange')
    const result = await mod.requestCustomerIdentityChange({ ...base, newValue: '811218-9876' })
    expect(result).toMatchObject({ status: 'pending_customer_approval', takeoverRequired: false })
    expect(sent[0].toEmail).toBe('kund@example.test')
    const attachments = sent[0].attachments as Array<{ filename: string; content: string; contentType: string }>
    expect(attachments).toHaveLength(1)
    expect(attachments[0].contentType).toBe('application/pdf')
    const pdf = Buffer.from(attachments[0].content, 'base64')
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    const text = pdf.toString('latin1')
    expect(text).toContain('19121212-1212')
    expect(text).toContain('19811218-9876')
    expect(text).toContain('K-1001')
    expect(text).toContain('Test Kund')
    expect(db.customer_identity_change_requests[0].document_sha256).toBe(createHash('sha256').update(pdf).digest('hex'))
  })

  it('a binding contract or notice period is a takeover: stops unless the new party accepts contracts and terms', async () => {
    db.customer_contracts = [binding, { ...binding, id: 'k2', contract_number: 'AV-2', binding_months: null, notice_months: null, legal_bundle_version_id: 'lbX' }]
    const mod = await import('@/lib/customer-service/identityChange')
    const result = await mod.requestCustomerIdentityChange({ ...base, newValue: '811218-9876' })
    expect(result).toMatchObject({ status: 'pending_customer_approval', takeoverRequired: true, contractCount: 2 })
    const request = db.customer_identity_change_requests[0]
    const snapshot = request.takeover_snapshot as { contracts: Array<{ contract_number: string; binding_ends_on: string | null; notice_months: number | null }>; terms: Array<{ title: string }> }
    // Only the committed contract is taken over; another tenant's terms are never included.
    expect(snapshot.contracts.map((c) => c.contract_number)).toEqual(['AV-1'])
    expect(snapshot.contracts[0]).toMatchObject({ binding_ends_on: '2028-09-01', notice_months: 1 })
    expect(snapshot.terms.map((t) => t.title)).toEqual(['Allmänna avtalsvillkor'])
    expect(request.takeover_snapshot_sha256).toBe(createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'))
    const pdfText = Buffer.from((sent[0].attachments as Array<{ content: string }>)[0].content, 'base64').toString('latin1')
    expect(pdfText).toContain('AV-1')
    expect(pdfText).toContain('Allm')

    const token = /\/confirm\/identity\/([0-9a-f]{64})/.exec(String(sent[0].htmlBody))?.[1] as string
    const view = await mod.loadIdentityChangeForApproval(token)
    expect(view.newValue).toBe('19811218-9876')
    expect(view.takeover?.terms).toEqual([{ title: 'Allmänna avtalsvillkor', contentSha256: 'a'.repeat(64), body: 'Villkorstext A' }])

    // Approve without all confirmations: refused, nothing changes.
    await expect(mod.decideIdentityChangeByToken(token, 'approve', { confirmations: { identity: true, contracts: true, terms: false }, snapshotSha256: view.takeover?.snapshotSha256 }))
      .rejects.toMatchObject({ code: 'identity_change_takeover_acceptance_required' })
    await expect(mod.decideIdentityChangeByToken(token, 'approve')).rejects.toMatchObject({ code: 'identity_change_takeover_acceptance_required' })
    // A changed or forged snapshot is refused.
    await expect(mod.decideIdentityChangeByToken(token, 'approve', { confirmations: { identity: true, contracts: true, terms: true }, snapshotSha256: 'f'.repeat(64) }))
      .rejects.toMatchObject({ code: 'identity_change_takeover_changed' })
    expect(db.customers[0].personal_number).toBe('19121212-1212')

    expect(await mod.decideIdentityChangeByToken(token, 'approve', { confirmations: { identity: true, contracts: true, terms: true }, snapshotSha256: view.takeover?.snapshotSha256, ipHash: 'h', userAgent: 'UA' })).toBe('applied')
    expect(db.customers[0].personal_number).toBe('19811218-9876')
    expect(request.acceptance_evidence).toMatchObject({ snapshot_sha256: request.takeover_snapshot_sha256, confirmations: { identity: true, contracts: true, terms: true }, ip_hash: 'h', user_agent: 'UA' })
  })
})

describe('F12 wiring', () => {
  it('the ordinary OPS profile save can no longer change personal or organization numbers', () => {
    const source = readFileSync('app/admin/customers/[id]/profile-actions.part-1.ts', 'utf8')
    expect(source).toContain('identity_change_requires_flow')
    expect(source).toContain('personal_number: (stored.personal_number as string | null) ?? null')
    expect(source).toContain('org_number: (stored.org_number as string | null) ?? null')
  })

  it('migration: service-role only, append-only history, atomic decision with audit_logs', () => {
    const sql = readFileSync('supabase/migrations/20261002120000_customer_identity_change_requests.sql', 'utf8')
    expect(sql).toContain('REVOKE ALL ON TABLE public.customer_identity_change_events FROM PUBLIC, anon, authenticated')
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON public.customer_identity_change_events')
    expect(sql).toContain("identity_change_requires_customer_approval")
    expect(sql).toContain('FOR UPDATE')
    expect(sql).toContain('INSERT INTO public.audit_logs')
    expect(sql).not.toMatch(/\bDROP\b/)
  })

  it('the approval page never decides on GET', () => {
    const page = readFileSync('app/confirm/identity/[token]/page.tsx', 'utf8')
    expect(page).not.toContain('decideIdentityChangeByToken')
    expect(page).toContain('decideIdentityChangeAction')
  })
})
