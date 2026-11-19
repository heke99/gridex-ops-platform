import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const port = vi.hoisted(() => ({
  api: null as SupabaseClient | null,
  createCase: vi.fn(),
  authorize: vi.fn(),
  decision: vi.fn(),
  switchRead: vi.fn(),
  assertContract: vi.fn(),
  assertSite: vi.fn(),
  assertMeter: vi.fn(),
  audit: vi.fn(),
  usage: vi.fn(),
  revalidate: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidatePath: port.revalidate }))
vi.mock('@/lib/admin/guards', () => ({ requireAdminActionAccess: port.authorize }))
vi.mock('@/lib/supabase/server', () => ({}))
vi.mock('@/lib/supabase/service', () => ({ get supabaseService() { return port.api } }))
vi.mock('@/lib/tenant/entityGuards', () => ({
  assertContractTenant: port.assertContract,
  assertCustomerSiteTenant: port.assertSite,
  assertMeteringPointTenant: port.assertMeter,
  loadCustomerTenantContext: async (id: string) => ({ customer: { id, company_id: company }, companyId: company }),
}))
vi.mock('@/lib/tenant/scope', () => ({ assertUserCanOperateCompany: vi.fn() }))
vi.mock('@/lib/operations/db', () => ({}))
vi.mock('@/lib/cis/db', () => ({}))
vi.mock('@/lib/audit/actionLogger', () => ({ logUsageEvent: port.usage }))
vi.mock('@/lib/customers/customerOperationEvents', () => ({}))
vi.mock('@/lib/customer-cases/db', () => ({ createCustomerCase: port.createCase }))
vi.mock('@/app/admin/customers/[id]/actions.part-1', () => ({
  formValue: (form: FormData, key: string) => form.get(key),
  normalizeDateOrNull: (value: string | null) => value,
  toBoolean: (form: FormData, key: string) => form.get(key) === 'on',
  insertAuditLog: port.audit,
}))
import { registerCustomerLifecycleDecisionAction } from '@/app/admin/customers/[id]/actions.part-4'

const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`
const [company, customer, actor, contractA, contractB, siteA, siteB, meterA, meterB, switchA, switchB] =
  Array.from({ length: 11 }, (_, index) => id(index + 1))
const date = '2026-11-06T10:15:00Z'
const agreement = { id: contractA, company_id: company, customer_id: customer, site_id: siteA, customer_site_id: siteA, metering_point_id: meterA }
const ownSwitch = { id: switchA, company_id: company, customer_id: customer, contract_id: contractA, customer_contract_id: contractA,
  site_id: siteA, customer_site_id: siteA, metering_point_id: meterA, submitted_at: date, created_at: date }
type Row = Record<string, string | null>

// Apply the limited PostgREST predicates used by the mounted request to a finite fixture.
function matchesLogic(expression: string, row: Row): boolean {
  const tokens = expression.match(/[^,()]+|[(),]/g) ?? []
  let cursor = 0
  function match(): boolean {
    const token = tokens[cursor++]
    if (token === 'and' || token === 'or') {
      expect(tokens[cursor++]).toBe('(')
      const terms = [match()]
      while (tokens[cursor] === ',') { cursor++; terms.push(match()) }
      expect(tokens[cursor++]).toBe(')')
      return token === 'and' ? terms.every(Boolean) : terms.some(Boolean)
    }
    const [column, operator, value] = token.split('.')
    if (operator === 'is' && value === 'null') return row[column] === null
    expect(operator).toBe('eq')
    return row[column] === value
  }
  const result = match()
  expect(cursor).toBe(tokens.length)
  return result
}

function mockDecisionDatabase(switches: Row[], selectedAgreement: Row = agreement) {
  port.api = createClient('https://lifecycle-synthetic.example.invalid', 'synthetic', {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/rpc/gridex_register_customer_lifecycle_decision_v1')) {
        port.decision(JSON.parse(String(init?.body)))
        return Response.json({ effect: { registered: true } })
      }
      const table = url.pathname.split('/').at(-1)
      expect(['customer_contracts', 'supplier_switch_requests']).toContain(table)
      const rows = table === 'customer_contracts' ? [selectedAgreement] : switches
      if (table === 'supplier_switch_requests') port.switchRead(url)
      const filters = [...url.searchParams].filter(([key]) => !['select', 'order', 'limit'].includes(key))
      const selected = rows.filter(row => filters.every(([column, condition]) =>
        column === 'or' ? matchesLogic(`or${condition}`, row) : matchesLogic(`${column}.${condition}`, row)))
      selected.sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)) || String(right.id).localeCompare(String(left.id)))
      return Response.json(selected.slice(0, Number(url.searchParams.get('limit') ?? selected.length)))
    } },
  })
}

function form(scopeTarget = `contract:${contractA}`) {
  const values = new FormData()
  for (const [key, value] of Object.entries({ customer_id: customer, scope_target: scopeTarget,
    confirmed: 'on', decision_type: 'withdrawal', received_at: date })) values.set(key, value)
  return values
}

beforeEach(() => {
  vi.resetAllMocks()
  port.authorize.mockResolvedValue({ userId: actor, permissions: ['masterdata.write', 'contracts.read'] })
  port.assertContract.mockResolvedValue(agreement)
  port.createCase.mockResolvedValue({ id: id(20) })
})

describe('registering a customer lifecycle decision', () => {
  it.each(['current', 'legacy', 'both'] as const)('uses the latest compatible switch for the selected contract (%s link)', async link => {
    const matching = { ...ownSwitch, contract_id: link === 'legacy' ? null : contractA,
      customer_contract_id: link === 'current' ? null : contractA }
    const newer = '2026-11-07T10:15:00Z'
    mockDecisionDatabase([
      { ...ownSwitch, id: switchB, contract_id: contractB, customer_contract_id: contractB, site_id: siteB, customer_site_id: siteB, metering_point_id: meterB, submitted_at: newer, created_at: newer },
      { ...ownSwitch, id: id(21), customer_contract_id: contractB, created_at: newer },
      { ...ownSwitch, id: id(22), customer_site_id: siteB, created_at: newer },
      { ...ownSwitch, id: id(23), metering_point_id: meterB, created_at: newer },
      { ...ownSwitch, id: id(24), company_id: id(25), created_at: newer },
      { ...ownSwitch, id: id(26), customer_id: id(27), created_at: newer },
      matching,
    ])

    await registerCustomerLifecycleDecisionAction(form())

    expect(port.assertContract).toHaveBeenCalledWith({ companyId: company, customerId: customer, contractId: contractA })
    expect(port.assertSite).toHaveBeenCalledWith({ companyId: company, customerId: customer, siteId: siteA })
    expect(port.assertMeter).toHaveBeenCalledWith({ companyId: company, customerId: customer, siteId: siteA, meteringPointId: meterA })
    expect(port.createCase).toHaveBeenCalledWith(expect.objectContaining({ companyId: company, customerId: customer,
      customerContractId: contractA, siteId: siteA, meteringPointId: meterA, supplierSwitchRequestId: switchA, prodatSentAt: date }))
    expect(port.decision).toHaveBeenCalledWith(expect.objectContaining({ p_company_id: company, p_customer_id: customer,
      p_scope_type: 'contract', p_scope_id: contractA }))
    expect(port.switchRead).toHaveBeenCalledOnce()
    expect(port.switchRead.mock.calls[0][0].searchParams.get('order')).toBe('created_at.desc,id.desc')
  })

  it('creates a contract case without borrowing location or dispatch facts from an unrelated switch', async () => {
    const unrelated = { ...ownSwitch, id: switchB, contract_id: contractB, customer_contract_id: contractB, site_id: siteB, customer_site_id: siteB, metering_point_id: meterB }
    mockDecisionDatabase([unrelated])

    await registerCustomerLifecycleDecisionAction(form())

    expect(port.createCase).toHaveBeenCalledWith(expect.objectContaining({ customerContractId: contractA,
      siteId: siteA, meteringPointId: meterA, supplierSwitchRequestId: null, prodatSentAt: null }))
  })

  it('does not link a switch with contradictory locations even when both contract identifiers match', async () => {
    mockDecisionDatabase([{ ...ownSwitch, customer_site_id: siteB }])

    await registerCustomerLifecycleDecisionAction(form())

    expect(port.createCase).toHaveBeenCalledWith(expect.objectContaining({ customerContractId: contractA,
      siteId: siteA, meteringPointId: meterA, supplierSwitchRequestId: null, prodatSentAt: null }))
  })

  it('rejects contract rows whose tenant read cannot confirm contract ownership', async () => {
    mockDecisionDatabase([ownSwitch], { ...agreement, company_id: id(25) })

    await expect(registerCustomerLifecycleDecisionAction(form())).rejects.toThrow('Avtalet tillhör inte kunden eller bolaget.')
    expect(port.switchRead).not.toHaveBeenCalled()
    expect(port.createCase).not.toHaveBeenCalled()
    expect(port.decision).not.toHaveBeenCalled()
  })

  it.each([
    ['missing both locations', { site_id: null, customer_site_id: null, metering_point_id: null }],
    ['missing the site', { site_id: null, customer_site_id: null }],
    ['missing the meter', { metering_point_id: null }],
    ['conflicting site references', { customer_site_id: siteB }],
  ] as const)('directs an authorised contract decision to review without side effects (%s)', async (_kind, location) => {
    mockDecisionDatabase([ownSwitch], { ...agreement, ...location })

    await expect(registerCustomerLifecycleDecisionAction(form())).rejects.toMatchObject({
      digest: expect.stringContaining(`/admin/customers/${customer}?tab=contracts#contracts`),
    })
    expect(port.assertContract).toHaveBeenCalledWith({ companyId: company, customerId: customer, contractId: contractA })
    expect(port.switchRead).not.toHaveBeenCalled()
    expect(port.createCase).not.toHaveBeenCalled()
    expect(port.decision).not.toHaveBeenCalled()
    expect(port.audit).not.toHaveBeenCalled()
    expect(port.usage).not.toHaveBeenCalled()
    expect(port.revalidate).not.toHaveBeenCalled()
  })

  it('directs a contract with an unverified site/meter relationship to review before any writes', async () => {
    mockDecisionDatabase([ownSwitch])
    port.assertMeter.mockRejectedValue(new Error('Mätpunkten tillhör inte kunden eller bolaget.'))

    await expect(registerCustomerLifecycleDecisionAction(form())).rejects.toMatchObject({
      digest: expect.stringContaining(`/admin/customers/${customer}?tab=contracts#contracts`),
    })
    expect(port.assertMeter).toHaveBeenCalledWith({ companyId: company, customerId: customer, siteId: siteA, meteringPointId: meterA })
    expect(port.switchRead).not.toHaveBeenCalled()
    expect(port.createCase).not.toHaveBeenCalled()
    expect(port.decision).not.toHaveBeenCalled()
    expect(port.audit).not.toHaveBeenCalled()
    expect(port.usage).not.toHaveBeenCalled()
    expect(port.revalidate).not.toHaveBeenCalled()
  })

  it('directs a masterdata writer without contract read permission to the eligible legal review', async () => {
    port.authorize.mockResolvedValue({ userId: actor, permissions: ['masterdata.write'] })
    mockDecisionDatabase([ownSwitch], { ...agreement, metering_point_id: null })

    await expect(registerCustomerLifecycleDecisionAction(form())).rejects.toMatchObject({
      digest: expect.stringContaining(`/admin/customers/${customer}?tab=legal-readiness#legal-readiness`),
    })
    expect(port.switchRead).not.toHaveBeenCalled()
    expect(port.createCase).not.toHaveBeenCalled()
    expect(port.decision).not.toHaveBeenCalled()
  })

  it('keeps site-scoped lifecycle decisions attached to the selected site', async () => {
    mockDecisionDatabase([ownSwitch, { ...ownSwitch, id: switchB, site_id: siteB, customer_site_id: siteB, created_at: '2026-11-08T10:15:00Z' }])

    await registerCustomerLifecycleDecisionAction(form(`site:${siteA}`))

    expect(port.assertContract).not.toHaveBeenCalled()
    expect(port.createCase).toHaveBeenCalledWith(expect.objectContaining({ customerContractId: null,
      siteId: siteA, supplierSwitchRequestId: switchA, prodatSentAt: date }))
    expect(port.decision).toHaveBeenCalledWith(expect.objectContaining({ p_scope_type: 'site', p_scope_id: siteA }))
  })
})
