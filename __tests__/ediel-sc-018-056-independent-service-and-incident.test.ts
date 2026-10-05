// masterplan: SC-018, SC-056
// Real customer-card facade/implementation/manual bridge/tenant checks and real
// incident HTTP/report/read guards. Auth, database/RPC and audit inputs are
// finite ports; SQL owner effects and qualified native evidence are separate.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const io = vi.hoisted(() => ({
  from: vi.fn(), rpc: vi.fn(), admin: vi.fn(), apiAdmin: vi.fn(),
  operational: vi.fn(), operationalRead: vi.fn(), operate: vi.fn(),
  audit: vi.fn(), revalidate: vi.fn(), utilts: vi.fn(), z13: vi.fn(), z18: vi.fn(),
  legacyRequest: vi.fn(), legacyOutbound: vi.fn(),
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: io.from, rpc: io.rpc } }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: vi.fn(async () => ({})) }))
vi.mock('@/lib/admin/guards', () => ({ requireAdminActionAccess: io.admin, isPlatformAdminContext: () => false }))
vi.mock('@/lib/admin/apiGuards', () => ({ requireAdminApiAccess: io.apiAdmin }))
vi.mock('@/lib/tenant/scope', () => ({ requireOperationalCompanyId: io.operational, getOperationalCompanyScope: io.operationalRead, assertUserCanOperateCompany: io.operate }))
vi.mock('@/lib/audit/actionLogger', () => ({ logAdminActionAndUsage: io.audit, logUsageEvent: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: io.revalidate }))
vi.mock('@/lib/cis/edielAutomation', () => ({ ensureAndPrepareUtiltsFromDataRequest: io.utilts }))
vi.mock('@/lib/ediel/flows/prodatServicePermission', () => ({ prepareAndQueueServicePermissionZ13: io.z13, prepareAndQueueServicePermissionZ18: io.z18 }))
vi.mock('@/lib/cis/db', () => ({ createGridOwnerDataRequest: io.legacyRequest, createOutboundRequest: io.legacyOutbound }))
// Other customer actions are not invoked by this scenario. Avoid importing
// their unrelated outbound construction graph; the selected part-3 is real.
vi.mock('@/app/admin/customers/[id]/actions.part-2', () => ({ createAndQueueCustomerMasterdataZ01: vi.fn() }))

import { createGridOwnerDataRequestAction } from '@/app/admin/customers/[id]/actions'
import { POST, GET } from '@/app/api/ediel/business-incidents/route'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const company = id(1), actor = id(2), customer = id(3), assignment = id(4)
const held = { status: 'held', requestId: id(10), missing: ['explicit_source_assignment_required'] }
const guard = { userId: actor, companyId: company, roles: [], permissions: [], isPlatformAdmin: false }
let customerCompany = company, meteringWrite = true
const reads: Array<{ table: string; filters: Array<[string, unknown]> }> = []

function query(table: string) {
  const record = { table, filters: [] as Array<[string, unknown]> }
  reads.push(record)
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn((key: string, value: unknown) => { record.filters.push([key, value]); return chain }),
    not: vi.fn(() => chain), order: vi.fn(() => chain),
    range: vi.fn(async () => ({ data: [], error: null })),
    maybeSingle: vi.fn(async () => {
      if (table === 'customers') return { data: { id: customer, company_id: customerCompany, status: 'active' }, error: null }
      if (table === 'company_memberships') return { data: { company_id: company, user_id: actor, status: 'active', is_active: true, accepted_at: '2026-01-01T00:00:00Z' }, error: null }
      if (table === 'user_profiles') return { data: { id: actor, user_status: 'active' }, error: null }
      throw new Error(`Unexpected finite database read: ${table}`)
    }),
  }
  return chain
}
function form(extra: Record<string, string> = {}) {
  const data = new FormData()
  for (const [key, value] of Object.entries({ customer_id: customer, request_scope: 'metering_access', business_action: 'request_metering_access', ...extra })) data.set(key, value)
  return data
}
const command = { commandId: id(20), sourceMessageId: id(21), ackMessageId: id(22), scopeReference: 'SC056-OWN-ACCEPTED-IDE', finding: { code: 'late_internal_business_error', summary: 'Later internal calculation fault after accepted positive APERAK' } }
const receipt = {
  incidentId: id(23), commandId: command.commandId, companyId: company, environment: 'test',
  sourceMessageId: command.sourceMessageId, ackMessageId: command.ackMessageId,
  scope: { scope: 'transaction', reference: command.scopeReference, outcome: 'positive' },
  reportedAt: '2026-10-01T00:00:00Z', finding: command.finding, status: 'reported',
  findingValidated: false, ackHistoryChanged: false, contactStatus: 'held', correctionStatus: 'held', trafficAuthorized: false,
}
const post = (body: unknown) => new NextRequest('http://localhost/api/ediel/business-incidents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

beforeEach(() => {
  vi.clearAllMocks(); reads.length = 0; customerCompany = company; meteringWrite = true
  io.from.mockImplementation(query)
  io.admin.mockResolvedValue(guard); io.apiAdmin.mockResolvedValue({ guard })
  io.operational.mockResolvedValue(company); io.operationalRead.mockResolvedValue({ companyId: company, companyName: 'Own provider' }); io.operate.mockResolvedValue(undefined)
  io.rpc.mockImplementation(async (name: string) => {
    if (name === 'gridex_actor_has_company_permission') return { data: meteringWrite, error: null }
    if (name === 'ediel_service_permission_manual_context_v1') return { data: held, error: null }
    if (name === 'ediel_report_fresh_business_incident_v1' || name === 'ediel_read_fresh_business_incident_v1') return { data: receipt, error: null }
    throw new Error(`Unexpected finite RPC: ${name}`)
  })
})

describe('SC-018 active supply is separate from the requested ESCO service', () => {
  it('customer-card command asks the current manual owner for evidence and returns before automatic DGI or other traffic', async () => {
    // Active DDQ is an upstream supplied fact in the SQL companion. The public
    // command neither reads it as authority nor translates a form checkbox.
    await createGridOwnerDataRequestAction(form({ active_supply: 'true', covers_metering_data: 'on' }))
    expect(io.rpc).toHaveBeenCalledWith('gridex_actor_has_company_permission', { p_actor_user_id: actor, p_company_id: company, p_permission: 'metering.write' })
    expect(io.rpc).toHaveBeenCalledWith('ediel_service_permission_manual_context_v1', {
      p_company_id: company, p_actor_user_id: actor, p_customer_id: customer,
      p_selection: { code: 'Z13', permissionId: null, assignmentId: null, expectedVersion: null, mode: null, fromDate: null, toDate: null },
    })
    expect(io.operate).toHaveBeenCalledWith(actor, company)
    expect(io.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'ediel_service_permission_manual_command', entityId: customer, metadata: { customerId: customer, result: held } }))
    const meterReads = reads.filter(row => row.table === 'grid_owner_data_requests')
    expect(meterReads).toHaveLength(2)
    for (const row of meterReads) expect(row.filters).toEqual([['customer_id', customer], ['request_scope', 'meter_values'], ['company_id', company]])
    for (const port of [io.z13, io.z18, io.utilts, io.legacyRequest, io.legacyOutbound]) expect(port).not.toHaveBeenCalled()
  })

  it('explicit requested assignment preserves its version and missing ESCO context through the real caller', async () => {
    const missing = { ...held, missing: ['current_source_permission_context'] }
    io.rpc.mockImplementation(async (name: string) => ({ data: name === 'gridex_actor_has_company_permission' ? true : missing, error: null }))
    await createGridOwnerDataRequestAction(form({ service_assignment_id: assignment, service_assignment_version: '7' }))
    expect(io.rpc).toHaveBeenCalledWith('ediel_service_permission_manual_context_v1', expect.objectContaining({ p_selection: expect.objectContaining({ assignmentId: assignment, expectedVersion: 7, code: 'Z13' }) }))
    expect(io.audit).toHaveBeenCalledWith(expect.objectContaining({ metadata: { customerId: customer, result: missing } }))
    expect(io.z13).not.toHaveBeenCalled(); expect(io.legacyRequest).not.toHaveBeenCalled()
  })

  it('current metering-write revocation prevents manual context and every traffic port despite active-customer facts', async () => {
    meteringWrite = false
    await expect(createGridOwnerDataRequestAction(form())).rejects.toThrow('ediel_tenant_permission_forbidden')
    expect(io.rpc.mock.calls.map(call => call[0])).toEqual(['gridex_actor_has_company_permission'])
    expect(io.audit).not.toHaveBeenCalled(); expect(io.z13).not.toHaveBeenCalled(); expect(io.utilts).not.toHaveBeenCalled()
  })

  it('a foreign customer is rejected by the actual customer mutation boundary before service preparation', async () => {
    customerCompany = id(90)
    await expect(createGridOwnerDataRequestAction(form())).rejects.toThrow('Du saknar behörighet för valt bolag')
    expect(io.rpc).not.toHaveBeenCalled(); expect(io.audit).not.toHaveBeenCalled(); expect(io.z13).not.toHaveBeenCalled()
  })
})

describe('SC-056 a later internal fault keeps the accepted positive outcome', () => {
  it('public report, retry and read retain one exact original scope and expose only held independently reviewed processes', async () => {
    // RPC receipt and persistence are finite here. Genuine native first-report,
    // replay tripwires, held plans, original bytes/history and race/rollback
    // evidence are qualified separately, never inferred from this stub.
    const first = await POST(post(command)), replay = await POST(post(command))
    expect(first.status).toBe(201); expect(replay.status).toBe(201)
    expect(await first.json()).toEqual(receipt); expect(await replay.json()).toEqual(receipt)
    const read = await GET(new NextRequest(`http://localhost/api/ediel/business-incidents?incidentId=${receipt.incidentId}`))
    expect(read.status).toBe(200); expect(await read.json()).toEqual(receipt)
    expect(io.apiAdmin.mock.calls).toEqual([[{ allOf: ['communication.write', 'communication.send'] }], [{ allOf: ['communication.write', 'communication.send'] }], [{ allOf: ['communication.read'] }]])
    expect(io.rpc.mock.calls).toEqual([
      ['ediel_report_fresh_business_incident_v1', { p_company_id: company, p_actor_user_id: actor, p_input: command }],
      ['ediel_report_fresh_business_incident_v1', { p_company_id: company, p_actor_user_id: actor, p_input: command }],
      ['ediel_read_fresh_business_incident_v1', { p_company_id: company, p_actor_user_id: actor, p_incident_id: receipt.incidentId }],
    ])
    for (const response of [first, replay, read]) expect(response.headers.get('cache-control')).toBe('private, no-store')
    for (const port of [io.z13, io.z18, io.utilts, io.legacyOutbound]) expect(port).not.toHaveBeenCalled()
  })

  it('retry cannot request an opposite APERAK or replace the original positive outcome before the native owner', async () => {
    const rejected = await POST(post({ ...command, outcome: 'negative', correctionRawPayload: 'APERAK+100' }))
    expect(rejected.status).toBe(400); expect(io.rpc).not.toHaveBeenCalled()
    io.apiAdmin.mockResolvedValue({ response: NextResponse.json({ error: 'current actor denied' }, { status: 403 }) })
    expect((await POST(post(command))).status).toBe(403); expect(io.rpc).not.toHaveBeenCalled()
  })
})
