import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({
  companyId: 'guard-A' as string | null,
  actor: 'operator',
  platform: false,
  denied: false,
  rows: new Map<string, Record<string, unknown>>(),
  audit: [] as Array<Record<string, unknown>>,
  create: vi.fn(), update: vi.fn(), getCase: vi.fn(), note: vi.fn(), reply: vi.fn(), phone: vi.fn(), attachment: vi.fn(),
  getOutbound: vi.fn(), listOutbound: vi.fn(), refresh: vi.fn(), retry: vi.fn(),
  revalidate: vi.fn(), legacy: vi.fn(), requestedPermissions: [] as string[][],
}))
vi.mock('@/lib/admin/guards', () => ({
  requireAdminActionAccess: async (permissions: string[]) => {
    io.requestedPermissions.push(permissions)
    if (io.denied) throw new Error('permission_denied')
    return { userId: io.actor, email: 'operator@example.invalid', roles: [],
      permissions: ['cases.write', 'switching.write'], companyId: io.companyId, isPlatformAdmin: io.platform }
  },
  requireAdminPageKeyAccess: async () => ({
    userId: io.actor, email: 'operator@example.invalid', roles: [],
    permissions: ['cases.read', 'cases.write'], companyId: io.companyId, isPlatformAdmin: io.platform,
  }),
  isPlatformAdminContext: () => io.platform,
}))
vi.mock('@/lib/tenant/scope', () => ({
  TenantCompanyRequiredError: class extends Error { constructor() { super('canonical_company_required') } },
  getOperationalCompanyScope: io.legacy,
}))
vi.mock('next/cache', () => ({ revalidatePath: io.revalidate }))
vi.mock('@/lib/customer-cases/support', () => ({
  createTenantSupportCase: io.create,
  listTenantSupportCustomerOptions: async () => [{ id: 'customer-A', label: 'Provkund' }],
}))
vi.mock('@/components/admin/AdminHeader', () => ({ default: () => null }))
vi.mock('@/lib/customer-portal/caseProjection', () => ({ isPortalCompletionCase: () => false }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/customer-cases/db', () => ({
  getCustomerCaseById: io.getCase, updateObservedSupportCaseStatus: io.update,
  listCustomerCases: async () => [renderedCase],
  listCustomerCaseEvents: async () => [],
}))
vi.mock('@/lib/customer-service/supportConversation', async (original) => ({
  ...await original<typeof import('@/lib/customer-service/supportConversation')>(),
  PHONE_VERIFICATION_METHODS: { known_customer: 'Fixture verification' },
  addInternalNote: io.note, recordPhoneInteraction: io.phone, replyToCustomer: io.reply,
  publicSupportStatus: () => 'received',
  SUPPORT_EVENT_TYPES: { customerMessage: 'customer_message', staffReply: 'staff_reply', internalNote: 'internal_note', phoneInteraction: 'phone_interaction' },
}))
vi.mock('@/lib/customer-service/supportAttachments', () => ({
  SUPPORT_ATTACHMENT_OPS_MAX_BYTES: 4_000_000, SUPPORT_ATTACHMENT_LIST_PAGE_SIZE: 25, addSupportAttachment: io.attachment,
  listSupportAttachmentsPage: async () => ({ items: [], page: { next_cursor: null } }),
}))
vi.mock('@/lib/cis/db', () => ({
  getOutboundRequestById: io.getOutbound, listUnresolvedOutboundRequests: io.listOutbound,
  resolveLegacyOutboundRoute: io.refresh,
}))
vi.mock('@/lib/operations/db', () => ({ createSupplierSwitchEvent: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: 'operator' } } }) },
}) }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from: (table: string) => ({ insert: async (row: Record<string, unknown>) => {
    expect(table).toBe('audit_logs'); io.audit.push(row); return { error: null }
  } }),
} }))

import {
  addInternalNoteAction,
  createCustomerCaseFromFormAction,
  recordPhoneInteractionAction,
  replyToCustomerAction,
  updateCustomerCaseStatusAction,
  uploadSupportAttachmentAction,
} from '@/app/admin/customer-cases/actions'
import { rerunAllUnresolvedRouteResolutionsAction, rerunUnresolvedRouteResolutionAction } from '@/app/admin/outbound/unresolved/actions'

import SupportListPage from '@/app/admin/customer-cases/page'
import SupportDetailPage from '@/app/admin/customer-cases/[caseId]/page'

const renderedCase = {
  id: '34050000-0000-4000-8000-000000000001',
  company_id: 'guard-A',
  customer_id: 'customer-A',
  source: 'tenant_support_admin',
  case_type: 'other', status: 'open', title: 'Provärende', created_at: '2026-11-01T12:00:00Z',
  metadata: { support_case: true },
}
const currentForm = { expected_company_id: 'guard-A', expected_actor_user_id: 'operator' }

const form = (values: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(values)) data.set(key, value)
  return data
}
const createForm = () => form({ customer_id: 'customer-A', title: 'Fixture support case', ...currentForm })
const outboundForm = (id = 'outbound-A') => form({ outbound_request_id: id, customer_id: `customer-${id.slice(-1)}` })

beforeEach(() => {
  io.companyId = 'guard-A'; io.actor = 'operator'; io.platform = false; io.denied = false; io.audit = []; io.requestedPermissions = []
  for (const mock of [io.create, io.update, io.getCase, io.note, io.reply, io.phone, io.attachment, io.getOutbound, io.listOutbound, io.refresh, io.retry, io.revalidate, io.legacy]) mock.mockReset()
  io.legacy.mockResolvedValue({ companyId: 'legacy-B', companyName: 'Legacy B', message: null })
  io.create.mockImplementation(async input => {
    const owner = input.customerId === 'customer-A' ? 'guard-A' : 'legacy-B'
    // The production support graph checks customer ownership of the supplied
    // company; it cannot determine which company the permission guard chose.
    if (input.companyId !== owner) throw new Error('support_customer_not_found_in_company')
    return { case: { id: 'created-case', company_id: input.companyId }, reused: false }
  })
  io.update.mockImplementation(async input => {
    if (input.companyId !== 'guard-A') throw new Error('case_not_found_in_company')
  })
  io.getCase.mockImplementation(async (id, company) => company === 'guard-A'
    ? { ...renderedCase, id, company_id: company } : null)
  io.rows = new Map(['A', 'B'].map(suffix => [`outbound-${suffix}`, {
    id: `outbound-${suffix}`, company_id: suffix === 'A' ? 'guard-A' : 'legacy-B', customer_id: `customer-${suffix}`,
    channel_type: 'unresolved', status: 'queued', request_type: 'meter_values', source_type: 'metering', source_id: null,
  }]))
  io.getOutbound.mockImplementation(async id => io.rows.get(id) ?? null)
  io.listOutbound.mockImplementation(async ({ companyId }) => [...io.rows.values()].filter(row => companyId === null || row.company_id === companyId))
  io.refresh.mockImplementation(async ({ request }) => {
    io.audit.push({ company_id: request.company_id, entity_id: request.id })
    return { status: 'resolved', request: { ...request, channel_type: 'api' }, requeued: false }
  })
})

it('creates support under the canonical permission company and retains the rendered-form tenant fence', async () => {
  await createCustomerCaseFromFormAction(createForm())
  expect(io.create).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'guard-A', actorUserId: 'operator' }))
  expect(io.legacy).not.toHaveBeenCalled()
})

it('does not create a legacy-company customer case using permission granted for another company', async () => {
  await expect(createCustomerCaseFromFormAction(form({ ...currentForm, customer_id: 'customer-B', title: 'Fixture case' })))
    .rejects.toThrow('support_customer_not_found_in_company')
  expect(io.create).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'guard-A' }))
  expect(io.revalidate).not.toHaveBeenCalled()
})

it('refuses a stale company tab before invoking the support writer', async () => {
  await expect(createCustomerCaseFromFormAction(form({ customer_id: 'customer-B', title: 'Fixture case', expected_company_id: 'legacy-B' })))
    .rejects.toThrow('annan flik')
  expect(io.create).not.toHaveBeenCalled()
})

it('uses the canonical company for support status and conversation ownership', async () => {
  await updateCustomerCaseStatusAction(form({ ...currentForm, case_id: 'case-A', expected_case_status: 'open', status: 'resolved' }))
  await addInternalNoteAction(form({ ...currentForm, case_id: 'case-A', message: 'Fixture internal note' }))
  expect(io.update).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'guard-A', caseId: 'case-A' }))
  expect(io.getCase).toHaveBeenCalledWith('case-A', 'guard-A')
  expect(io.note).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'guard-A', actorUserId: 'operator' }))
})

it.each([
  createCustomerCaseFromFormAction,
  updateCustomerCaseStatusAction,
  replyToCustomerAction,
  addInternalNoteAction,
  recordPhoneInteractionAction,
  uploadSupportAttachmentAction,
])('%o requires cases.write before reading the case or accepting a stale form', async action => {
  const stale = form({ case_id: 'case-A', expected_company_id: 'legacy-B' })
  io.denied = true
  await expect(action(stale)).rejects.toThrow('permission_denied')
  expect(io.requestedPermissions).toEqual([['cases.write']])

  io.denied = false
  await expect(action(stale)).rejects.toThrow('annan flik')
  expect(io.requestedPermissions).toEqual([['cases.write'], ['cases.write']])
  expect(io.getCase).not.toHaveBeenCalled()
  expect(io.create).not.toHaveBeenCalled()
  expect(io.update).not.toHaveBeenCalled()
  expect(io.note).not.toHaveBeenCalled()
  expect(io.revalidate).not.toHaveBeenCalled()
})

it('binds the create, status, attachment and conversation forms to the same rendered staff account', async () => {
  const list = renderToStaticMarkup(await SupportListPage({ searchParams: Promise.resolve({}) }))
  const detail = renderToStaticMarkup(await SupportDetailPage({ params: Promise.resolve({ caseId: renderedCase.id }) }))
  for (const html of [list, detail]) {
    expect(html.match(/name="expected_company_id" value="guard-A"/g)).toHaveLength(2)
    expect(html.match(/name="expected_actor_user_id" value="operator"/g)).toHaveLength(2)
  }
  expect(detail).toContain('Hantera ärendet')
})

it.each([
  createCustomerCaseFromFormAction,
  updateCustomerCaseStatusAction,
  replyToCustomerAction,
  addInternalNoteAction,
  recordPhoneInteractionAction,
  uploadSupportAttachmentAction,
])('rejects the old rendered account in %o before any ordinary read or domain port', async action => {
  const old = form({
    ...currentForm, case_id: renderedCase.id, customer_id: renderedCase.customer_id,
    title: 'Unsaved support form', status: 'resolved', message: 'inert text', summary: 'inert notes', verification_method: 'known_customer',
  })
  old.set('file', new File(['local test fixture'], 'fixture.pdf', { type: 'application/pdf' }))
  io.actor = 'other-authorized-staff'
  await expect(action(old)).rejects.toThrow('Inloggningen har ändrats')
  for (const operation of [io.getCase, io.create, io.update, io.reply, io.note, io.phone, io.attachment, io.revalidate]) {
    expect(operation).not.toHaveBeenCalled()
  }
})

it.each(['missing actor', 'repeated actor', 'missing company', 'repeated company'])('rejects %s before create', async condition => {
  const pending = createForm()
  if (condition === 'missing actor') pending.delete('expected_actor_user_id')
  if (condition === 'repeated actor') pending.append('expected_actor_user_id', 'operator')
  if (condition === 'missing company') pending.delete('expected_company_id')
  if (condition === 'repeated company') pending.append('expected_company_id', 'guard-A')
  await expect(createCustomerCaseFromFormAction(pending)).rejects.toThrow(/Inloggningen har ändrats|Aktiv organisation har bytts/)
  expect(io.create).not.toHaveBeenCalled()
})

it('keeps repeated submissions for the same operator scoped to the original key', async () => {
  const first = createForm()
  first.set('idempotency_key', 'same-retained-key')
  const second = createForm()
  second.set('idempotency_key', 'same-retained-key')
  await createCustomerCaseFromFormAction(first)
  await createCustomerCaseFromFormAction(second)
  expect(io.create.mock.calls.map(([input]) => [input.companyId, input.customerId, input.actorUserId, input.idempotencyKey]))
    .toEqual(Array.from({ length: 2 }, () => ['guard-A', 'customer-A', 'operator', 'same-retained-key']))
})

it('reruns the canonical company outbound row even when legacy selection differs', async () => {
  await rerunUnresolvedRouteResolutionAction(outboundForm())
  expect(io.refresh).toHaveBeenCalledWith({ actorUserId: 'operator', request: io.rows.get('outbound-A'), mode: 'rerun' })
  expect(io.audit[0].company_id).toBe('guard-A')
  expect(io.legacy).not.toHaveBeenCalled()
})

it('refuses a foreign outbound row before any route or audit mutation', async () => {
  await expect(rerunUnresolvedRouteResolutionAction(outboundForm('outbound-B'))).rejects.toThrow('saknar åtkomst')
  expect(io.refresh).not.toHaveBeenCalled(); expect(io.retry).not.toHaveBeenCalled(); expect(io.audit).toEqual([])
})

it('bulk rerun selects only the company covered by the existing permission guard', async () => {
  await rerunAllUnresolvedRouteResolutionsAction()
  expect(io.listOutbound).toHaveBeenCalledWith({ companyId: 'guard-A' })
  expect(io.refresh.mock.calls.map(([input]) => input.request.id)).toEqual(['outbound-A'])
  expect(io.audit.every(row => row.company_id === 'guard-A')).toBe(true)
})

it.each([
  ['support', () => createCustomerCaseFromFormAction(createForm())],
  ['outbound row', () => rerunUnresolvedRouteResolutionAction(outboundForm())],
  ['outbound bulk', () => rerunAllUnresolvedRouteResolutionsAction()],
] as const)('%s rejects explicit null tenant before mutation and never borrows a legacy company', async (_name, action) => {
  io.companyId = null
  await expect(action()).rejects.toThrow()
  expect(io.create).not.toHaveBeenCalled(); expect(io.refresh).not.toHaveBeenCalled()
  expect(io.listOutbound).not.toHaveBeenCalled(); expect(io.audit).toEqual([])
})

it.each([
  ['support', () => createCustomerCaseFromFormAction(createForm())],
  ['outbound', () => rerunAllUnresolvedRouteResolutionsAction()],
] as const)('%s retains the existing permission refusal before reads or writes', async (_name, action) => {
  io.denied = true
  await expect(action()).rejects.toThrow('permission_denied')
  expect(io.getOutbound).not.toHaveBeenCalled(); expect(io.listOutbound).not.toHaveBeenCalled()
  expect(io.create).not.toHaveBeenCalled(); expect(io.refresh).not.toHaveBeenCalled(); expect(io.audit).toEqual([])
})

it('platform outbound keeps global bulk scope independently of a selected company', async () => {
  io.platform = true
  await rerunAllUnresolvedRouteResolutionsAction()
  expect(io.listOutbound).toHaveBeenCalledWith({ companyId: null })
  expect(io.refresh.mock.calls.map(([input]) => input.request.id)).toEqual(['outbound-A', 'outbound-B'])
  expect(io.audit.at(-1)?.company_id).toBeNull()
})

it('platform support retains the explicit selected company and cannot invent one', async () => {
  io.platform = true
  await createCustomerCaseFromFormAction(createForm())
  expect(io.create).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'guard-A' }))
  io.create.mockClear(); io.companyId = null
  await expect(createCustomerCaseFromFormAction(createForm())).rejects.toThrow()
  expect(io.create).not.toHaveBeenCalled()
})

it('holds a route with transport history before updating audit or refreshing the page', async () => {
  io.refresh.mockResolvedValueOnce({ status: 'held', reason: 'transport_history', request: io.rows.get('outbound-A') })
  await expect(rerunUnresolvedRouteResolutionAction(outboundForm())).rejects.toThrow('transporthistorik')
  expect(io.audit).toEqual([])
  expect(io.revalidate).not.toHaveBeenCalled()
})

it('continues bulk route processing and reports the held row with no requeue audit', async () => {
  io.platform = true
  io.refresh.mockResolvedValueOnce({ status: 'held', reason: 'transport_history', request: io.rows.get('outbound-A') })
  await rerunAllUnresolvedRouteResolutionsAction()
  expect(io.refresh.mock.calls.map(([input]) => input.request.id)).toEqual(['outbound-A', 'outbound-B'])
  expect(io.audit.some(row => row.entity_id === 'outbound-A')).toBe(false)
  expect(io.audit.at(-1)?.metadata).toMatchObject({ heldCount: 1, resolvedCount: 1, requeuedCount: 0 })
})


it.each(['resolved', 'closed', 'cancelled', 'awaiting_external_response'])(
  'rejects the same operator’s previously rendered status form when the case is now %s',
  async (currentStatus) => {
    io.getCase.mockResolvedValueOnce({ ...renderedCase, status: currentStatus })
    const previous = form({ ...currentForm, case_id: renderedCase.id, expected_case_status: 'open', status: 'manual_follow_up' })
    await expect(updateCustomerCaseStatusAction(previous)).rejects.toThrow('Ladda om sidan innan du sparar.')
    expect(io.getCase).toHaveBeenCalledExactlyOnceWith(renderedCase.id, 'guard-A')
    expect(io.update).not.toHaveBeenCalled()
    expect(io.revalidate).not.toHaveBeenCalled()
  },
)

it.each(['missing status', 'duplicate status', 'observed terminal status'])(
  'rejects a status form with %s before requesting a write',
  async (condition) => {
    const previous = form({ ...currentForm, case_id: renderedCase.id, expected_case_status: 'open', status: 'manual_follow_up' })
    if (condition === 'missing status') previous.delete('expected_case_status')
    if (condition === 'duplicate status') previous.append('expected_case_status', 'open')
    if (condition === 'observed terminal status') {
      io.getCase.mockResolvedValueOnce({ ...renderedCase, status: 'resolved' })
      previous.set('expected_case_status', 'resolved')
    }
    await expect(updateCustomerCaseStatusAction(previous)).rejects.toThrow('Ladda om sidan innan du sparar.')
    expect(io.update).not.toHaveBeenCalled()
    expect(io.revalidate).not.toHaveBeenCalled()
  },
)

it('binds the visible queue status to its form and keeps a current transition available', async () => {
  const markup = renderToStaticMarkup(await SupportListPage({ searchParams: Promise.resolve({}) }))
  expect(markup).toContain('name="expected_case_status" value="open"')
  await updateCustomerCaseStatusAction(form({
    ...currentForm, case_id: renderedCase.id, expected_case_status: 'open', status: 'closed',
  }))
  expect(io.update).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    caseId: renderedCase.id, customerId: renderedCase.customer_id, status: 'closed',
    expectedSource: renderedCase.source, expectedStatus: 'open',
  }))
})

it('reports a concurrent status conflict without retrying or revalidating the queue', async () => {
  io.update.mockRejectedValueOnce({ code: 'PT409', message: 'ops_support_case_status_changed' })
  const previous = form({ ...currentForm, case_id: renderedCase.id, expected_case_status: 'open', status: 'resolved' })
  await expect(updateCustomerCaseStatusAction(previous)).rejects.toThrow('Ladda om sidan innan du sparar.')
  expect(io.update).toHaveBeenCalledTimes(1)
  expect(io.revalidate).not.toHaveBeenCalled()
})
