// reality-defects: F114
// FINDINGS F114 side finding 1. A single-object inbound approval in update or link mode sent the whole create-shaped
// graph to canonical_onboard_customer_graph, whose gridex_update_jsonb_row assigns every key present: an active
// customer, site and metering point became draft, the customer's personal number was nulled and its metadata
// replaced, and the site's street, postal code, city and annual consumption were nulled whenever the message did not
// carry them. A value the message carries must still update; create mode is unchanged. The SQL row update is modelled
// by `assignPresentKeys` (every key present in the payload is assigned, exactly as gridex_update_jsonb_row does).
// Synthetic rows only; every database port is an in-memory table.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({ tables: {} as Record<string, Row[]>, commands: [] as Row[], basisError: null as Error | null, invalidBasis: false }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: async (name: string, args: Row) => {
 if(name!=='ediel_inbound_graph_snapshot_basis_v1')throw Error('unexpected RPC '+name)
 if(io.basisError)return {data:null,error:io.basisError}
 const customer=(io.tables.customers??[]).find(row=>row.id===args.p_customer_id&&row.company_id===args.p_company_id)
 const child=(table:string,key:string)=>customer?(io.tables[table]??[]).find(row=>row.id===args[key]&&row.company_id===args.p_company_id&&row.customer_id===customer.id):null
 const site=child('customer_sites','p_site_id'),point=child('metering_points','p_metering_point_id')
 return {data:{customer:customer?JSON.stringify(customer):null,site:site?JSON.stringify(site):null,metering_point:point?JSON.stringify(point):null,...(io.invalidBasis?{unknown:true}:{})},error:null}
},from: (table: string) => {
  const filters: Array<(row: Row) => boolean> = []
  let order: [string, boolean] | null = null
  const rows = () => {
    const found = (io.tables[table] ?? []).filter(row => filters.every(filter => filter(row)))
    if (order) {
      const [column, ascending] = order
      found.sort((a, b) => String(a[column]).localeCompare(String(b[column])) * (ascending ? 1 : -1))
    }
    return found.map(row => structuredClone(row))
  }
  const query = {
    select: () => query,
    eq: (column: string, value: unknown) => { filters.push(row => value !== null && row[column] === value); return query },
    is: (column: string, value: unknown) => { filters.push(row => row[column] === value); return query },
    in: (column: string, values: unknown[]) => { filters.push(row => values.includes(row[column])); return query },
    order: (column: string, options?: { ascending?: boolean }) => { order = [column, options?.ascending ?? true]; return query },
    limit: (count: number) => Object.assign(Promise.resolve({ data: rows().slice(0, count), error: null }), query),
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    single: async () => ({ data: rows()[0] ?? null, error: null }),
    update: () => query,
    insert: async () => ({ error: null }),
    then: (resolve: (value: { data: Row[]; error: null }) => unknown) => Promise.resolve({ data: rows(), error: null }).then(resolve),
  }
  return query
} } }))
vi.mock('@/lib/ediel/db', () => ({ getEdielMessageById: async () => null, createEdielMessageEvent: vi.fn(), linkEdielMessage: vi.fn() }))
vi.mock('@/lib/customers/canonicalOnboarding', async original => ({ ...await original<Record<string, unknown>>(),
  onboardCustomerGraph: async (command: Row) => { io.commands.push(structuredClone(command)); throw Error('command captured') } }))

import { approveEdielInboundCase } from '@/lib/ediel/inboundCases'

const TENANT = '00000000-0000-4000-8000-0000000002a0', OTHER = '00000000-0000-4000-8000-0000000002b0'
const CASE = '00000000-0000-4000-8000-0000000002c0', ACTOR = '00000000-0000-4000-8000-0000000002c1'
const CUSTOMER = '00000000-0000-4000-8000-0000000002c2', SITE = '00000000-0000-4000-8000-0000000002c3'
const POINT = '00000000-0000-4000-8000-0000000002c4', CREATOR = '00000000-0000-4000-8000-0000000002c5'
const GSRN = '735999999999999911'

const customer = (): Row => ({ id: CUSTOMER, company_id: TENANT, customer_type: 'private', status: 'active', first_name: 'Syntet',
  last_name: 'Testsson', full_name: 'Syntet Testsson', company_name: null, personal_number: '199001011234', normalized_personal_number: '199001011234',
  org_number: null, normalized_org_number: null, source: 'admin', metadata: { crm: 'kept', test_center: true }, created_by: CREATOR, updated_by: CREATOR })
const site = (): Row => ({ id: SITE, company_id: TENANT, customer_id: CUSTOMER, site_name: 'Hemma', facility_id: GSRN, normalized_facility_id: GSRN,
  site_type: 'consumption', status: 'active', move_in_date: '2026-01-01', annual_consumption_kwh: 12000, street: 'Syntetgatan 1', postal_code: '12345',
  city: 'Teststad', country: 'SE', internal_notes: 'Manual note', created_by: CREATOR, updated_by: CREATOR, created_at: '2026-01-01T00:00:00Z' })
const point = (): Row => ({ id: POINT, company_id: TENANT, customer_id: CUSTOMER, site_id: SITE, meter_point_id: GSRN, metering_point_id: GSRN,
  normalized_metering_point_id: GSRN, site_facility_id: GSRN, ediel_reference: 'REF-1', status: 'active', measurement_type: 'consumption',
  reading_frequency: 'monthly', start_date: '2026-01-01', is_settlement_relevant: true, created_by: CREATOR, updated_by: CREATOR, created_at: '2026-01-01T00:00:00Z' })

/** The inbound message carries the customer's name and the point; no personal number, address or annual consumption. */
const inboundCase = (extra: { customer?: Row; site?: Row; meter?: Row; caseRow?: Row } = {}): Row => ({
  id: CASE, company_id: TENANT, ediel_message_id: '00000000-0000-4000-8000-0000000002c6', case_type: 'Z04', message_family: 'PRODAT',
  message_code: 'Z04', transaction_type: 'Z22', status: 'pending_review', customer_id: CUSTOMER, site_id: SITE, metering_point_id: POINT,
  parsed_customer: { fullName: 'Syntet Testsson', ...extra.customer }, parsed_site: { facilityId: GSRN, gridAreaCode: null, ...extra.site },
  parsed_metering_point: { meterPointId: GSRN, ...extra.meter }, parsed_contract: {}, parsed_production: {}, proposed_action: {}, review_decision: null,
  ...extra.caseRow,
})

type Command = { customer: Row; site: Row; metering_point: Row; update_existing: boolean; existing_customer_id: string | null }
const approve = async (mode: 'update_existing_customer' | 'link_existing_only' | 'create_new_customer', caseRow: Row = inboundCase(),
  selection: { selectedCustomerId?: string | null; selectedSiteId?: string | null; selectedMeteringPointId?: string | null } = { selectedCustomerId: CUSTOMER }) => {
  io.tables.ediel_inbound_cases = [caseRow]
  io.commands = []
  await expect(approveEdielInboundCase({ actorUserId: ACTOR, companyId: TENANT, caseId: CASE, mode, ...selection })).rejects.toThrow('command captured')
  expect(io.commands).toHaveLength(1)
  return io.commands[0] as unknown as Command
}
/** Declared in-memory projection only: the real SQL test executes the actual
 * locked preserve/metadata-merge helper and checks exact PostgreSQL values. */
const assignPresentKeys = (row: Row, payload: Row): Row => ({ ...row, ...payload,
 ...(payload.metadata&&typeof payload.metadata==='object'?{metadata:{...(row.metadata as Row??{}),...(payload.metadata as Row)}}:{}),
})

beforeEach(() => {
  io.basisError=null;io.invalidBasis=false
  io.tables = {
    grid_owners: [], platform_grid_areas: [], platform_grid_owners: [],
    customers: [customer(), { ...customer(), company_id: OTHER, status: 'draft', personal_number: null, metadata: {} }],
    customer_sites: [site()],
    metering_points: [point()],
  }
})

describe('update or link of an existing graph never downgrades or erases it', () => {
  it.each(['update_existing_customer', 'link_existing_only'] as const)('%s: active stays active and absent wire values keep the existing ones', async mode => {
    const command = await approve(mode)
    const after = { customer: assignPresentKeys(customer(), command.customer), site: assignPresentKeys(site(), command.site),
      point: assignPresentKeys(point(), command.metering_point) }
    expect([after.customer.status, after.site.status, after.point.status]).toEqual(['active', 'active', 'active'])
    expect(after.customer).toMatchObject({ personal_number: '199001011234', source: 'admin', created_by: CREATOR, customer_type: 'private' })
    // Metadata is merged: the existing keys stay and the inbound lineage is added.
    expect(after.customer.metadata).toEqual({ crm: 'kept', test_center: true, inboundCaseId: CASE, edielMessageId: '00000000-0000-4000-8000-0000000002c6', caseType: 'Z04' })
    expect(after.site).toMatchObject({ street: 'Syntetgatan 1', postal_code: '12345', city: 'Teststad', annual_consumption_kwh: 12000, move_in_date: '2026-01-01',
      site_name: 'Hemma', internal_notes: 'Manual note', created_by: CREATOR })
    expect(after.point).toMatchObject({ reading_frequency: 'monthly', ediel_reference: 'REF-1', start_date: '2026-01-01', created_by: CREATOR })
    // The actor of the approval is recorded.
    expect([after.customer.updated_by, after.site.updated_by, after.point.updated_by]).toEqual([ACTOR, ACTOR, ACTOR])
    // No key is written that the existing row does not already have or that the message did not carry.
    expect(command.customer).not.toHaveProperty('status', 'draft')
    expect(command.site).not.toHaveProperty('status', 'draft')
    expect(command.metering_point).not.toHaveProperty('status', 'draft')
  })

  it('a value the inbound message carries still updates the existing graph', async () => {
    const command = await approve('update_existing_customer', inboundCase({
      customer: { customerType: 'private', fullName: 'Syntet Nyname', firstName: 'Syntet', lastName: 'Nyname', personalNumber: '199001011234' },
      site: { street: 'Nygatan 2', postalCode: '54321', city: 'Nystad', annualEnergyKwh: 8000, siteName: `Ediel ${GSRN}` },
      meter: { readingFrequency: 'D', referenceToMeteringPoint: 'REF-2' },
    }))
    const after = { customer: assignPresentKeys(customer(), command.customer), site: assignPresentKeys(site(), command.site),
      point: assignPresentKeys(point(), command.metering_point) }
    expect(after.customer).toMatchObject({ full_name: 'Syntet Nyname', last_name: 'Nyname', personal_number: '199001011234', status: 'active' })
    expect(after.site).toMatchObject({ street: 'Nygatan 2', postal_code: '54321', city: 'Nystad', annual_consumption_kwh: 8000, status: 'active' })
    // The staged site name is a generated label (`Ediel <point>`), not a wire value: it never renames an existing site.
    expect(after.site.site_name).toBe('Hemma')
    expect(after.point).toMatchObject({ reading_frequency: 'daily', ediel_reference: 'REF-2', status: 'active' })
  })

  it('resolves the existing graph like the RPC when nothing is selected: personal number, then facility and point of that customer', async () => {
    const command = await approve('update_existing_customer',
      inboundCase({ customer: { customerType: 'private', personalNumber: '19900101-1234' }, caseRow: { customer_id: null, site_id: null, metering_point_id: null } }),
      { selectedCustomerId: null })
    expect(command.existing_customer_id).toBeNull()
    const after = { customer: assignPresentKeys(customer(), command.customer), site: assignPresentKeys(site(), command.site),
      point: assignPresentKeys(point(), command.metering_point) }
    expect([after.customer.status, after.site.status, after.point.status]).toEqual(['active', 'active', 'active'])
    expect(after.site).toMatchObject({ street: 'Syntetgatan 1', annual_consumption_kwh: 12000 })
    expect(after.customer.metadata).toMatchObject({ crm: 'kept' })
  })

  it('keeps every command key, holding the existing value, so the stored command shows what was written', async () => {
    // The approved SC-031 public Z05L oracle (scripts/ediel-at-z14vh-z15v-esco-native.test.ts) reads the stored command:
    // an existing site without annual consumption and an hourly point stay so, and the keys remain present.
    io.tables.customer_sites = [{ ...site(), annual_consumption_kwh: null }]
    io.tables.metering_points = [{ ...point(), reading_frequency: 'hourly' }]
    const command = await approve('update_existing_customer')
    expect(command.site.annual_consumption_kwh).toBeNull()
    expect(command.metering_point.reading_frequency).toBe('hourly')
    expect(Object.keys(command.site)).toContain('street')
    expect(command.site.street).toBe('Syntetgatan 1')
  })

  it("never reads another tenant's row into the command", async () => {
    io.tables.customers = [{ ...customer(), company_id: OTHER }]
    io.tables.customer_sites = [{ ...site(), company_id: OTHER }]
    io.tables.metering_points = [{ ...point(), company_id: OTHER }]
    const command = await approve('update_existing_customer')
    expect(JSON.stringify(command)).not.toContain('Syntetgatan')
    expect(JSON.stringify(command)).not.toContain('"crm"')
  })
})

describe('create mode is unchanged', () => {
  it('a new customer graph is still created as draft from the message values', async () => {
    const command = await approve('create_new_customer', inboundCase({ caseRow: { customer_id: null, site_id: null, metering_point_id: null } }), {})
    expect(command.update_existing).toBe(false)
    expect(command.customer).toMatchObject({ status: 'draft', personal_number: null, source: 'ediel_inbound', created_by: ACTOR,
      metadata: { inboundCaseId: CASE, edielMessageId: '00000000-0000-4000-8000-0000000002c6', caseType: 'Z04' } })
    expect(command.site).toMatchObject({ status: 'draft', street: null, postal_code: null, city: null, annual_consumption_kwh: null, created_by: ACTOR })
    expect(command.metering_point).toMatchObject({ status: 'draft', reading_frequency: 'hourly', created_by: ACTOR })
  })
})


describe('single-case preserved graph compare-and-set boundary', () => {
  it('sends original lineage delta, never copied existing metadata, while opaque row text carries the exact basis',async()=>{
    const command=await approve('update_existing_customer') as unknown as Row
    expect((command.customer as Row).metadata).toEqual({inboundCaseId:CASE,edielMessageId:'00000000-0000-4000-8000-0000000002c6',caseType:'Z04'})
    const directive=(command.ediel_existing_graph_preservation as Row).customer as Row
    expect(directive.metadata_delta).toEqual((command.customer as Row).metadata)
    expect(directive.wire_keys).not.toContain('status');expect(directive.wire_keys).not.toContain('created_by')
    expect((command.ediel_existing_graph_snapshot as Row).customer).toBe(JSON.stringify(customer()))
  })
  it('does not call onboarding when the compatible basis reader is unavailable',async()=>{
    io.tables.ediel_inbound_cases=[inboundCase()];io.commands=[];io.basisError=Error('ediel_inbound_graph_core_not_ready')
    await expect(approveEdielInboundCase({actorUserId:ACTOR,companyId:TENANT,caseId:CASE,mode:'update_existing_customer',selectedCustomerId:CUSTOMER})).rejects.toThrow('ediel_inbound_graph_core_not_ready')
    expect(io.commands).toEqual([])
  })
  it('does not accept an unknown or expanded basis RPC response shape',async()=>{
    io.tables.ediel_inbound_cases=[inboundCase()];io.commands=[];io.invalidBasis=true
    await expect(approveEdielInboundCase({actorUserId:ACTOR,companyId:TENANT,caseId:CASE,mode:'update_existing_customer',selectedCustomerId:CUSTOMER})).rejects.toThrow('ediel_inbound_graph_snapshot_basis_invalid')
    expect(io.commands).toEqual([])
  })

  it('binds all three exact pre-read rows, without merging inbound lineage into the expected metadata', async () => {
    const command = await approve('update_existing_customer')
    expect(command).toHaveProperty('ediel_existing_graph_snapshot', {
      customer: JSON.stringify(customer()), site: JSON.stringify(site()), metering_point: JSON.stringify(point()),
    })
    expect(command.customer.metadata).toMatchObject({ inboundCaseId: CASE })
  })

  it('also binds a naturally matched graph so a concurrent edit cannot bypass selected-row checks', async () => {
    const command = await approve('update_existing_customer',
      inboundCase({ customer: { customerType: 'private', personalNumber: '19900101-1234' }, caseRow: { customer_id: null, site_id: null, metering_point_id: null } }),
      { selectedCustomerId: null })
    expect(command).toHaveProperty('ediel_existing_graph_snapshot', {
      customer: JSON.stringify(customer()), site: JSON.stringify(site()), metering_point: JSON.stringify(point()),
    })
  })

  it('binds absent rows explicitly so a new match appearing before RPC is rejected rather than overwritten', async () => {
    io.tables.customers = []
    io.tables.customer_sites = []
    io.tables.metering_points = []
    const command = await approve('update_existing_customer', inboundCase({ caseRow: { customer_id: null, site_id: null, metering_point_id: null } }), {})
    expect(command).toHaveProperty('ediel_existing_graph_snapshot', {
      customer: null, site: null, metering_point: null,
    })
  })

  it('keeps create-separate commands outside the existing-row snapshot protocol', async () => {
    const command = await approve('create_new_customer', inboundCase({ caseRow: { customer_id: null, site_id: null, metering_point_id: null } }), {})
    expect(command).not.toHaveProperty('ediel_existing_graph_snapshot')
  })
})
