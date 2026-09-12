import { beforeEach, describe, expect, it, vi } from 'vitest'

type DbCall = {
  table: string
  operation: 'select' | 'insert' | 'update' | 'upsert'
  payload: unknown
  filters: Record<string, unknown>
}

const io = vi.hoisted(() => {
  type LocalMembership = {
    companyId: string
    companyStatus: string | null
    membershipRole: string
  }
  type LocalDbCall = {
    table: string
    operation: 'select' | 'insert' | 'update' | 'upsert'
    payload: unknown
    filters: Record<string, unknown>
  }
  type LocalResult = { data: unknown; error: null | { code?: string; message: string } }
  type LocalQuery = PromiseLike<LocalResult> & {
    select: (columns?: string) => LocalQuery
    insert: (payload: unknown) => LocalQuery
    update: (payload: unknown) => LocalQuery
    upsert: (payload: unknown, options?: unknown) => LocalQuery
    eq: (column: string, value: unknown) => LocalQuery
    in: (column: string, values: unknown[]) => LocalQuery
    or: (expression: string) => LocalQuery
    order: (column: string, options?: unknown) => LocalQuery
    limit: (count: number) => LocalQuery
    single: () => Promise<LocalResult>
    maybeSingle: () => Promise<LocalResult>
  }

  const state = {
    cookieCompanyId: 'A' as string | null,
    canonicalCompanyId: 'A' as string | null,
    platform: false,
    roles: ['custom_role'] as string[],
    permissions: {
      A: ['billing.write', 'billing.export', 'ediel.write'],
      B: ['billing.write', 'billing.export', 'ediel.write'],
    } as Record<string, string[]>,
    memberships: [
      { companyId: 'A', companyStatus: 'active', membershipRole: 'admin' },
      { companyId: 'B', companyStatus: 'active', membershipRole: 'admin' },
    ] as LocalMembership[],
    messages: {} as Record<string, Record<string, unknown>>,
    returnWrongMessage: false,
    dbCalls: [] as LocalDbCall[],
  }

  function message(companyId: string): Record<string, unknown> {
    return {
      id: `message-${companyId}`,
      company_id: companyId,
      direction: 'inbound',
      message_standard: 'edifact',
      message_family: 'OTHER',
      message_code: 'UNKNOWN',
      raw_payload: '',
      parsed_payload: {},
      sender_ediel_id: null,
      receiver_ediel_id: null,
      receiver_sub_address: null,
      application_reference: null,
      transaction_reference: null,
      external_reference: null,
      metering_point_id: null,
    }
  }
  state.messages = { 'message-A': message('A'), 'message-B': message('B') }

  function resultFor(call: LocalDbCall): LocalResult {
    state.dbCalls.push({ ...call, filters: { ...call.filters } })

    if (call.operation !== 'select') {
      if (call.table === 'ediel_manual_review_items') {
        return { data: { id: 'manual-review-id' }, error: null }
      }
      if (call.table === 'ediel_inbound_request_decisions') {
        return { data: { ...(call.payload as Record<string, unknown>), id: 'decision-id' }, error: null }
      }
      return { data: null, error: null }
    }

    if (call.table === 'company_memberships') {
      const rows = state.memberships.map((membership) => ({
        company_id: membership.companyId,
        membership_role: membership.membershipRole,
        status: 'active',
        companies: {
          id: membership.companyId,
          name: `Company ${membership.companyId}`,
          slug: membership.companyId.toLowerCase(),
          org_number: null,
          status: membership.companyStatus,
        },
      }))
      return { data: rows, error: null }
    }

    if (call.table === 'companies') {
      const companyId = String(call.filters.id ?? '')
      const membership = state.memberships.find((row) => row.companyId === companyId)
      if (!membership && !state.platform) return { data: null, error: null }
      return {
        data: {
          id: companyId,
          status: membership?.companyStatus ?? 'active',
          billing_provider_environment: 'test',
          invoice_export_target_system: 'capway_aptic',
        },
        error: null,
      }
    }

    if (call.table === 'invoice_export_items') {
      return {
        data: {
          id: call.filters.id,
          company_id: call.filters.company_id,
          environment: 'test',
          provider_invoice_guid: `provider-${String(call.filters.id)}`,
          customer_id: 'customer-1',
          customer_number: '1001',
        },
        error: null,
      }
    }

    if (call.table === 'ediel_messages') {
      const requested = state.messages[String(call.filters.id ?? '')]
      const data = state.returnWrongMessage
        ? state.messages['message-B']
        : requested && (!call.filters.company_id || requested.company_id === call.filters.company_id)
          ? requested
          : null
      return data
        ? { data, error: null }
        : { data: null, error: { code: 'PGRST116', message: 'not found' } }
    }

    if (call.table === 'metering_points') return { data: [], error: null }
    if (call.table === 'customer_contracts' || call.table === 'powers_of_attorney') {
      return { data: null, error: null }
    }

    return { data: null, error: null }
  }

  const from = vi.fn((table: string): LocalQuery => {
    const call: LocalDbCall = { table, operation: 'select', payload: null, filters: {} }
    let query: LocalQuery
    query = {
      select: () => query,
      insert: (payload: unknown) => { call.operation = 'insert'; call.payload = payload; return query },
      update: (payload: unknown) => { call.operation = 'update'; call.payload = payload; return query },
      upsert: (payload: unknown) => { call.operation = 'upsert'; call.payload = payload; return query },
      eq: (column: string, value: unknown) => { call.filters[column] = value; return query },
      in: () => query,
      or: () => query,
      order: () => query,
      limit: () => query,
      single: async () => resultFor(call),
      maybeSingle: async () => resultFor(call),
      then: <TResult1 = LocalResult, TResult2 = never>(
        onfulfilled?: ((value: LocalResult) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) => Promise.resolve(resultFor(call)).then(onfulfilled, onrejected),
    }
    return query
  })

  return {
    state,
    from,
    canonicalRpc: vi.fn(),
    serviceRpc: vi.fn(),
    prepare: vi.fn(),
    reset: vi.fn(),
    send: vi.fn(),
    dispute: vi.fn(),
    purchase: vi.fn(),
    emit: vi.fn(),
  }
})

vi.mock('react', () => ({ cache: <T,>(fn: T) => fn }))
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: () => io.state.cookieCompanyId ? { value: io.state.cookieCompanyId } : undefined,
  }),
}))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'actor', email: 'actor@example.test' } }, error: null }),
    },
    rpc: io.canonicalRpc,
    from: io.from,
  }),
}))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: { from: io.from, rpc: io.serviceRpc },
}))
vi.mock('@/lib/billing/invoiceReviewPrepare', () => ({
  prepareInvoiceDraftsForReview: io.prepare,
}))
vi.mock('@/lib/integrations/billing/invoiceExportCore', () => ({
  resetFailedInvoiceExportItems: io.reset,
}))
vi.mock('@/lib/billing/invoiceApprovedDispatch', () => ({
  sendApprovedInvoiceExportRun: io.send,
}))
vi.mock('@/lib/integrations/billing/capway/client', () => ({
  createCapwayApticClient: async () => ({ dispute: io.dispute }),
}))
vi.mock('@/lib/integrations/billing/capway/purchase', () => ({
  requestCapwayInvoicePurchase: io.purchase,
}))
vi.mock('@/lib/events/domainEvents', () => ({ emitDomainEvent: io.emit }))

import { POST as createExport } from '@/app/api/internal/invoice-exports/create/route'
import { POST as retryExport } from '@/app/api/internal/invoice-exports/[id]/retry/route'
import { POST as sendExport } from '@/app/api/internal/invoice-exports/[id]/send/route'
import { POST as disputeInvoice } from '@/app/api/internal/invoices/[id]/dispute/route'
import { POST as purchaseInvoice } from '@/app/api/internal/invoices/[id]/purchase/route'
import { POST as automateInboundEdiel } from '@/app/api/internal/ediel/inbound-request-automation/route'
import { evaluateInboundEdielRequest } from '@/lib/ediel/inboundRequestAutomation'

type Endpoint = {
  name: string
  invoke: (companyId: string, request?: Request) => Promise<Response>
}

function jsonRequest(body: Record<string, unknown>): Request {
  return new Request('https://app.gridex.se/internal-test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const endpoints: Endpoint[] = [
  {
    name: 'invoice export create',
    invoke: (companyId, request = jsonRequest({ companyId, billing_month: '2026-08' })) => createExport(request),
  },
  {
    name: 'invoice export retry',
    invoke: (companyId, request = jsonRequest({ companyId })) => retryExport(request, { params: Promise.resolve({ id: 'export-1' }) }),
  },
  {
    name: 'invoice export send',
    invoke: (companyId, request = jsonRequest({ companyId })) => sendExport(request, { params: Promise.resolve({ id: 'export-1' }) }),
  },
  {
    name: 'invoice dispute',
    invoke: (companyId, request = jsonRequest({ companyId, reason: 'synthetic dispute' })) => disputeInvoice(request, { params: Promise.resolve({ id: 'item-1' }) }),
  },
  {
    name: 'invoice purchase',
    invoke: (companyId, request = jsonRequest({ companyId })) => purchaseInvoice(request, { params: Promise.resolve({ id: 'item-1' }) }),
  },
  {
    name: 'Ediel inbound automation',
    invoke: (companyId, request = jsonRequest({ message_id: `message-${companyId}`, forceManualReview: true })) => automateInboundEdiel(request),
  },
]

function mutationCalls(): DbCall[] {
  return (io.state.dbCalls as DbCall[]).filter((call) => call.operation !== 'select')
}

function expectNoBusinessEffects(): void {
  expect(io.prepare).not.toHaveBeenCalled()
  expect(io.reset).not.toHaveBeenCalled()
  expect(io.send).not.toHaveBeenCalled()
  expect(io.dispute).not.toHaveBeenCalled()
  expect(io.purchase).not.toHaveBeenCalled()
  expect(io.emit).not.toHaveBeenCalled()
  expect(mutationCalls()).toEqual([])
}

beforeEach(() => {
  vi.clearAllMocks()
  io.state.cookieCompanyId = 'A'
  io.state.canonicalCompanyId = 'A'
  io.state.platform = false
  io.state.roles = ['custom_role']
  io.state.permissions = {
    A: ['billing.write', 'billing.export', 'ediel.write'],
    B: ['billing.write', 'billing.export', 'ediel.write'],
  }
  io.state.memberships = [
    { companyId: 'A', companyStatus: 'active', membershipRole: 'admin' },
    { companyId: 'B', companyStatus: 'active', membershipRole: 'admin' },
  ]
  io.state.returnWrongMessage = false
  io.state.dbCalls = []
  io.canonicalRpc.mockImplementation(async () => ({
    data: {
      authorized: true,
      user_id: 'actor',
      user_email: 'actor@example.test',
      selected_company_id: io.state.canonicalCompanyId,
      is_platform_admin: io.state.platform,
      roles: io.state.roles,
      permissions: io.state.permissions[io.state.canonicalCompanyId ?? ''] ?? [],
    },
    error: null,
  }))
  io.serviceRpc.mockImplementation(async () => ({
    data: [],
    error: null,
  }))
  io.prepare.mockResolvedValue({ prepared: 1 })
  io.reset.mockResolvedValue(undefined)
  io.send.mockResolvedValue({ sent: 1 })
  io.dispute.mockResolvedValue({ status: 'disputed' })
  io.purchase.mockResolvedValue({ status: 'requested' })
  io.emit.mockResolvedValue(undefined)
})

describe('API company authority binding through real route, guard, and Ediel helper imports', () => {
  it.each(endpoints.flatMap((endpoint) => [
    { endpoint, selected: 'A', target: 'B' },
    { endpoint, selected: 'B', target: 'A' },
  ]))('$endpoint.name denies selected $selected permission context operating $target', async ({ endpoint, selected, target }) => {
    io.state.cookieCompanyId = selected
    io.state.canonicalCompanyId = selected

    const response = await endpoint.invoke(target)

    expect(response.status).toBe(500)
    expectNoBusinessEffects()
    if (endpoint.name === 'Ediel inbound automation') {
      const load = (io.state.dbCalls as DbCall[]).find((call) => call.table === 'ediel_messages')
      expect(load?.filters).toMatchObject({ id: `message-${target}`, company_id: selected })
    } else {
      expect(io.serviceRpc).not.toHaveBeenCalled()
      expect(io.from).not.toHaveBeenCalled()
    }
  })

  it.each(endpoints)('$name authenticates before parsing and denies B membership without B grant', async ({ invoke }) => {
    io.state.cookieCompanyId = 'B'
    io.state.canonicalCompanyId = 'B'
    io.state.permissions.B = ['customers.read']
    const parse = vi.fn(async () => ({ companyId: 'B', message_id: 'message-B' }))
    const request = { json: parse } as unknown as Request

    const response = await invoke('B', request)

    expect(response.status).toBe(403)
    expect(parse).not.toHaveBeenCalled()
    expect(io.from).not.toHaveBeenCalled()
    expect(io.serviceRpc).not.toHaveBeenCalled()
    expectNoBusinessEffects()
  })

  it.each(endpoints)('$name denies a canonical context with no company before downstream I/O', async ({ invoke }) => {
    io.state.cookieCompanyId = null
    io.state.canonicalCompanyId = null
    io.state.permissions[''] = ['billing.write', 'billing.export', 'ediel.write']

    const response = await invoke('B')

    expect(response.status).toBe(500)
    expect(io.from).not.toHaveBeenCalled()
    expect(io.serviceRpc).not.toHaveBeenCalled()
    expectNoBusinessEffects()
  })

  it.each(endpoints)('$name denies a paused canonical company before business effects', async ({ invoke }) => {
    io.state.memberships = [
      { companyId: 'A', companyStatus: 'paused', membershipRole: 'admin' },
      { companyId: 'B', companyStatus: 'active', membershipRole: 'admin' },
    ]

    const response = await invoke('A')

    expect(response.status).toBe(500)
    expectNoBusinessEffects()
    expect((io.state.dbCalls as DbCall[]).some((call) => call.table === 'company_memberships')).toBe(true)
    expect((io.state.dbCalls as DbCall[]).some((call) => call.table === 'ediel_messages')).toBe(false)
  })

  it('rejects a wrong-company Ediel row even when boundary I/O violates the requested filter', async () => {
    io.state.returnWrongMessage = true

    const response = await automateInboundEdiel(jsonRequest({ message_id: 'message-A', forceManualReview: true }))

    expect(response.status).toBe(500)
    const load = (io.state.dbCalls as DbCall[]).find((call) => call.table === 'ediel_messages')
    expect(load?.filters).toEqual({ id: 'message-A', company_id: 'A' })
    expect(mutationCalls()).toEqual([])
  })

  it.each(endpoints)('$name permits its own active canonical company and keeps effects company-scoped', async ({ name, invoke }) => {
    const response = await invoke('A')

    expect(response.status).toBe(200)
    if (name === 'invoice export create') expect(io.prepare).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'A' }))
    if (name === 'invoice export retry') expect(io.reset).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'A' }))
    if (name === 'invoice export send') expect(io.send).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'A' }))
    if (name === 'invoice dispute') {
      expect(io.dispute).toHaveBeenCalled()
      expect((io.state.dbCalls as DbCall[]).find((call) => call.table === 'invoice_export_items')?.filters)
        .toMatchObject({ company_id: 'A', id: 'item-1' })
    }
    if (name === 'invoice purchase') {
      expect(io.purchase).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'A' }))
      expect((io.state.dbCalls as DbCall[]).find((call) => call.table === 'invoice_export_items')?.filters)
        .toMatchObject({ company_id: 'A', id: 'item-1' })
    }
    if (name === 'Ediel inbound automation') {
      expect((io.state.dbCalls as DbCall[]).find((call) => call.table === 'ediel_messages')?.filters)
        .toEqual({ id: 'message-A', company_id: 'A' })
      expect(mutationCalls().map((call) => call.table)).toEqual([
        'ediel_inbound_request_decisions',
        'ediel_manual_review_items',
      ])
      for (const call of mutationCalls()) {
        expect(call.payload).toMatchObject({ company_id: 'A', ediel_message_id: 'message-A' })
      }
    }
  })

  it.each(endpoints)('$name preserves authoritative platform cross-company authority', async ({ name, invoke }) => {
    io.state.platform = true
    io.state.roles = ['super_admin']
    io.state.permissions.A = []
    io.state.memberships = []

    const response = await invoke('B')

    expect(response.status).toBe(200)
    expect(io.serviceRpc).not.toHaveBeenCalled()
    if (name === 'Ediel inbound automation') {
      expect((io.state.dbCalls as DbCall[]).find((call) => call.table === 'ediel_messages')?.filters)
        .toEqual({ id: 'message-B' })
    }
  })

  it('does not treat a company-scoped platform role name as authoritative cross-company scope', async () => {
    io.state.roles = ['super_admin']

    const response = await purchaseInvoice(jsonRequest({ companyId: 'B' }), {
      params: Promise.resolve({ id: 'item-1' }),
    })

    expect(response.status).toBe(500)
    expect(io.serviceRpc).not.toHaveBeenCalled()
    expectNoBusinessEffects()
  })
})

describe('direct Ediel helper scope contract', () => {
  it('rejects an explicitly blank company scope before I/O', async () => {
    await expect(evaluateInboundEdielRequest({
      messageId: 'message-A',
      companyId: '   ',
    })).rejects.toThrow('Ediel-meddelandet hittades inte.')
    expect(io.from).not.toHaveBeenCalled()
    expect(io.state.dbCalls).toEqual([])
  })

  it('preserves an omitted scope for trusted callers', async () => {
    await expect(evaluateInboundEdielRequest({
      messageId: 'message-A',
      forceManualReview: true,
    })).resolves.toMatchObject({ company_id: 'A' })
    expect((io.state.dbCalls as DbCall[]).find((call) => call.table === 'ediel_messages')?.filters)
      .toEqual({ id: 'message-A' })
  })

  it('applies a valid explicit scope to the initial lookup', async () => {
    await expect(evaluateInboundEdielRequest({
      messageId: 'message-A',
      companyId: ' A ',
      forceManualReview: true,
    })).resolves.toMatchObject({ company_id: 'A' })
    expect((io.state.dbCalls as DbCall[]).find((call) => call.table === 'ediel_messages')?.filters)
      .toEqual({ id: 'message-A', company_id: 'A' })
  })
})
