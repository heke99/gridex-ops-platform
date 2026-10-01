import { afterEach, beforeEach, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const f = vi.hoisted(() => ({
  company: '00000000-0000-4000-8000-000000001401', foreign: '00000000-0000-4000-8000-000000001402',
  customer: '00000000-0000-4000-8000-000000001403', actor: '00000000-0000-4000-8000-000000001404',
  note: '00000000-0000-4000-8000-000000001405', other: '00000000-0000-4000-8000-000000001406',
  auth: vi.fn(), rpc: vi.fn(), memberships: vi.fn(), operational: vi.fn(), revalidate: vi.fn(),
  loggedIn: true, platform: false, roles: [] as string[], permissions: [] as string[], status: 'active',
  selected: '', operationalCompany: '', customerCompany: '', insertError: null as unknown, auditError: null as unknown,
  returned: {} as Row, readOverride: false, readReturned: null as Row | null, readError: null as unknown,
  notes: [] as Row[], audits: [] as Row[], usage: [] as Row[], reads: [] as Row[],
}))
vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: f.selected }) }) }))
vi.mock('next/cache', () => ({ revalidatePath: f.revalidate }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({ auth: { getUser: f.auth }, rpc: f.rpc }) }))
vi.mock('@/lib/tenant/scope', () => ({ listOperationalCompaniesForUser: f.memberships, requireOperationalCompanyId: f.operational }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from(table: string) {
  let inserted: Row | null = null, selection = ''
  const predicates: Row = {}
  const result = () => {
    if (table === 'customers') {
      f.reads.push({ table, selection, predicates: { ...predicates } })
      expect(predicates.id).toBe(f.customer)
      return { data: { id: f.customer, company_id: f.customerCompany, status: 'active' }, error: null }
    }
    if (table === 'customer_internal_notes') {
      if (inserted) {
        if (f.insertError) return { data: null, error: f.insertError }
        const stored = { id: f.note, ...inserted }; f.notes.push(structuredClone(stored))
        return { data: { ...stored, ...f.returned }, error: null }
      }
      f.reads.push({ table, selection, predicates: { ...predicates } })
      const matched = f.notes.filter(row => Object.entries(predicates).every(([key, value]) => row[key] === value))
      return { data: f.readOverride ? f.readReturned : matched.length === 1 ? structuredClone(matched[0]) : null, error: f.readError }
    }
    if (table === 'audit_logs') {
      if (f.auditError) return { data: null, error: f.auditError }
      f.audits.push(structuredClone(inserted!)); return { data: null, error: null }
    }
    expect(table).toBe('platform_usage_events'); f.usage.push(structuredClone(inserted!))
    return { data: null, error: null }
  }
  const q = { insert: (row: Row) => { inserted = structuredClone(row); return q },
    select: (value: string) => { selection = value; return q },
    eq: (key: string, value: unknown) => { predicates[key] = value; return q },
    maybeSingle: async () => result(), single: async () => result(),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
  }
  return q
} } }))

import { createCustomerInternalNoteAction, createCustomerInternalNoteReceiptAction } from '@/app/admin/customers/[id]/actions'
import { notFound, redirect } from 'next/navigation'

// Real public facade, creator, current guard, customer tenant guard and audit
// logger execute. Auth/current-scope/SQL are memory adapters, not native proof.
beforeEach(() => {
  vi.clearAllMocks(); f.loggedIn = true; f.platform = false; f.roles = ['operations_agent']; f.permissions = ['masterdata.write']
  f.status = 'active'; f.selected = f.company; f.operationalCompany = f.company; f.customerCompany = f.company
  f.insertError = null; f.auditError = null; f.returned = {}; f.notes = []; f.audits = []; f.usage = []; f.reads = []
  f.readOverride = false; f.readReturned = null; f.readError = null
  f.auth.mockImplementation(async () => ({ data: { user: f.loggedIn ? { id: f.actor } : null }, error: null }))
  f.rpc.mockImplementation(async (name: string, input: Row) => {
    expect(name).toBe('canonical_authenticated_tenant_context'); expect(input).toEqual({ p_selected_company_id: f.selected })
    return { data: { authorized: true, user_id: f.actor, selected_company_id: f.selected,
      is_platform_admin: f.platform, roles: f.roles, permissions: f.permissions }, error: null }
  })
  f.memberships.mockImplementation(async () => [{ companyId: f.selected, membershipRole: 'operations_agent', status: 'active', companyStatus: f.status }])
  f.operational.mockImplementation(async (actor: string) => { expect(actor).toBe(f.actor); return f.operationalCompany })
  f.revalidate.mockReset()
})
afterEach(() => vi.restoreAllMocks())
function form() {
  const data = new FormData(); data.set('customer_id', f.customer); data.set('body', '  Synthetic private internal note  ')
  return data
}
async function caught(operation: () => Promise<unknown>) { try { await operation(); return null } catch (error) { return error } }
function noWrites() { expect(f.notes).toEqual([]); expect(f.audits).toEqual([]); expect(f.usage).toEqual([]); expect(f.revalidate).not.toHaveBeenCalled() }

it('preserves the real legacy void contract and legitimate non-owner masterdata writer', async () => {
  expect(await createCustomerInternalNoteAction(form())).toBeUndefined()
  expect(f.notes).toEqual([{ id: f.note, company_id: f.company, customer_id: f.customer,
    body: 'Synthetic private internal note', created_by: f.actor, updated_by: f.actor }])
  expect(f.audits).toHaveLength(1); expect(f.usage).toHaveLength(1)
  expect(f.audits[0]).toMatchObject({ company_id: f.company, actor_user_id: f.actor, entity_id: f.note, action: 'customer_internal_note_created' })
  expect(f.revalidate).toHaveBeenCalledExactlyOnceWith(`/admin/customers/${f.customer}`)
})
it('binds the current grant company to the actual customer company before an inconsistent operational context can insert', async () => {
  f.customerCompany = f.foreign; f.operationalCompany = f.foreign
  const error = await caught(() => createCustomerInternalNoteAction(form()))
  noWrites(); expect(error).toBeInstanceOf(Error)
})
it.each([{ field: 'id', value: null }, { field: 'company_id', value: '00000000-0000-4000-8000-000000001402' },
  { field: 'customer_id', value: '00000000-0000-4000-8000-000000001406' }, { field: 'created_by', value: '00000000-0000-4000-8000-000000001406' }])(
  'does not qualify an insert adapter result with mismatched $field as an audited success', async ({ field, value }) => {
    f.returned = { [field]: value }
    const error = await caught(() => createCustomerInternalNoteAction(form()))
    // The note may already be stored. This is not an atomic rollback claim.
    expect(f.notes).toHaveLength(1); expect(f.audits).toEqual([]); expect(f.usage).toEqual([])
    expect(f.revalidate).not.toHaveBeenCalled(); expect(error).toBeInstanceOf(Error)
  })
it('preserves current permission denial before the customer or note query', async () => {
  f.permissions = ['customers.read']; await expect(createCustomerInternalNoteAction(form())).rejects.toThrow('Forbidden')
  noWrites(); expect(f.reads).toEqual([])
})
it('retains required body validation before customer lookup or writes', async () => {
  const data = form(); data.set('body', '  '); await expect(createCustomerInternalNoteAction(data)).rejects.toThrow('anteckning saknas')
  noWrites(); expect(f.reads).toEqual([])
})
it('preserves a failed insert with no audit or fabricated success', async () => {
  f.insertError = new Error('synthetic_insert_fault'); await expect(createCustomerInternalNoteAction(form())).rejects.toThrow('synthetic_insert_fault'); noWrites()
})
it('keeps the existing persisted-note risk visible when the later separate audit fails', async () => {
  f.auditError = new Error('synthetic_audit_fault'); await expect(createCustomerInternalNoteAction(form())).rejects.toThrow('synthetic_audit_fault')
  expect(f.notes).toHaveLength(1); expect(f.audits).toEqual([]); expect(f.usage).toEqual([]); expect(f.revalidate).not.toHaveBeenCalled()
})
it('preserves the old cache-error contract after the note and audit have persisted', async () => {
  f.revalidate.mockImplementation(() => { throw new Error('synthetic_cache_fault') })
  await expect(createCustomerInternalNoteAction(form())).rejects.toThrow('synthetic_cache_fault')
  expect(f.notes).toHaveLength(1); expect(f.audits).toHaveLength(1)
})
it('preserves the authoritative global platform path for a foreign customer without a tenant write grant', async () => {
  f.platform = true; f.roles = ['platform_admin']; f.permissions = []; f.customerCompany = f.foreign
  expect(await createCustomerInternalNoteAction(form())).toBeUndefined()
  expect(f.notes[0]).toMatchObject({ company_id: f.foreign, customer_id: f.customer, created_by: f.actor })
  expect(f.operational).not.toHaveBeenCalled()
})
it('does not replace canonical false with a company platform-named role during current-company binding', async () => {
  f.roles = ['platform_admin']; f.customerCompany = f.foreign; f.operationalCompany = f.foreign
  const error = await caught(() => createCustomerInternalNoteAction(form()))
  noWrites(); expect(error).toBeInstanceOf(Error)
})
it('preserves the actual installed Next login redirect before any note effect', async () => {
  f.loggedIn = false; await expect(createCustomerInternalNoteAction(form())).rejects.toThrow('NEXT_REDIRECT'); noWrites()
})
it('preserves the existing all-paused current write denial', async () => {
  f.status = 'paused'; await expect(createCustomerInternalNoteAction(form())).rejects.toThrow('Bolaget är pausat'); noWrites()
})

// These additional cases qualify the new entrypoint after its implementation;
// they are not relabeled as original exported-void baseline RED cases.
const receipt = () => ({ noteId: f.note, customerId: f.customer, companyId: f.company, actorUserId: f.actor })
it('the separate actual facade returns only the stored identity tuple after a fresh exact after-read', async () => {
  expect(await createCustomerInternalNoteReceiptAction(form())).toEqual(receipt())
  expect(f.reads.at(-1)).toEqual({ table: 'customer_internal_notes', selection: 'id, customer_id, company_id, created_by',
    predicates: { id: f.note, customer_id: f.customer, company_id: f.company, created_by: f.actor } })
  expect(f.notes).toHaveLength(1); expect(f.audits).toHaveLength(1)
})
it.each(['id', 'customer_id', 'company_id', 'created_by'])('refuses a fresh after-read with different %s, preserving already persisted effects honestly', async field => {
  f.readOverride = true; f.readReturned = { id: f.note, customer_id: f.customer, company_id: f.company, created_by: f.actor, [field]: f.other }
  await expect(createCustomerInternalNoteReceiptAction(form())).rejects.toThrow('sparade resultat kunde inte verifieras')
  expect(f.notes).toHaveLength(1); expect(f.audits).toHaveLength(1); expect(f.revalidate).not.toHaveBeenCalled()
})
it('does not qualify a missing fresh row even after insertion and audit succeeded', async () => {
  f.readOverride = true; f.readReturned = null
  await expect(createCustomerInternalNoteReceiptAction(form())).rejects.toThrow('sparade resultat kunde inte verifieras')
  expect(f.notes).toHaveLength(1); expect(f.audits).toHaveLength(1); expect(f.revalidate).not.toHaveBeenCalled()
})
it('does not qualify a database error from the exact after-read', async () => {
  f.readError = new Error('synthetic_after_read_fault')
  await expect(createCustomerInternalNoteReceiptAction(form())).rejects.toThrow('synthetic_after_read_fault')
  expect(f.notes).toHaveLength(1); expect(f.audits).toHaveLength(1); expect(f.revalidate).not.toHaveBeenCalled()
})
it('retains the confirmed tuple when only a later ordinary cache refresh fails, without raw private diagnostics', async () => {
  f.revalidate.mockImplementation(() => { throw new Error('private-cache-canary@example.invalid') })
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  expect(await createCustomerInternalNoteReceiptAction(form())).toEqual(receipt())
  expect(warning).toHaveBeenCalledExactlyOnceWith('[customer-internal-note] Cache refresh unavailable', { code: null })
  expect(JSON.stringify(warning.mock.calls)).not.toContain('private-cache-canary@example.invalid')
})
it.each([['redirect', () => redirect('/login')], ['not found', () => notFound()]] as const)('retains actual installed Next %s control flow from a later cache step', async (_, signal) => {
  f.revalidate.mockImplementation(signal)
  await expect(createCustomerInternalNoteReceiptAction(form())).rejects.toThrow(/NEXT_REDIRECT|NEXT_HTTP_ERROR_FALLBACK/)
  expect(f.notes).toHaveLength(1); expect(f.audits).toHaveLength(1)
})
it('does not read or confirm a new receipt after the required separate audit failed', async () => {
  f.auditError = new Error('synthetic_audit_fault')
  await expect(createCustomerInternalNoteReceiptAction(form())).rejects.toThrow('synthetic_audit_fault')
  expect(f.notes).toHaveLength(1); expect(f.audits).toEqual([])
  expect(f.reads.filter(row => row.table === 'customer_internal_notes')).toEqual([]); expect(f.revalidate).not.toHaveBeenCalled()
})
it('does not read or confirm a receipt when the original insert failed', async () => {
  f.insertError = new Error('synthetic_insert_fault')
  await expect(createCustomerInternalNoteReceiptAction(form())).rejects.toThrow('synthetic_insert_fault')
  noWrites(); expect(f.reads.filter(row => row.table === 'customer_internal_notes')).toEqual([])
})
it('does not take actor or company from additional submitted fields', async () => {
  const data = form(); data.set('company_id', f.foreign); data.set('created_by', f.other); data.set('actorUserId', f.other)
  expect(await createCustomerInternalNoteReceiptAction(data)).toEqual(receipt())
  expect(f.notes[0]).toMatchObject({ company_id: f.company, created_by: f.actor, updated_by: f.actor })
})
it('the new actual facade also denies current ordinary company drift before insert', async () => {
  f.customerCompany = f.foreign; f.operationalCompany = f.foreign
  await expect(createCustomerInternalNoteReceiptAction(form())).rejects.toThrow('Forbidden'); noWrites()
})
it('the new actual facade also denies missing current masterdata.write before any query', async () => {
  f.permissions = ['customers.read']; await expect(createCustomerInternalNoteReceiptAction(form())).rejects.toThrow('Forbidden')
  noWrites(); expect(f.reads).toEqual([])
})
it('the new after-read preserves the genuine canonical global customer path', async () => {
  f.platform = true; f.permissions = []; f.roles = ['platform_admin']; f.customerCompany = f.foreign
  expect(await createCustomerInternalNoteReceiptAction(form())).toEqual({ ...receipt(), companyId: f.foreign })
  expect(f.reads.at(-1)).toMatchObject({ predicates: { company_id: f.foreign, customer_id: f.customer, created_by: f.actor, id: f.note } })
})
