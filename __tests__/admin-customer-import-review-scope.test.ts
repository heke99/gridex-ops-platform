import { beforeEach, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({
  guard: vi.fn(),
  legacyGuard: vi.fn(),
  lifecycle: vi.fn(),
  query: vi.fn(),
  graph: vi.fn(),
  audit: vi.fn(),
  reviewWrite: vi.fn(),
  receiptRead: vi.fn(),
  batchUpdate: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/admin/guards', () => ({
  requireAdminActionAccess: io.guard,
  requireCompanyScopedActionAccess: io.legacyGuard,
  isPlatformAdminContext: (access: { isPlatformAdmin: boolean }) => access.isPlatformAdmin,
}))
vi.mock('@/lib/tenant/governance', () => ({ requireCompanyOperationalForWrites: io.lifecycle }))
vi.mock('@/lib/tenant/scope', () => ({
  TenantCompanyRequiredError: Error,
  getOperationalCompanyScope: vi.fn(),
}))
vi.mock('@/lib/customers/importParser', () => ({ parseCustomerImportFormData: vi.fn() }))
vi.mock('@/lib/intakes/customerApplicationIntakes', () => ({
  getOrCreateCustomerApplicationIntake: vi.fn(),
  completeCustomerApplicationIntake: vi.fn(),
  failCustomerApplicationIntake: vi.fn(),
}))
vi.mock('@/app/admin/customers/actions.part-1', () => ({
  getActorUserId: async () => 'reviewer-a',
  getString: (data: FormData, field: string) => String(data.get(field) ?? ''),
  insertAuditLog: io.audit,
  normalizeBillingLevel: () => null,
  normalizeCustomerType: () => 'private',
  normalizeDuplicateResolution: (value: string) => value,
  normalizeIntakeFlowType: () => null,
  parseNumber: () => null,
  parseIntOrNull: () => null,
  parseOptionalFeeLines: () => [],
}))
vi.mock('@/app/admin/customers/actions.part-2', () => ({
  createCustomerGraph: io.graph,
  databaseObjectMissing: () => false,
}))
vi.mock('@/app/admin/customers/actions.part-4', () => ({
  rowValue: (row: Record<string, string>, ...keys: string[]) => keys.map((key) => row[key]).find(Boolean),
}))

vi.mock('@/lib/supabase/service', () => {
  function query(table: string, operation: string, payload: unknown) {
    const predicates: Record<string, string | null> = {}
    let returning: string | undefined
    const chain = {
      eq: (key: string, value: string) => {
        predicates[key] = value
        return chain
      },
      is: (key: string, value: null) => {
        predicates[key] = value
        return chain
      },
      select: (columns: string) => {
        returning = columns
        return chain
      },
      maybeSingle: () => returning === undefined
        ? io.query(table, operation, payload, predicates, 'single')
        : io.query(table, operation, payload, predicates, 'single', returning),
      then: (resolve: (result: unknown) => void, reject: (error: unknown) => void) =>
        Promise.resolve(io.query(table, operation, payload, predicates, 'many')).then(resolve, reject),
    }
    return chain
  }
  return { supabaseService: { from: (table: string) => ({
    select: (columns: string) => query(table, 'select', columns),
    update: (fields: object) => query(table, 'update', fields),
  }) } }
})

import {
  createCustomerFromImportRowAction,
  linkCustomerImportRowToExistingCustomerAction,
  rejectCustomerImportRowAction,
} from '@/app/admin/customers/actions'

const commands = [
  ['create', createCustomerFromImportRowAction, 'created'],
  ['link', linkCustomerImportRowToExistingCustomerAction, 'created'],
  ['reject', rejectCustomerImportRowAction, 'rejected'],
] as const

const selected = {
  userId: 'reviewer-a', companyId: 'company-a', isPlatformAdmin: false, permissions: ['customers.write'], roles: [],
}
const row = {
  id: 'review-row', company_id: selected.companyId, import_batch_id: 'batch-a',
  status: 'requires_review', customer_id: null, row_number: 7,
  reviewed_at: null, reviewed_by: null, resolution: null,
  normalized_payload: { first_name: 'Test', last_name: 'Kund' },
}

const linkReceiptColumns = 'id, company_id, status, customer_id, reviewed_at, reviewed_by, resolution, error_message'
const createReceiptColumns = 'id, company_id, status, customer_id, reviewed_at, reviewed_by, error_message'
const reviewReceiptFrom = (stored: object) => ({ ...stored, id: row.id, company_id: selected.companyId })

const form = () => {
  const data = new FormData()
  data.set('importRowId', row.id)
  data.set('existingCustomerId', 'customer-a')
  return data
}

beforeEach(() => {
  vi.resetAllMocks()
  io.guard.mockResolvedValue(selected)
  io.legacyGuard.mockResolvedValue(selected)
  io.lifecycle.mockResolvedValue(undefined)
  io.graph.mockResolvedValue({ id: 'customer-a' })
  io.audit.mockResolvedValue({ id: 'audit-a' })
  io.reviewWrite.mockImplementation(async (stored) => ({ data: reviewReceiptFrom(stored), error: null }))
  io.receiptRead.mockResolvedValue({ data: null, error: null })
  io.batchUpdate.mockResolvedValue({ data: null, error: null })
  io.query.mockImplementation(async (table, operation, payload, _predicates, shape) => {
    if (table === 'customer_import_rows' && operation === 'select') {
      if (payload === linkReceiptColumns || payload === createReceiptColumns) return io.receiptRead()
      return { data: shape === 'single' ? row : [{ status: 'created' }], error: null }
    }
    if (table === 'customer_import_rows' && operation === 'update' && ['created', 'rejected'].includes(payload.status)) {
      return io.reviewWrite(payload)
    }
    if (table === 'customer_import_batches' && operation === 'update') return io.batchUpdate()
    if (operation === 'update') return { data: null, error: null }
    throw new Error('Unexpected query: ' + table)
  })
})

it.each(commands)('keeps %s available for an authorized reviewer and scopes each queue effect', async (operation, run, status) => {
  await run(form())
  expect(io.guard).toHaveBeenCalledWith({ allOf: ['customers.write'] })
  expect(io.lifecycle).toHaveBeenCalledWith(selected.companyId)
  expect(io.guard.mock.invocationCallOrder[0]).toBeLessThan(io.lifecycle.mock.invocationCallOrder[0])
  expect(io.lifecycle.mock.invocationCallOrder[0]).toBeLessThan(io.query.mock.invocationCallOrder[0])
  expect(io.query).toHaveBeenCalledTimes(4)
  expect(io.query).toHaveBeenCalledWith('customer_import_rows', 'select', '*', { id: row.id, company_id: selected.companyId }, 'single')
  expect(io.query).toHaveBeenCalledWith(
    'customer_import_rows', 'update',
    expect.objectContaining({ status, customer_id: operation === 'reject' ? null : 'customer-a' }),
    { id: row.id, company_id: selected.companyId, status: row.status, customer_id: null },
    'single', operation === 'link' ? linkReceiptColumns : createReceiptColumns,
  )
  expect(io.query).toHaveBeenCalledWith('customer_import_rows', 'select', 'status', { import_batch_id: row.import_batch_id, company_id: selected.companyId }, 'many')
  expect(io.query).toHaveBeenCalledWith('customer_import_batches', 'update', expect.any(Object), { id: row.import_batch_id, company_id: selected.companyId }, 'many')
  expect(io.audit).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: selected.userId, companyId: selected.companyId }))
  if (operation === 'reject') expect(io.graph).not.toHaveBeenCalled()
  else expect(io.graph).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: selected.userId, companyId: selected.companyId }))
})

it.each(commands)('does not start %s when the selected company write gate refuses the operation', async (_operation, run) => {
  io.lifecycle.mockRejectedValue(new Error('Bolaget är pausat'))
  await expect(run(form())).rejects.toThrow('Bolaget är pausat')
  expect(io.query).not.toHaveBeenCalled()
  expect(io.graph).not.toHaveBeenCalled()
  expect(io.audit).not.toHaveBeenCalled()
})

it('does not query import rows before customer write permission is established', async () => {
  io.guard.mockRejectedValue(new Error('Saknar ändringsbehörighet'))
  await expect(rejectCustomerImportRowAction(form())).rejects.toThrow('Saknar ändringsbehörighet')
  expect(io.lifecycle).not.toHaveBeenCalled()
  expect(io.query).not.toHaveBeenCalled()
  expect(io.audit).not.toHaveBeenCalled()
})

it('requires selection for platform reviewers before issuing a query', async () => {
  io.guard.mockResolvedValue({ ...selected, isPlatformAdmin: true, companyId: null })
  await expect(createCustomerFromImportRowAction(form())).rejects.toThrow('Välj ett bolag')
  expect(io.lifecycle).not.toHaveBeenCalled()
  expect(io.query).not.toHaveBeenCalled()
  expect(io.graph).not.toHaveBeenCalled()
})

it('leaves the graph unchanged when a slim legacy queue cannot save the link', async () => {
  const slimRow: Partial<typeof row> = { ...row }
  delete slimRow.reviewed_at
  delete slimRow.reviewed_by
  delete slimRow.resolution
  io.query.mockResolvedValueOnce({ data: slimRow, error: null })
  await expect(linkCustomerImportRowToExistingCustomerAction(form())).rejects.toThrow('Kundposten har inte ändrats')
  expect(io.graph).not.toHaveBeenCalled()
  expect(io.reviewWrite).not.toHaveBeenCalled()
  expect(io.audit).not.toHaveBeenCalled()
})

it('does not record a completed link when the graph returns a different customer', async () => {
  io.graph.mockResolvedValue({ id: 'customer-unexpected' })
  await expect(linkCustomerImportRowToExistingCustomerAction(form())).rejects.toThrow('annan kund än den valda')
  expect(io.reviewWrite).not.toHaveBeenCalled()
  expect(io.audit).not.toHaveBeenCalled()
})

it.each([
  ['missing final row', { data: null, error: null }],
  ['missing column', { data: null, error: { code: '42703' } }],
  ['mismatched company', { data: { ...row, company_id: 'company-unexpected' }, error: null }],
] as const)('reports an unconfirmed link without emitting success for %s', async (_, writeResult) => {
  io.reviewWrite.mockResolvedValue(writeResult)
  await expect(linkCustomerImportRowToExistingCustomerAction(form())).rejects.toThrow('kunde inte bekräftas tillsammans')
  expect(io.graph).toHaveBeenCalledOnce()
  expect(io.query).toHaveBeenCalledWith(
    'customer_import_rows', 'select', linkReceiptColumns,
    { id: row.id, company_id: selected.companyId }, 'single',
  )
  expect(io.audit).not.toHaveBeenCalled()
  expect(io.query.mock.calls.some(([table]) => table === 'customer_import_batches')).toBe(false)
})

it('confirms a lost write response by checking the exact saved state', async () => {
  io.reviewWrite.mockImplementation(async (values) => {
    const time = values.reviewed_at.replace('Z', '+00:00')
    io.receiptRead.mockResolvedValue({ data: reviewReceiptFrom({ ...values, reviewed_at: time }), error: null })
    return { data: null, error: { code: 'connection_lost' } }
  })
  await linkCustomerImportRowToExistingCustomerAction(form())
  expect(io.graph).toHaveBeenCalledOnce()
  expect(io.reviewWrite).toHaveBeenCalledOnce()
  expect(io.receiptRead).toHaveBeenCalledOnce()
  expect(io.audit).toHaveBeenCalledWith(expect.objectContaining({
    action: 'customer_import_row_linked_existing_customer',
    companyId: selected.companyId,
    entityId: row.id,
  }))
  expect(io.receiptRead.mock.invocationCallOrder[0]).toBeLessThan(io.audit.mock.invocationCallOrder[0])
})

it.each([
  ['create', createCustomerFromImportRowAction],
  ['link', linkCustomerImportRowToExistingCustomerAction],
] as const)('does not %s a customer from a previously rejected import row', async (_, run) => {
  io.query.mockResolvedValueOnce({ data: { ...row, status: 'rejected' }, error: null })
  await expect(run(form())).rejects.toThrow('Importraden är avvisad')
  expect(io.query).toHaveBeenCalledTimes(1)
  expect(io.graph).not.toHaveBeenCalled()
  expect(io.audit).not.toHaveBeenCalled()
})

it('leaves the graph unchanged when an older review row cannot store the creation', async () => {
  const slimRow: Partial<typeof row> = { ...row }
  delete slimRow.reviewed_at
  io.query.mockResolvedValueOnce({ data: slimRow, error: null })
  await expect(createCustomerFromImportRowAction(form())).rejects.toThrow('Kundposten har inte ändrats')
  expect(io.graph).not.toHaveBeenCalled()
  expect(io.reviewWrite).not.toHaveBeenCalled()
  expect(io.audit).not.toHaveBeenCalled()
})

it('stores a created customer on review rows that have no link resolution column', async () => {
  const olderRow: Partial<typeof row> = { ...row }
  delete olderRow.resolution
  io.query.mockResolvedValueOnce({ data: olderRow, error: null })
  await createCustomerFromImportRowAction(form())
  expect(io.reviewWrite).toHaveBeenCalledOnce()
  expect(io.reviewWrite.mock.calls[0][0]).not.toHaveProperty('resolution')
  expect(io.audit).toHaveBeenCalledWith(expect.objectContaining({
    action: 'customer_import_row_created_customer',
    companyId: selected.companyId,
    entityId: row.id,
  }))
})

it.each(['audit', 'batch'] as const)('preserves verified created state when the %s follow-up fails', async (failedStage) => {
  const failed = new Error('Syntetiskt fel efter skapad kund')
  if (failedStage === 'audit') io.audit.mockRejectedValue(failed)
  else io.batchUpdate.mockResolvedValue({ data: null, error: failed })
  await expect(createCustomerFromImportRowAction(form())).rejects.toThrow(failed.message)
  const rowUpdates = io.query.mock.calls.filter(([table, operation]) => table === 'customer_import_rows' && operation === 'update')
  expect(rowUpdates).toHaveLength(1)
  expect(rowUpdates[0][2]).toEqual(expect.objectContaining({ status: 'created', customer_id: 'customer-a' }))
  expect(io.audit).toHaveBeenCalledOnce()
  expect(io.reviewWrite.mock.invocationCallOrder[0]).toBeLessThan(io.audit.mock.invocationCallOrder[0])
})

it('keeps the last confirmed queue state when the graph cannot be confirmed', async () => {
  io.graph.mockRejectedValue(new Error('Grafbesked saknas'))
  await expect(createCustomerFromImportRowAction(form())).rejects.toThrow('Grafbesked saknas')
  expect(io.query).toHaveBeenCalledTimes(1)
  expect(io.audit).not.toHaveBeenCalled()
})

it('does not audit a created customer when the review row has no confirmed receipt', async () => {
  io.reviewWrite.mockResolvedValue({ data: null, error: null })
  await expect(createCustomerFromImportRowAction(form())).rejects.toThrow('kunde inte bekräftas tillsammans')
  expect(io.graph).toHaveBeenCalledOnce()
  expect(io.receiptRead).toHaveBeenCalledOnce()
  expect(io.audit).not.toHaveBeenCalled()
})

it.each([
  ['a linked row', { ...row, customer_id: 'customer-a' }, 'kan inte avvisas'],
  ['an already rejected row', { ...row, status: 'rejected' }, 'redan avvisad'],
] as const)('leaves %s unchanged when a rejection form is resubmitted', async (_, currentRow, message) => {
  io.query.mockResolvedValueOnce({ data: currentRow, error: null })
  await expect(rejectCustomerImportRowAction(form())).rejects.toThrow(message)
  expect(io.query).toHaveBeenCalledTimes(1)
  expect(io.reviewWrite).not.toHaveBeenCalled()
  expect(io.audit).not.toHaveBeenCalled()
})

it('preserves a customer link finalized after the reviewer read the row', async () => {
  io.reviewWrite.mockResolvedValue({ data: null, error: null })
  io.receiptRead.mockResolvedValue({
    data: { ...row, status: 'created', customer_id: 'customer-a' }, error: null,
  })
  await expect(rejectCustomerImportRowAction(form())).rejects.toThrow('Avvisningen kunde inte bekräftas')
  expect(io.query).toHaveBeenCalledWith(
    'customer_import_rows', 'update', expect.objectContaining({ status: 'rejected' }),
    { id: row.id, company_id: selected.companyId, status: row.status, customer_id: null },
    'single', createReceiptColumns,
  )
  expect(io.query).toHaveBeenCalledWith(
    'customer_import_rows', 'select', createReceiptColumns,
    { id: row.id, company_id: selected.companyId }, 'single',
  )
  expect(io.reviewWrite).toHaveBeenCalledOnce()
  expect(io.audit).not.toHaveBeenCalled()
  expect(io.batchUpdate).not.toHaveBeenCalled()
})

it('confirms a lost rejection response by validating the stored state before audit', async () => {
  io.reviewWrite.mockImplementation(async (draft) => {
    io.receiptRead.mockResolvedValue({ data: reviewReceiptFrom(draft), error: null })
    return { data: null, error: { code: 'connection_lost' } }
  })
  const request = form()
  request.set('reason', 'Saknar verifierbara uppgifter')
  await rejectCustomerImportRowAction(request)
  expect(io.receiptRead).toHaveBeenCalledOnce()
  expect(io.audit).toHaveBeenCalledWith(expect.objectContaining({
    companyId: selected.companyId,
    entityId: row.id,
    action: 'customer_import_row_rejected',
    newValues: { status: 'rejected', reason: 'Saknar verifierbara uppgifter' },
  }))
  expect(io.receiptRead.mock.invocationCallOrder[0]).toBeLessThan(io.audit.mock.invocationCallOrder[0])
})

it('declines a rejection with a different stored reason', async () => {
  io.reviewWrite.mockImplementation(async (draft) => ({
    data: reviewReceiptFrom({ ...draft, error_message: 'Annan orsak' }), error: null,
  }))
  await expect(rejectCustomerImportRowAction(form())).rejects.toThrow('Avvisningen kunde inte bekräftas')
  expect(io.audit).not.toHaveBeenCalled()
})
