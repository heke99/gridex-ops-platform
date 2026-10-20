// FINDINGS F61: the canonical signed-agreement import trigger records the contract event through a function only
// the service role may call, but both upload paths inserted the complete_agreement document with the employee's
// session, so no uploaded signed agreement was ever imported; the intake then reported a saved customer as unsaved.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const db = vi.hoisted(() => ({
  inserts: [] as Array<{ table: string; row: Row }>,
  removed: [] as string[],
  uploads: [] as string[],
  refuse: null as null | { code: string; message: string },
  sessionClientUsed: 0,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from: (table: string) => ({
      insert: (row: Row) => ({
        select: () => ({
          single: async () => {
            if (table === 'customer_authorization_documents' && db.refuse) return { data: null, error: db.refuse }
            db.inserts.push({ table, row })
            return { data: { id: `doc-${db.inserts.length}`, ...row }, error: null }
          },
        }),
      }),
    }),
    storage: {
      from: () => ({
        upload: async (path: string) => { db.uploads.push(path); return { data: { path }, error: null } },
        remove: async (paths: string[]) => { db.removed.push(...paths); return { data: null, error: null } },
      }),
    },
  },
}))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(async () => { db.sessionClientUsed += 1; return { from: () => { throw Error('session client must not write the signed agreement') } } }),
}))
vi.mock('@/app/admin/customers/actions.part-1', async importOriginal => ({
  ...(await importOriginal<object>()),
  insertAuditLog: vi.fn(async () => undefined),
}))

import { importSignedAgreementForContract } from '@/lib/customer-contracts/importSignedAgreement'
import { uploadCustomerIntakeDocuments } from '@/app/admin/customers/actions.part-2'

const ids = { companyId: 'company-a', customerId: 'customer-1', contractId: 'contract-1', siteId: 'site-1', meteringPointId: null }
const pdf = () => new File([Buffer.from('%PDF-1.4 signed by the customer')], 'avtal.pdf', { type: 'application/pdf' })
const intake = (overrides: Row = {}) => uploadCustomerIntakeDocuments({
  ...ids, actorUserId: 'employee-1', existingPowerOfAttorneyId: null, existingAuthorizationDocumentId: null, signedScopes: [],
  signedAgreementFile: pdf(), signedAgreementDeclaredDate: '2026-10-20', signedPowerOfAttorneyFile: null, gridInvoiceFile: null,
  authorizationValidFrom: null, authorizationValidTo: null, ...overrides,
} as Parameters<typeof uploadCustomerIntakeDocuments>[0])

beforeEach(() => { db.inserts = []; db.removed = []; db.uploads = []; db.refuse = null; db.sessionClientUsed = 0 })

describe('signed agreement import runs as the service role on behalf of the employee', () => {
  it('customer card: records the document with the service role and the acting employee', async () => {
    await importSignedAgreementForContract({ ...ids, actorUserId: 'employee-1', file: pdf(), declaredSignedDate: '2026-10-20' })
    expect(db.inserts).toHaveLength(1)
    expect(db.inserts[0].row).toMatchObject({
      company_id: 'company-a', customer_id: 'customer-1', customer_contract_id: 'contract-1', document_type: 'complete_agreement',
      status: 'active', created_by: 'employee-1', updated_by: 'employee-1',
      metadata: { source: 'customer_intake', documentRole: 'signed_agreement', channel: 'admin_contract_create' },
    })
    expect(db.inserts[0].row.file_checksum).toMatch(/^[0-9a-f]{64}$/)
    expect(db.sessionClientUsed).toBe(0)
  })

  it('manual intake: records the document with the service role and the acting employee', async () => {
    const result = await intake()
    expect(db.inserts).toHaveLength(1)
    expect(db.inserts[0].row).toMatchObject({ customer_contract_id: 'contract-1', created_by: 'employee-1', metadata: { source: 'customer_intake', documentRole: 'signed_agreement' } })
    expect(result.uploadedLabels).toEqual(['signerat avtal'])
    expect(result.warnings).toEqual([])
  })

  it('manual intake: a refused import is a warning on the saved customer, and the uploaded file is removed', async () => {
    db.refuse = { code: '42501', message: 'contract_permission_denied:contracts.create' }
    const result = await intake()
    expect(result.uploadedLabels).toEqual([])
    expect(result.warnings).toEqual([expect.stringContaining('Kunden sparades, men det signerade avtalet kunde inte registreras')])
    expect(db.removed).toEqual(db.uploads)
  })

  it('manual intake: without a contract the agreement is not filed and the employee is told why', async () => {
    const result = await intake({ contractId: null })
    expect(db.inserts).toEqual([])
    expect(db.uploads).toEqual([])
    expect(result.warnings).toEqual([expect.stringContaining('inget avtal skapades')])
  })
})
