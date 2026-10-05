import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({
  permissions: ['cases.read'] as string[],
  roles: ['customer_service_agent'] as string[],
  companyId: 'company-a' as string | null,
  membership: true,
  authorized: true,
  isPlatformAdmin: false,
  reads: [] as Array<{ kind: string; companyId: string | null }>,
  mutations: 0,
  cases: [
    { id: 'case-a', company_id: 'company-a', customer_id: 'customer-a', customer_name: 'Own customer', title: 'Own support case', status: 'open', priority: 'normal', source: 'tenant_support_web', created_at: '2026-10-05T09:00:00Z' },
    { id: 'case-b', company_id: 'company-b', customer_id: 'customer-b', customer_name: 'Foreign customer', title: 'Foreign support case', status: 'open', priority: 'normal', source: 'tenant_support_web', created_at: '2026-10-05T09:00:00Z' },
  ],
}))

// Keep the real page, access model, admin guards and company read-scope helper.
// Only external session/catalog/data boundaries are replaced with local fixtures.
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'company-a' }) }) }))
vi.mock('next/navigation', () => ({
  redirect: (path: string) => { throw new Error(`REDIRECT ${path}`) },
  notFound: () => { throw new Error('NOT_FOUND') },
}))
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'actor-a', email: 'staff@example.invalid' } }, error: null }) },
    rpc: async () => ({
      data: { authorized: io.authorized, user_id: 'actor-a', user_email: 'staff@example.invalid', permissions: io.permissions, roles: io.roles, selected_company_id: io.companyId, is_platform_admin: io.isPlatformAdmin },
      error: null,
    }),
  }),
}))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: { from: () => { throw new Error('Unexpected database access') } },
}))
vi.mock('@/lib/tenant/scope', () => ({
  listOperationalCompaniesForUser: async () => io.membership ? [{ companyId: 'company-a', companyStatus: 'active' }] : [],
  getOperationalCompanyScope: async () => ({ companyId: io.companyId, companyName: 'Own company' }),
}))
vi.mock('@/lib/customer-cases/db', () => ({
  listCustomerCases: async ({ companyId }: { companyId: string | null }) => {
    io.reads.push({ kind: 'cases', companyId })
    return io.cases.filter((row) => !companyId || row.company_id === companyId)
  },
  getCustomerCaseById: async (id: string, companyId: string) => {
    io.reads.push({ kind: 'case', companyId })
    return io.cases.find((row) => row.id === id && row.company_id === companyId) ?? null
  },
  listCustomerCaseEvents: async (_caseId: string, companyId: string) => {
    io.reads.push({ kind: 'events', companyId })
    return [{ id: 'event-a', event_type: 'support_internal_note', message: 'Own internal history', payload: { visibility: 'internal' }, created_at: '2026-10-05T09:01:00Z' }]
  },
  updateCustomerCaseStatus: async () => { io.mutations++ },
}))
vi.mock('@/lib/customer-cases/support', () => ({
  listTenantSupportCustomerOptions: async (companyId: string) => {
    io.reads.push({ kind: 'customers', companyId })
    return [{ id: 'customer-a', label: 'Own customer' }]
  },
  createTenantSupportCase: async () => { io.mutations++ },
}))
vi.mock('@/lib/customer-service/supportAttachments', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/customer-service/supportAttachments')>()
  return {
    ...actual,
    listSupportAttachments: async ({ companyId }: { companyId: string }) => {
      io.reads.push({ kind: 'attachments', companyId })
      return [{ public_reference: 'attachment-a', file_name: 'Own attachment.pdf', byte_size: 5, scan_status: 'released', visibility: 'internal', uploaded_by_kind: 'staff' }]
    },
    downloadSupportAttachment: async ({ companyId, audience }: { companyId: string; audience: string }) => {
      if (audience !== 'staff') throw new Error('Incorrect attachment audience')
      io.reads.push({ kind: 'download', companyId })
      return { row: { file_name: 'Own attachment.pdf', detected_mime_type: 'application/pdf' }, bytes: Buffer.from('%PDF-') }
    },
  }
})

import CasesPage from '@/app/admin/customer-cases/page'
import DetailPage from '@/app/admin/customer-cases/[caseId]/page'
import { GET as download } from '@/app/admin/customer-cases/[caseId]/attachments/[reference]/route'
import { createCustomerCaseFromFormAction, updateCustomerCaseStatusAction } from '@/app/admin/customer-cases/actions'
import { getAdminNavigationGroups } from '@/lib/admin/navigation'
import { requireAdminAccess, requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { ROLE_PERMISSION_PROFILES } from '@/lib/admin/accessModel'

const list = () => CasesPage({ searchParams: Promise.resolve({}) })
const detail = (caseId = 'case-a') => DetailPage({ params: Promise.resolve({ caseId }) })
const file = (caseId = 'case-a') => download(new Request('https://ops.example.invalid'), { params: Promise.resolve({ caseId, reference: 'attachment-a' }) })
const navigation = () => getAdminNavigationGroups({ permissions: io.permissions, roles: io.roles, isPlatformAdmin: io.isPlatformAdmin })

describe('support case pages enforce effective case permissions through the real admin guard', () => {
  beforeEach(() => {
    io.permissions = ['cases.read']
    io.roles = ['customer_service_agent']
    io.companyId = 'company-a'
    io.membership = true
    io.authorized = true
    io.isPlatformAdmin = false
    io.reads = []
    io.mutations = 0
  })

  it('admits a cases.read-only staff member and shows own inbox without mutation forms', async () => {
    expect((await requireAdminAccess()).userId).toBe('actor-a')
    const html = renderToStaticMarkup(await list())
    expect(html).toContain('Own support case')
    expect(html).not.toContain('Foreign support case')
    expect(html).not.toContain('<form')
    expect(html).not.toContain('Skapa supportärende')
    expect(html).not.toContain('name="status"')
    expect(io.reads).toEqual([{ kind: 'cases', companyId: 'company-a' }])
    expect(navigation().flatMap((group) => group.items).map((item) => item.href)).toContain('/admin/customer-cases')
  })

  it.each(['switching.read', 'customers.read', 'cases.write'])('denies %s-only staff before reading any support content', async (permission) => {
    io.permissions = [permission]
    expect(navigation().flatMap((group) => group.items).map((item) => item.href)).not.toContain('/admin/customer-cases')
    for (const read of [list, detail, file]) {
      await expect(read()).rejects.toThrow('REDIRECT /admin')
    }
    expect(io.reads).toEqual([])
  })

  it('keeps operational task access independent of support case access', async () => {
    await expect(requireAdminPageKeyAccess('operations.tasks')).rejects.toThrow('REDIRECT /admin')
    io.permissions = ['switching.read']
    await expect(requireAdminPageKeyAccess('operations.tasks')).resolves.toMatchObject({ userId: 'actor-a' })
  })

  it('shows create and status forms only when the staff member also has cases.write', async () => {
    // The old gate also admits this actor; this isolates the mutation-UI regression.
    io.permissions = ['cases.read', 'switching.read']
    expect(renderToStaticMarkup(await list())).not.toContain('<form')
    io.permissions.push('cases.write')
    const html = renderToStaticMarkup(await list())
    expect(html).toContain('Skapa supportärende')
    expect(html).toContain('name="status"')
    expect(html).toContain('name="expected_company_id" value="company-a"')
  })

  it('reads own history and released attachments without offering detail mutations', async () => {
    const html = renderToStaticMarkup(await detail())
    expect(html).toContain('Own internal history')
    expect(html).toContain('Endast internt')
    expect(html).toContain('/admin/customer-cases/case-a/attachments/attachment-a')
    expect(html).not.toContain('<form')
    expect(html).not.toContain('Hantera ärendet')
    expect(io.reads.map((read) => read.companyId)).toEqual(['company-a', 'company-a', 'company-a'])
  })

  it('permits a cases.read-only staff download with the existing safe response headers', async () => {
    const response = await file()
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('%PDF-')
    expect(response.headers.get('content-disposition')).toMatch(/^attachment;/)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(io.reads).toEqual([{ kind: 'case', companyId: 'company-a' }, { kind: 'download', companyId: 'company-a' }])
  })

  it('refuses foreign-case history and attachment bytes within the selected company', async () => {
    await expect(detail('case-b')).rejects.toThrow('NOT_FOUND')
    expect((await file('case-b')).status).toBe(404)
    expect(io.reads).toEqual([{ kind: 'case', companyId: 'company-a' }, { kind: 'case', companyId: 'company-a' }])
  })

  it('fails closed before data access when staff have no membership or company scope', async () => {
    io.membership = false
    await expect(list()).rejects.toThrow('REDIRECT /login')
    io.membership = true
    io.companyId = null
    for (const read of [list, detail, file]) await expect(read()).rejects.toThrow('saknar ett aktivt bolag')
    expect(io.reads).toEqual([])
  })

  it('does not let a denied canonical session or customer role use a case permission', async () => {
    io.authorized = false
    await expect(list()).rejects.toThrow('Behörighetskontrollen nekades')
    io.authorized = true
    io.roles = ['customer']
    await expect(list()).rejects.toThrow('REDIRECT /login')
    expect(io.reads).toEqual([])
  })

  it('keeps both existing customer-service profiles usable without role-name page bypasses', async () => {
    for (const role of ['customer_service_agent', 'customer_service_manager'] as const) {
      io.roles = [role]
      io.permissions = [...ROLE_PERMISSION_PROFILES[role].permissions]
      expect(renderToStaticMarkup(await list())).toContain('Skapa supportärende')
    }
    io.permissions = ['switching.read']
    await expect(list()).rejects.toThrow('REDIRECT /admin')
  })

  it('retains the existing cases.write action guard for direct read-only submissions', async () => {
    const form = new FormData()
    form.set('customer_id', 'customer-a')
    form.set('case_id', 'case-a')
    form.set('title', 'Unauthorized mutation')
    form.set('status', 'closed')
    form.set('expected_company_id', 'company-a')
    await expect(createCustomerCaseFromFormAction(form)).rejects.toThrow('Forbidden')
    await expect(updateCustomerCaseStatusAction(form)).rejects.toThrow('Forbidden')
    expect(io.mutations).toBe(0)
    expect(io.reads).toEqual([])
  })

  it('preserves the existing platform overview without company-bound writes or downloads', async () => {
    io.isPlatformAdmin = true
    io.roles = ['platform_admin']
    io.permissions = []
    const html = renderToStaticMarkup(await list())
    expect(html).toContain('Own support case')
    expect(html).toContain('Foreign support case')
    expect(html).not.toContain('<form')
    await expect(detail()).rejects.toThrow('NOT_FOUND')
    expect((await file()).status).toBe(404)
    expect(io.reads).toEqual([{ kind: 'cases', companyId: null }])
  })
})
