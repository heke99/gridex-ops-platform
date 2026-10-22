// FINDINGS F51 (owner decision 2026-10-22): at manual intake the logged-in staff member enters the customer's
// own registered address (folkbokföringsadress). It is stored once as the customer's single current
// `registered` address with provenance staff_entry, the staff member and the intake as reference. The facility
// and invoice addresses are never stored or used as the registered address.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const state = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  ledger: null as null | { created: boolean; intake: Row },
  graphCalls: [] as Array<Record<string, unknown>>,
  onboardCommands: [] as Array<Record<string, unknown>>,
  failWriter: false,
  fromCalls: 0,
  seq: 0,
}))

/** In-memory stand-in for the service-role client: select/insert/update with eq/in filters. */
function fakeFrom(table: string) {
  state.fromCalls += 1
  let op: 'select' | 'insert' | 'update' = 'select'
  let patch: Row = {}
  let rows: Row[] = []
  const filters: Array<(row: Row) => boolean> = []
  const rowsOf = () => (state.tables[table] ??= [])
  const run = () => {
    if (state.failWriter && table === 'customer_addresses' && op !== 'select') return { data: null, error: { message: 'write refused' } }
    if (op === 'insert') {
      const inserted = rows.map(row => ({ id: `${table}-${++state.seq}`, ...row }))
      rowsOf().push(...inserted)
      return { data: inserted, error: null }
    }
    const hit = rowsOf().filter(row => filters.every(filter => filter(row)))
    if (op === 'update') hit.forEach(row => Object.assign(row, patch))
    return { data: hit, error: null }
  }
  const query: Record<string, unknown> = {
    select: () => query, order: () => query, limit: () => query, ilike: () => query, neq: () => query, or: () => query, not: () => query, is: () => query,
    insert: (value: Row | Row[]) => { op = 'insert'; rows = Array.isArray(value) ? value : [value]; return query },
    update: (value: Row) => { op = 'update'; patch = value; return query },
    eq: (column: string, value: unknown) => { filters.push(row => row[column] === value); return query },
    in: (column: string, values: unknown[]) => { filters.push(row => values.includes(row[column])); return query },
    single: async () => { const result = run(); return result.error ? result : { data: (result.data as Row[])[0] ?? null, error: null } },
    maybeSingle: async () => { const result = run(); return result.error ? result : { data: (result.data as Row[])[0] ?? null, error: null } },
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject),
  }
  return query
}

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: (table: string) => fakeFrom(table), rpc: vi.fn() } }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: vi.fn() }))
vi.mock('@/lib/admin/guards', () => ({
  requireAdminActionAccess: vi.fn(async () => ({ permissions: ['customers.write'] })),
  requireCompanyScopedActionAccess: vi.fn(), isPlatformAdminContext: () => false,
}))
vi.mock('@/lib/tenant/scope', () => ({ requireOperationalCompanyId: vi.fn(async () => 'company-a') }))
vi.mock('@/lib/tenant/governance', () => ({ requireCompanyOperationalForWrites: vi.fn(async () => undefined) }))
vi.mock('@/lib/intakes/customerApplicationIntakes', () => ({
  getOrCreateCustomerApplicationIntake: vi.fn(async () => state.ledger),
  completeCustomerApplicationIntake: vi.fn(async () => undefined),
  failCustomerApplicationIntake: vi.fn(async () => undefined),
}))
vi.mock('@/lib/customers/matchingService', () => ({ matchCustomerIdentity: vi.fn(async () => ({ candidates: [] })) }))
vi.mock('@/lib/grid-owners/platformGridOwnerResolver', () => ({ normalizeGridOwnerIdToOps: vi.fn(async () => ({ opsGridOwnerId: null })) }))
vi.mock('@/lib/customer-operations/customerIntakeOrchestrator', () => ({ processManualCustomerIntake: vi.fn(async () => undefined), processPdfCustomerIntake: vi.fn(async () => undefined) }))
vi.mock('@/lib/customers/canonicalOnboarding', async importOriginal => ({
  ...(await importOriginal<object>()),
  onboardCustomerGraph: vi.fn(async (command: Record<string, unknown>) => {
    state.onboardCommands.push(command)
    state.tables.customers = [{ id: 'customer-1', company_id: command.company_id, customer_number: 'K-1' }]
    return { ok: true, customer_id: 'customer-1', site_id: null, metering_point_id: null, contract_id: null, power_of_attorney_id: null, authorization_document_id: null, created_new_customer: true, correlation_id: 'corr-1' }
  }),
}))
vi.mock('@/app/admin/customers/actions.part-1', async importOriginal => ({
  ...(await importOriginal<object>()),
  getActorUserId: vi.fn(async () => 'actor-1'),
  resolveOrCreateGridOwnerForIntake: vi.fn(async () => ({ gridOwnerId: null, warnings: [] })),
  resolveOrCreateCurrentSupplierForIntake: vi.fn(async () => ({ supplierId: null, name: null, orgNumber: null, warnings: [] })),
}))
vi.mock('@/app/admin/customers/actions.part-2', async importOriginal => {
  const original = await importOriginal<typeof import('@/app/admin/customers/actions.part-2')>()
  const part1 = await import('@/app/admin/customers/actions.part-1')
  return {
    ...original,
    // The action-level stand-in for the graph: the same validation-before-write, then a committed customer.
    createCustomerGraph: vi.fn(async (params: Record<string, unknown>) => {
      const errors = part1.validateCreateCustomerParams(params as never)
      if (Object.keys(errors).length > 0) throw part1.createValidationErrorFromFieldErrors(errors)
      state.graphCalls.push(params)
      return { id: 'customer-1', customer_number: 'K-1', __createdNewCustomer: true, __postCommitWarnings: [] }
    }),
  }
})

import { buildCreateCustomerParams, intakeRegisteredAddress, validateCreateCustomerParams } from '@/app/admin/customers/actions.part-1'
import { createCustomerAction } from '@/app/admin/customers/actions.part-3'

const ACTOR = '00000000-0000-4000-8000-000000000001'
const COMPANY = '00000000-0000-4000-8000-00000000000a'
const facilityAndInvoice = {
  customerType: 'private', intakeFlowType: 'switch', firstName: 'Eva', lastName: 'Exempel', personalNumber: '199001011239',
  street: 'Kungsgatan 12', postalCode: '441 30', city: 'Alingsås',
  billingStreet: 'Fakturavägen 1', billingPostalCode: '111 22', billingCity: 'Stockholm',
}
const registered = { registeredStreet: 'Storgatan 5', registeredStreet2: 'c/o Andersson', registeredPostalCode: '44131', registeredCity: 'Alingsås' }
const form = (fields: Record<string, string>) => { const data = new FormData(); for (const [key, value] of Object.entries(fields)) data.set(key, value); return data }
const params = (fields: Record<string, string>) => buildCreateCustomerParams(form(fields), ACTOR, COMPANY)
const registeredRows = () => (state.tables.customer_addresses ?? []).filter(row => row.type === 'registered')

beforeEach(() => {
  state.tables = {}; state.graphCalls = []; state.onboardCommands = []; state.failWriter = false; state.fromCalls = 0; state.seq = 0
  state.ledger = { created: true, intake: { id: 'intake-1', status: 'received', updated_at: new Date().toISOString(), result: null, customer_id: null } }
})

describe('manual intake registered address — validation', () => {
  it('a private customer switching supplier must have a registered address, even when facility and invoice addresses are filled', () => {
    const errors = validateCreateCustomerParams(params(facilityAndInvoice))
    expect(errors.registeredStreet).toContain('gatuadress')
    expect(errors.registeredPostalCode).toContain('postnummer')
    expect(errors.registeredCity).toContain('postort')
  })

  it('rejects a malformed postal code and a street longer than the Ediel limit', () => {
    const errors = validateCreateCustomerParams(params({ ...facilityAndInvoice, ...registered, registeredPostalCode: '4413', registeredStreet: 'x'.repeat(36) }))
    expect(errors.registeredPostalCode).toContain('fem siffror')
    expect(errors.registeredStreet).toContain('35')
    expect(errors.registeredCity).toBeUndefined()
  })

  it('accepts a complete registered address', () => {
    const errors = validateCreateCustomerParams(params({ ...facilityAndInvoice, ...registered }))
    expect(Object.keys(errors).filter(key => key.startsWith('registered'))).toEqual([])
  })

  it('is not required for an intake saved blocked or attached to an existing customer, but a partial entry is still checked', () => {
    expect(validateCreateCustomerParams(params({ ...facilityAndInvoice, intakeCreateMode: 'create_blocked' })).registeredStreet).toBeUndefined()
    expect(validateCreateCustomerParams(params({ ...facilityAndInvoice, existingCustomerId: 'customer-0', duplicateResolution: 'add_site_to_existing' })).registeredStreet).toBeUndefined()
    const partial = validateCreateCustomerParams(params({ ...facilityAndInvoice, intakeCreateMode: 'create_blocked', registeredStreet: 'Storgatan 5' }))
    expect(partial.registeredPostalCode).toBeDefined()
    expect(partial.registeredCity).toBeDefined()
  })

  it('a company is asked for the organisation’s own registered address (Z01 uses it with the SE1 identity)', () => {
    const errors = validateCreateCustomerParams(params({ ...facilityAndInvoice, customerType: 'business', companyName: 'Exempel AB', orgNumber: '5560000001', personalNumber: '' }))
    expect(errors.registeredStreet).toBe('Ange organisationens registrerade gatuadress.')
    expect(errors.registeredCity).toBe('Ange organisationens registrerade postort.')
  })

  it('takes the registered address only from its own fields, never from the facility or invoice address', () => {
    expect(intakeRegisteredAddress(params(facilityAndInvoice))).toBeNull()
    expect(intakeRegisteredAddress(params({ ...facilityAndInvoice, ...registered }))).toEqual({
      street: 'Storgatan 5', street2: 'c/o Andersson', postalCode: '44131', city: 'Alingsås', country: 'SE',
    })
  })
})

describe('manual intake registered address — the customer graph', () => {
  it('never writes the facility address as a registered address row', async () => {
    const { createCustomerGraph } = await vi.importActual<typeof import('@/app/admin/customers/actions.part-2')>('@/app/admin/customers/actions.part-2')
    await createCustomerGraph(params({ ...facilityAndInvoice, ...registered }))
    expect(state.onboardCommands).toHaveLength(1)
    expect(state.onboardCommands[0].address).toBeNull()
    expect(JSON.stringify(state.onboardCommands[0])).not.toContain('"registered"')
  })

  it('refuses an intake without a registered address before anything is written', async () => {
    const { createCustomerGraph } = await vi.importActual<typeof import('@/app/admin/customers/actions.part-2')>('@/app/admin/customers/actions.part-2')
    await expect(createCustomerGraph(params(facilityAndInvoice))).rejects.toMatchObject({ name: 'IntakeValidationError', fieldErrors: { registeredStreet: expect.any(String) } })
    expect(state.onboardCommands).toHaveLength(0)
    expect(state.fromCalls).toBe(0)
  })
})

describe('manual intake registered address — the intake action', () => {
  it('stores the entered address once as the customer’s registered address with staff provenance and the intake reference', async () => {
    const result = await createCustomerAction({} as never, form({ ...facilityAndInvoice, ...registered }))
    expect(result.status, result.message ?? '').toBe('success')
    const rows = registeredRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      company_id: 'company-a', customer_id: 'customer-1', type: 'registered', is_active: true, moved_in_at: null,
      street_1: 'Storgatan 5', street_2: 'c/o Andersson', postal_code: '441 31', city: 'Alingsås', country: 'SE',
      created_by: 'actor-1',
      metadata: { registered_address_source: 'staff_entry', declared_by: 'actor-1', source_reference: 'intake-1' },
    })
    expect(result.createdRegisteredAddressId).toBe(rows[0].id)
    // Neither the facility nor the invoice address became a customer address of type registered.
    expect(rows.some(row => row.street_1 === 'Kungsgatan 12' || row.street_1 === 'Fakturavägen 1')).toBe(false)
  })

  it('an identical second submission replays the completed intake and stores nothing more', async () => {
    await createCustomerAction({} as never, form({ ...facilityAndInvoice, ...registered }))
    state.ledger = { created: false, intake: { id: 'intake-1', status: 'completed', updated_at: new Date().toISOString(), result: { customer_id: 'customer-1' }, customer_id: 'customer-1' } }
    expect((await createCustomerAction({} as never, form({ ...facilityAndInvoice, ...registered }))).status).toBe('success')
    expect(registeredRows()).toHaveLength(1)
    expect(state.graphCalls).toHaveLength(1)
  })

  it('returns field errors and creates no customer when the registered address is missing', async () => {
    const result = await createCustomerAction({} as never, form(facilityAndInvoice))
    expect(result.status).toBe('error')
    expect(result.fieldErrors.registeredStreet).toBeDefined()
    expect(result.values.street).toBe('Kungsgatan 12')
    expect(state.graphCalls).toHaveLength(0)
    expect(registeredRows()).toHaveLength(0)
  })

  it('a blocked intake without the address creates the customer but no registered address', async () => {
    const result = await createCustomerAction({} as never, form({ ...facilityAndInvoice, intakeCreateMode: 'create_blocked' }))
    expect(result.status).toBe('success')
    expect(state.graphCalls).toHaveLength(1)
    expect(registeredRows()).toHaveLength(0)
    expect(result.createdRegisteredAddressId).toBeNull()
  })

  it('a failed address write after commit keeps the customer and tells the employee to enter it on the card', async () => {
    state.failWriter = true
    const result = await createCustomerAction({} as never, form({ ...facilityAndInvoice, ...registered }))
    expect(result.status).toBe('success')
    expect(result.createdCustomerId).toBe('customer-1')
    expect(result.createdRegisteredAddressId).toBeNull()
    expect(result.duplicateWarnings).toEqual(expect.arrayContaining([expect.stringContaining('Folkbokföringsadressen kunde inte sparas')]))
    expect(registeredRows()).toHaveLength(0)
  })
})
