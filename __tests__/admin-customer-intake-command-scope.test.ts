import { beforeEach, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  access: vi.fn(), membershipScope: vi.fn(), lifecycle: vi.fn(), parse: vi.fn(),
  build: vi.fn(), intake: vi.fn(), insert: vi.fn(), matching: vi.fn(), importRowsRead: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/admin/guards', () => ({
  requireAdminActionAccess: fixture.access,
  isPlatformAdminContext: (value: { isPlatformAdmin?: boolean }) => value.isPlatformAdmin === true,
}))
vi.mock('@/lib/tenant/scope', () => ({
  getOperationalCompanyScope: fixture.membershipScope,
  requireOperationalCompanyId: async () => (await fixture.membershipScope()).companyId,
  TenantCompanyRequiredError: Error,
}))
vi.mock('@/lib/tenant/governance', () => ({ requireCompanyOperationalForWrites: fixture.lifecycle }))
vi.mock('@/lib/customers/importParser', () => ({ parseCustomerImportFormData: fixture.parse }))
vi.mock('@/lib/customers/matchingService', () => ({ matchCustomerIdentity: fixture.matching }))
vi.mock('@/lib/intakes/customerApplicationIntakes', () => ({
  getOrCreateCustomerApplicationIntake: fixture.intake,
}))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from: (table: string) => ({
      insert: (data: unknown) => fixture.insert(table, data),
      select: (columns: string) => ({
        eq: (column: string, value: string) => ({
          limit: (limit: number) => fixture.importRowsRead(table, columns, column, value, limit),
        }),
      }),
    }),
  },
}))
vi.mock('@/app/admin/customers/actions.part-1', () => ({
  getActorUserId: async () => 'staff-a',
  buildCreateCustomerParams: fixture.build,
  getNullableString: () => null,
  getFormValues: () => ({}),
  normalizeCustomerType: () => "private",
}))
vi.mock('@/app/admin/customers/actions.part-2', () => ({
  ADMIN_INTAKE_ROUTE: 'admin-intake',
  databaseObjectMissing: () => false,
  mapUnknownErrorToIntakeState: (error: Error) => ({ status: 'error', message: error.message }),
}))

import { commitCustomerImportAction, createCustomerAction, previewCustomerImportAction } from '@/app/admin/customers/actions'
import { initialCustomerImportActionState, initialIntakeActionState } from '@/app/admin/customers/actionState'

const companyContext = (companyId: string | null, isPlatformAdmin: boolean, permissions = ['customers.write']) => ({
  userId: 'staff-a', companyId, isPlatformAdmin, permissions, roles: [],
})

const setContext = (context: ReturnType<typeof companyContext>) => {
  fixture.access.mockImplementation(async (requirement: unknown) => {
    expect(requirement).toEqual({ allOf: ['customers.write'] })
    if (!context.isPlatformAdmin && !context.permissions.includes('customers.write')) throw new Error('Forbidden')
    return context
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  fixture.membershipScope.mockResolvedValue({ companyId: 'company-b' })
  fixture.parse.mockResolvedValue({
    sourceKind: 'pdf', warnings: [], rawText: 'Synthetic import', rows: [{ first_name: 'Test', last_name: 'Person' }],
  })
  fixture.build.mockImplementation((_, actorUserId: string, companyId: string) => ({
    companyId, actorUserId, customerType: 'private', optionalFeeLines: [],
  }))
  fixture.intake.mockRejectedValue(new Error('Synthetic intake boundary'))
  fixture.importRowsRead.mockResolvedValue({ data: [], error: null })
  fixture.insert.mockImplementation((table: string) => {
    if (table === 'document_ai_extractions') return { error: null }
    if (table === 'customer_import_batches') throw new Error('Synthetic import batch boundary')
    throw new Error('Unexpected writer')
  })
  fixture.matching.mockResolvedValue({ candidates: [] })
})

const runActions = (data: FormData) => Promise.all([
  createCustomerAction(initialIntakeActionState, data),
  previewCustomerImportAction(initialCustomerImportActionState, data),
  commitCustomerImportAction(initialCustomerImportActionState, data),
])

it.each([
  ['company-a', false], ['company-b', false], ['company-a', true],
] as const)('keeps all three customer intake commands on the selected %s with platform=%s', async (companyId, platform) => {
  setContext(companyContext(companyId, platform, platform ? [] : ['customers.write']))
  const [manual, preview, commit] = await runActions(new FormData())
  expect(manual.message).toBe('Synthetic intake boundary')
  expect(preview.status, preview.message ?? undefined).toBe('success')
  expect(commit.message).toBe('Synthetic import batch boundary')
  expect(fixture.intake).toHaveBeenCalledWith(expect.objectContaining({ companyId, method: 'create' }))
  expect(fixture.insert).toHaveBeenCalledWith('document_ai_extractions', expect.objectContaining({ company_id: companyId, created_by: 'staff-a' }))
  expect(fixture.importRowsRead).toHaveBeenCalledWith('customer_import_rows', 'id', 'company_id', companyId, 0)
  expect(fixture.insert).toHaveBeenCalledWith('customer_import_batches', expect.objectContaining({ company_id: companyId, created_by: 'staff-a' }))
  expect(fixture.matching).toHaveBeenCalledWith(expect.objectContaining({ companyId }))
  expect(fixture.lifecycle).toHaveBeenCalledTimes(3)
  expect(fixture.membershipScope).not.toHaveBeenCalled()
})

it.each([
  ['a reader', companyContext('company-a', false, ['masterdata.read']), 'Forbidden'],
  ['unselected platform', companyContext(null, true, []), 'Välj ett bolag'],
  ['a paused selected company', companyContext('company-a', true, []), 'Pausat bolag'],
] as const)('blocks parsing and every writer for %s', async (_, context, reason) => {
  setContext(context)
  if (reason === 'Pausat bolag') fixture.lifecycle.mockRejectedValue(new Error(reason))
  const results = await runActions(new FormData())
  for (const result of results) {
    expect(result.status).toBe('error')
    expect(result.message).toContain(reason)
  }
  for (const port of [fixture.parse, fixture.intake, fixture.insert, fixture.matching, fixture.importRowsRead]) {
    expect(port).not.toHaveBeenCalled()
  }
})


it.each([
  [['customers.write'], false, false],
  [['customers.write', 'masterdata.read'], false, false],
  [['customers.write', 'masterdata.write'], false, true],
  [[], true, true],
] as const)('checks the direct request choice before recording an intake (%j, platform=%s)', async (rights, platform, allowed) => {
  setContext(companyContext('company-a', platform, [...rights]))
  const form = new FormData()
  form.set('postCreateActionOverride', 'request_data')
  fixture.build.mockImplementation((value: FormData, actorUserId: string, companyId: string) => ({
    companyId, actorUserId, customerType: 'private', optionalFeeLines: [],
    postCreateAction: value.get('postCreateActionOverride'),
  }))
  const result = await createCustomerAction(initialIntakeActionState, form)
  if (allowed) {
    expect(result.message).toBe('Synthetic intake boundary')
    expect(fixture.intake).toHaveBeenCalledOnce()
  } else {
    expect(result.message).toContain('Direkt uppgiftsbegäran kräver behörighet')
    expect(fixture.intake).not.toHaveBeenCalled()
  }
})
