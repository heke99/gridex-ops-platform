// FINDINGS F87/F88: before a new agreement's Z03 is prepared, the invoicee (NAD+IV) and the agreement reference
// (RFF+ANJ) are selected from the signed contract and its bound power of attorney and stored on the switch as
// server-owned sources; nothing wrote them, so no Z03 could ever be rendered.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({ switchRow: null as Row | null, poa: null as Row | null, updates: [] as Array<{ patch: Row; filters: Row }>,
  method: { status: 'authorized', pointId: '735999000000000017', identityAgency: '9' } as Row, invoiceeCalls: [] as Row[] }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: (table: string) => {
  const filters: Row = {}; let patch: Row | null = null
  const self: Record<string, unknown> = {
    returns: () => self, select: () => self, eq: (key: string, value: unknown) => { filters[key] = value; return self }, update: (value: Row) => { patch = value; return self },
    maybeSingle: async () => ({ data: table === 'supplier_switch_requests' ? io.switchRow : table === 'powers_of_attorney'
      ? (io.poa && io.poa.company_id === filters.company_id && io.poa.customer_id === filters.customer_id ? io.poa : null) : null, error: null }),
    then: (resolve: (value: unknown) => unknown) => { if (patch) io.updates.push({ patch, filters: { ...filters } }); return Promise.resolve({ error: null }).then(resolve) },
  }
  return self
} } }))
vi.mock('@/lib/ediel/production/contractRequestedMethodSource', () => ({ readContractRequestedMethodSource: async () => io.method }))
vi.mock('@/lib/cis/db-shared', () => ({ getCustomerExportContext: async () => ({ customer: { id: 'customer-1' }, customerLifeEvent: null, customerMasterdata: { declared: true } }) }))
vi.mock('@/lib/ediel/prodat/customerIdentity', () => ({ resolveSwedishProdatEndUserExport: () => ({ identity: { id: '196803041356', qualifier: 'SE2', name: 'Anna Test' },
  nameLines: ['Anna Test'], addressLines: ['Kungsgatan 1'], postalCode: '441 30', city: 'Alingsås', country: 'SE' }) }))
vi.mock('@/lib/ediel/production/contractInvoicee', () => ({ readContractInvoicee: async (input: Row) => { io.invoiceeCalls.push(input)
  return { fact: { meteringPointId: input.meteringPointId, source: { kind: 'caller_selection', companyId: input.companyId, reference: `customer_contract:${input.contractId}` } }, invoicee: null } } }))

import { selectInvoiceeBeforeSwitch } from '@/lib/operations/switchInvoiceePreparation'

const SWITCH = { id: 'switch-1', company_id: 'company-a', customer_id: 'customer-1', site_id: 'site-1', metering_point_id: 'mp-1', contract_id: null,
  customer_contract_id: 'contract-1', requested_start_date: '2026-09-01', power_of_attorney_id: 'poa-1', validation_snapshot: { edielAutomationReadiness: { ok: true }, portalData: { powerOfAttorneyReference: 'SAVED-PREVIEW', dependentConditionFacts: { market: 'electricity' } } } }

beforeEach(() => {
  io.switchRow = structuredClone(SWITCH); io.updates = []; io.invoiceeCalls = []
  io.poa = { company_id: 'company-a', customer_id: 'customer-1', reference: 'POA123', status: 'signed' }
  io.method = { status: 'authorized', pointId: '735999000000000017', identityAgency: '9' }
})

describe('Z03 invoicee and agreement reference preparation (F87, F88)', () => {
  it('stores the signed contract\'s invoicee and the bound power of attorney\'s reference on the switch, keeping the rest of the snapshot', async () => {
    await selectInvoiceeBeforeSwitch({ companyId: SWITCH.company_id, actorUserId: 'automation', switchRequestId: 'switch-1' })
    expect(io.invoiceeCalls).toEqual([expect.objectContaining({ companyId: 'company-a', customerId: 'customer-1', contractId: 'contract-1', meteringPointId: '735999000000000017', identityAgency: '9',
      endUser: expect.objectContaining({ identity: { id: '196803041356', qualifier: 'SE2', agency: '260' }, streetParts: ['Kungsgatan 1'], postalCode: '441 30' }) })])
    expect(io.updates).toHaveLength(1)
    expect(io.updates[0].filters).toEqual({ id: 'switch-1', company_id: 'company-a' })
    const snapshot = io.updates[0].patch.validation_snapshot as Row
    expect(snapshot.edielAutomationReadiness).toEqual({ ok: true })
    expect(snapshot.portalData).toEqual({ invoicee: null, powerOfAttorneyReference: 'POA123',
      dependentConditionFacts: { market: 'electricity', invoiceeObjects: [expect.objectContaining({ source: { kind: 'caller_selection', companyId: 'company-a', reference: 'customer_contract:contract-1' } })] } })
  })

  it('never takes another tenant\'s or an unsigned power of attorney as the agreement reference', async () => {
    io.poa = { company_id: 'company-b', customer_id: 'customer-1', reference: 'FOREIGN', status: 'signed' }
    await selectInvoiceeBeforeSwitch({ companyId: SWITCH.company_id, actorUserId: 'automation', switchRequestId: 'switch-1' })
    expect((io.updates[0].patch.validation_snapshot as { portalData: Row }).portalData.powerOfAttorneyReference).toBeNull()
    io.updates = []; io.poa = { company_id: 'company-a', customer_id: 'customer-1', reference: 'DRAFT', status: 'draft' }
    await selectInvoiceeBeforeSwitch({ companyId: SWITCH.company_id, actorUserId: 'automation', switchRequestId: 'switch-1' })
    expect((io.updates[0].patch.validation_snapshot as { portalData: Row }).portalData.powerOfAttorneyReference).toBeNull()
  })

  it('selects nothing, and never blocks, without an authorized requested-method source or a contract', async () => {
    io.method = { status: 'held', missing: ['x'] }
    await expect(selectInvoiceeBeforeSwitch({ companyId: SWITCH.company_id, actorUserId: 'automation', switchRequestId: 'switch-1' })).resolves.toBeUndefined()
    io.method = { status: 'authorized', pointId: '735999000000000017', identityAgency: '9' }; io.switchRow = { ...structuredClone(SWITCH), customer_contract_id: null }
    await selectInvoiceeBeforeSwitch({ companyId: SWITCH.company_id, actorUserId: 'automation', switchRequestId: 'switch-1' })
    expect(io.invoiceeCalls).toEqual([]); expect(io.updates).toEqual([])
  })
})
