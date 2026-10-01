import { beforeEach, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement, type ReactNode } from 'react'

type Row = Record<string, unknown>
const f = vi.hoisted(() => ({
  company: '00000000-0000-4000-8000-000000001501', other: '00000000-0000-4000-8000-000000001502',
  actor: '00000000-0000-4000-8000-000000001503', customer: '00000000-0000-4000-8000-000000001504',
  session: '00000000-0000-4000-8000-000000001505', permissions: [] as string[], roles: ['viewer'],
  platform: false, loggedIn: true, customerCompany: '', scopeCompany: '', writes: [] as Row[], reads: [] as Row[],
  index: 0, hooks: [] as unknown[], dispatch: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const i = f.index++
    if (!Object.hasOwn(f.hooks, i)) f.hooks[i] = typeof initial === 'function' ? initial() : initial
    return [f.hooks[i], (value: unknown) => { f.hooks[i] = typeof value === 'function' ? value(f.hooks[i]) : value }]
  },
  useRef: (initial: unknown) => { const i = f.index++; if (!Object.hasOwn(f.hooks,i)) f.hooks[i] = { current: initial }; return f.hooks[i] },
  useCallback: (callback: unknown) => { f.index++; return callback },
  useContext: () => { f.index++; return () => undefined },
  useId: () => `note-capability-${f.index++}`,
  useEffect: () => { f.index++ },
  useActionState: (_callback: unknown, initial: unknown) => { f.index++; return [initial, f.dispatch, false] },
}))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: f.company }) }) }))
vi.mock('@/lib/tenant/scope', () => ({
  listOperationalCompaniesForUser: async () => [{ companyId: f.company, membershipRole: f.roles[0], status: 'active', companyStatus: 'active' }],
  getOperationalCompanyScope: async () => ({ companyId: f.scopeCompany, companyName: 'Synthetic note company' }),
}))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({
  auth: { getUser: async () => ({ data: { user: f.loggedIn ? { id: f.actor } : null }, error: null }),
    getClaims: async () => ({ data: { claims: { sub: f.actor, session_id: f.session } }, error: null }) },
  rpc: async (name: string, input: Row) => {
    expect(name).toBe('canonical_authenticated_tenant_context'); expect(input).toEqual({ p_selected_company_id: f.company })
    return { data: { authorized: true, user_id: f.actor, selected_company_id: f.company,
      roles: f.roles, permissions: f.permissions, is_platform_admin: f.platform }, error: null }
  },
  from(table: string) {
    const predicates: Row = {}
    const result = () => {
      f.reads.push({ table, ...predicates })
      if (table === 'customers') return { data: { id: f.customer, company_id: f.customerCompany, full_name: 'Synthetic note customer',
        customer_type: 'private', status: 'active', contact_revision: 0, legal_profile_revision: 0, lifecycle_revision: 0,
        billing_profile_revision: 0, created_at: '2026-10-01T00:00:00Z' }, error: null }
      expect(['customer_contacts','customer_addresses']).toContain(table); return { data: [], error: null }
    }
    const q = { select: () => q, eq: (key: string, value: unknown) => { predicates[key] = value; return q }, order: () => q,
      maybeSingle: async () => result(), then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve) }
    return q
  },
}) }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from: (table: string) => { f.writes.push({ table }); throw new Error('unexpected_functional_test_write') },
  rpc: async (name: string, input: Row) => {
    expect(name).toBe('gridex_customer_ops_command_capabilities_v1')
    expect(input).toEqual({ p_company_id: f.customerCompany, p_customer_id: f.customer, p_user_id: f.actor, p_session_id: f.session })
    return { data: { companyId: f.customerCompany, customerId: f.customer, actorUserId: f.actor, sessionId: f.session,
      canEditContact: f.permissions.includes('masterdata.write'), canEditAddresses: f.permissions.includes('masterdata.write'),
      canEditBilling: false, canEditLegalProfile: false, canCloseLifecycle: false, canEditSites: false }, error: null }
  },
} }))
// Only outer business read models are controlled. Actual page facade, guard,
// tenant scope, current capability/session helpers and note components execute.
vi.mock('@/lib/masterdata/db', () => ({ listCustomerSitesByCustomerId: async () => [], listCustomerInternalNotesByCustomerId: async () => [],
  listMeteringPointsBySiteIds: async () => [], listGridOwners: async () => [], listPriceAreas: async () => [] }))
vi.mock('@/lib/customer-contracts/db', () => ({ listCustomerContractsByCustomerId: async () => [] }))
vi.mock('@/lib/operations/db', () => ({ listSupplierSwitchRequestsByCustomerId: async () => [], listPowersOfAttorneyByCustomerId: async () => [],
  listCustomerAuthorizationDocumentsByCustomerId: async () => [], listCustomerBlockersByCustomerId: async () => [] }))
vi.mock('@/lib/onboarding/infoRequests', () => ({ listCustomerInfoRequestsByCustomerId: async () => [] }))
vi.mock('@/lib/ediel/intent/dispatchState', () => ({ resolveEdielDispatchState: async () => null }))
vi.mock('@/lib/customer-operations/manualRequestSummary', () => ({ listManualGridOwnerRequestSummaries: async () => [] }))

import CustomerPage from '@/app/admin/customers/[id]/page'
import { NotesSection } from '@/app/admin/customers/[id]/page.part-2'
import CustomerInternalNoteForm from '@/components/admin/customers/CustomerInternalNoteForm'

function nodes(value: ReactNode): ReactElement<Row>[] {
  if (Array.isArray(value)) return value.flatMap(nodes)
  if (!isValidElement(value)) return []
  const node = value as ReactElement<Row>
  return [node,...nodes(node.props.children as ReactNode)]
}
async function actualForm() {
  const page = await CustomerPage({ params: Promise.resolve({ id: f.customer }), searchParams: Promise.resolve({ tab: 'notes' }) })
  const section = nodes(page).find(node => node.type === NotesSection)
  if (!section) return null
  const form = nodes(NotesSection(section.props as Parameters<typeof NotesSection>[0])).find(node => node.type === CustomerInternalNoteForm)
  expect(form).toBeTruthy()
  return form!
}
function controls(form: ReactElement<Row>, dirty = false) {
  const render = () => { f.index = 0; return nodes(CustomerInternalNoteForm(form.props as Parameters<typeof CustomerInternalNoteForm>[0])) }
  let elements = render()
  if (dirty) { (elements.find(node => node.type === 'form')!.props.onChange as () => void)(); elements = render() }
  return { elements, form: elements.find(node => node.type === 'form')!, fieldset: elements.find(node => node.type === 'fieldset')!,
    submit: elements.find(node => node.type === 'button' && node.props.type === 'submit')! }
}
beforeEach(() => {
  f.permissions = ['customers.read','masterdata.read']; f.roles = ['viewer']; f.platform = false; f.loggedIn = true
  f.customerCompany = f.company; f.scopeCompany = f.company; f.writes = []; f.reads = []; f.hooks = []; f.index = 0
  f.dispatch.mockReset()
})
it('actual current read-only customer page makes the private note editor unavailable before creating a draft', async () => {
  const form = await actualForm(); expect(form).not.toBeNull()
  expect(controls(form!).fieldset.props.disabled).toBe(true)
  expect(f.writes).toEqual([])
})
it('actual current read-only page cannot offer an enabled note-save control after a draft change', async () => {
  const form = await actualForm(); expect(form).not.toBeNull()
  expect(controls(form!,true).submit.props.disabled).toBe(true)
  expect(f.writes).toEqual([])
})
it('preserves an ordinary non-owner masterdata writer through the actual current page guard', async () => {
  f.permissions.push('masterdata.write'); f.roles = ['operations_agent']
  const form = await actualForm(); expect(form).not.toBeNull()
  const result = controls(form!,true); expect(result.fieldset.props.disabled).toBe(false); expect(result.submit.props.disabled).toBe(false)
  expect(f.writes).toEqual([])
})
it('preserves the authoritative global platform path with no duplicated role-name requirement', async () => {
  f.platform = true; f.permissions = []; f.roles = ['platform_admin']
  const form = await actualForm(); expect(form).not.toBeNull()
  expect(controls(form!,true).fieldset.props.disabled).toBe(false); expect(f.writes).toEqual([])
})
it('actual denied page permission redirects before customer reads or note editor rendering', async () => {
  f.permissions = ['integrations.read']
  await expect(actualForm()).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') })
  expect(f.reads).toEqual([]); expect(f.writes).toEqual([])
})
it('actual foreign customer read scope returns no note editor or mutation', async () => {
  f.customerCompany = f.other
  expect(await actualForm()).toBeNull(); expect(f.writes).toEqual([])
})
it('does not promote a canonical-false platform-named current reader to note writer', async () => {
  f.roles = ['platform_admin']
  const form = await actualForm(); expect(form).not.toBeNull()
  expect(controls(form!,true).fieldset.props.disabled).toBe(true); expect(f.writes).toEqual([])
})
it('does not apply an A masterdata grant to an inconsistent ordinary B read context', async () => {
  f.permissions.push('masterdata.write'); f.scopeCompany = f.other; f.customerCompany = f.other
  const form = await actualForm(); expect(form).not.toBeNull()
  expect(controls(form!,true).fieldset.props.disabled).toBe(true); expect(f.writes).toEqual([])
})
it('a fresh unavailable editor ignores change events and blocks the actual submit function before dispatch', async () => {
  const form = await actualForm(); expect(form).not.toBeNull()
  const rendered = controls(form!,true)
  expect(rendered.elements.some(node => node.type === 'p' && node.props.children === 'Osparad anteckning')).toBe(false)
  const event = { currentTarget: {}, preventDefault: vi.fn() }
  ;(rendered.form.props.onSubmit as (event: unknown) => void)(event)
  expect(event.preventDefault).toHaveBeenCalledOnce(); expect(f.dispatch).not.toHaveBeenCalled(); expect(f.writes).toEqual([])
})
it('later current capability loss preserves existing dirty state while blocking the actual submit', async () => {
  f.permissions.push('masterdata.write')
  const before = await actualForm(); expect(before).not.toBeNull()
  expect(controls(before!,true).submit.props.disabled).toBe(false)
  f.permissions = ['customers.read','masterdata.read']
  const after = await actualForm(); expect(after).not.toBeNull()
  const rendered = controls(after!)
  expect(rendered.fieldset.props.disabled).toBe(true)
  expect(rendered.elements.some(node => node.type === 'p' && node.props.children === 'Osparad anteckning')).toBe(true)
  const event = { currentTarget: {}, preventDefault: vi.fn() }
  ;(rendered.form.props.onSubmit as (event: unknown) => void)(event)
  expect(f.dispatch).not.toHaveBeenCalled(); expect(f.writes).toEqual([])
})
