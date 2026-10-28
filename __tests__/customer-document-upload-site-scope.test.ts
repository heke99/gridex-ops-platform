import { beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({ siteCustomer: 'customer-a', uploads: 0 }))
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }))
vi.mock('@/lib/admin/guards', () => ({ requireAdminActionAccess: async () => ({ userId: 'staff-a' }) }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({}) }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  storage: { from: () => ({ upload: async () => { io.uploads++; return { error: new Error('fixture stops after observing storage') } } }) },
  from: (table: string) => {
    const selected: Record<string, unknown> = {}
    const q = { select: () => q, eq: (k: string, v: unknown) => { selected[k] = v; return q }, maybeSingle: async () => ({
      data: table === 'customer_sites' && selected.id === 'site-a' && selected.company_id === 'company-a' && selected.customer_id === io.siteCustomer
        ? { id: 'site-a', company_id: 'company-a', customer_id: io.siteCustomer } : null, error: null,
    }) }
    return q
  },
} }))
vi.mock('@/lib/operations/db', () => ({ buildDocumentUploadIdempotencyKey: () => 'document-intent', findExistingCustomerAuthorizationDocumentByFingerprint: async () => null }))
vi.mock('@/lib/operations/edielAutomation', () => ({ ensureInitialSwitchEdielAutomation: async () => undefined }))
vi.mock('@/lib/operations/powerOfAttorneyWorkflow', () => ({}))
vi.mock('@/app/admin/customers/[id]/document-actions.part-1', () => ({
  formValue: (f: FormData, k: string) => String(f.get(k) ?? '').trim(),
  normalizeDateOrNull: (v: string) => v || null,
  normalizeSwitchRequestType: () => 'supplier_switch',
  toBoolean: () => false,
  isIsoDateBefore: () => false,
  requireCustomerDocumentActionContext: async () => ({ companyId: 'company-a', customer: { id: 'customer-a' } }),
  buildFileChecksum: async () => 'a'.repeat(64),
  buildCustomerDocumentPath: () => 'customer-a/site-a/original.pdf',
}))

import { uploadCustomerAuthorizationDocumentAction } from '@/app/admin/customers/[id]/document-actions.part-2'

beforeEach(() => { io.siteCustomer = 'customer-a'; io.uploads = 0 })

async function upload() {
  const form = new FormData()
  form.set('customer_id', 'customer-a'); form.set('site_id', 'site-a'); form.set('document_type', 'complete_agreement')
  form.set('document_file', new File(['%PDF-1.4 synthetic'], 'agreement.pdf', { type: 'application/pdf' }))
  try {
    return await uploadCustomerAuthorizationDocumentAction({ status: 'idle', message: '', documentId: null, duplicateDocumentId: null }, form)
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'fixture stops after observing storage') throw error
    return { status: 'error', message: error.message }
  }
}

describe('document-card upload checks site ownership before storage', () => {
  it('rejects a site from another customer without writing any bytes', async () => {
    io.siteCustomer = 'customer-b'
    const result = await upload()
    expect(result.status).toBe('error')
    expect(io.uploads).toBe(0)
  })
  it('lets the correctly scoped site reach the storage boundary', async () => {
    const result = await upload()
    expect(result.status).toBe('error') // Controlled storage failure, not a successful upload.
    expect(io.uploads).toBe(1)
  })
})
