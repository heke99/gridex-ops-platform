import { beforeEach, describe, expect, it, vi } from 'vitest'

// Synthetic transport exercises the real cached-resume identity write and application error response.
const transport = vi.hoisted(() => ({
  error: { code: '23514', message: 'customer_merged_write_conflict' } as unknown,
  upserts: [] as Record<string, unknown>[],
  reads: [] as string[],
}))
const SOURCE = '000000a1-0000-4000-8000-000000000000'
const COMPANY = '0000000a-0000-4000-8000-000000000000'
const AUTH_USER = '000000b1-0000-4000-8000-000000000000'

vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from: (table: string) => {
      const api = {
        select: () => api,
        eq: () => api,
        upsert: (payload: Record<string, unknown>) => {
          if (table !== 'customer_portal_identities') throw new Error(`Unexpected write: ${table}`)
          transport.upserts.push(payload)
          return api
        },
        maybeSingle: async () => {
          if (table !== 'website_customer_applications') throw new Error(`Unexpected read: ${table}`)
          transport.reads.push(table)
          return {
            data: {
              id: 'application-before-merge', status: 'failed', customer_id: SOURCE,
              customer_number: 'SOURCE-1', contract_id: 'contract-before-merge',
              customer_site_id: null, metering_point_id: null, error_stage: 'portal_user_link',
              error_code: 'internal_error', error_message: 'prior failed attempt',
              response_payload: {}, payload: {}, warnings: [],
            },
            error: null,
          }
        },
        single: async () => {
          if (table !== 'customer_portal_identities') throw new Error(`Unexpected single: ${table}`)
          return { data: null, error: transport.error }
        },
      }
      return api
    },
  },
}))
vi.mock('@/lib/customer-portal/customerResolver', () => ({ ensureCustomerPortalUserLink: vi.fn() }))
vi.mock('@/lib/website/provisioningSaga', () => ({ commitApplicationProvisioning: vi.fn() }))
vi.mock('@/lib/email/emailEvents', () => ({ triggerEmailEvent: vi.fn() }))
vi.mock('@/lib/website/publicContracts', () => ({ legalAcceptanceTypeForModule: vi.fn() }))
vi.mock('@/lib/customer-contracts/agreementPdf', () => ({ buildAgreementPdfAttachment: vi.fn() }))
vi.mock('@/lib/customer-contracts/documents', () => ({
  archiveSignedCustomerContractPdf: vi.fn(), downloadAndVerifyCustomerContractDocument: vi.fn(),
}))
vi.mock('@/lib/pricing/fixedAreaPricing', () => ({ fixedPriceOreForArea: vi.fn() }))
vi.mock('@/lib/website/customerApplicationLegal', () => ({
  buildCustomerLegalAcceptanceEvidence: vi.fn(), contractLegalMailEvidenceReady: vi.fn(),
  emailDispatchStatus: vi.fn(), emailTriggerSucceeded: vi.fn(),
}))

import { WebsiteApplicationError, stage } from '@/lib/website/customerApplicationShared'
import {
  failureResponse, isFailedIdempotentApplication, loadIdempotentApplication,
  resumeCommittedIdempotentApplication,
} from '@/lib/website/customerApplicationPersistence'

beforeEach(() => {
  transport.error = { code: '23514', message: 'customer_merged_write_conflict' }
  transport.upserts.length = 0
  transport.reads.length = 0
})

async function responseForCachedResume(error: unknown) {
  transport.error = error
  const client = { id: 'client-a', company_id: COMPANY } as never
  const existing = await loadIdempotentApplication(COMPANY, 'same-before-merge-key')
  expect(existing).not.toBeNull()
  const body = { auth_user_id: AUTH_USER, customer: { email: 'synthetic@example.invalid' } } as never
  expect(isFailedIdempotentApplication(existing!, body)).toBe(true)
  try {
    await stage('application_workflow', () => resumeCommittedIdempotentApplication({
      client, existing: existing!, body, externalCustomerId: 'external-before-merge',
    }))
    throw new Error('Expected the synthetic identity transport to fail')
  } catch (caught) {
    expect(caught).toBeInstanceOf(WebsiteApplicationError)
    return failureResponse(caught as WebsiteApplicationError)
  }
}

describe('website cached customer resume across customer merges', () => {
  it('returns a controlled 409 for the cached-source identity UPSERT while preserving the application error shape', async () => {
    const result = await responseForCachedResume({ code: '23514', message: 'customer_merged_write_conflict' })
    expect(transport.reads).toEqual(['website_customer_applications'])
    expect(transport.upserts).toHaveLength(1)
    expect(transport.upserts[0]).toMatchObject({ company_id: COMPANY, customer_id: SOURCE, auth_user_id: AUTH_USER })
    expect(result).toMatchObject({ ok: false, status: 409, body: { code: 'portal_identity_customer_conflict', error: 'Kundkopplingen har ändrats. Hämta aktuella kunduppgifter och försök igen.', error_stage: 'application_workflow' } })
  })

  it.each([
    { code: '23514', message: 'customer_portal_customer_not_found_for_tenant' },
    { code: '42501', message: 'customer_merged_write_conflict' },
    { code: 'XX000', message: 'unrelated_database_failure' },
  ])('preserves unknown error 500: $code / $message', async (error) => {
    const result = await responseForCachedResume(error)
    expect(result.status).toBe(500)
    expect(result.body.code).toBe(error.code)
    expect(result.body.error).toBe(`${error.message} · ${error.code}`)
  })
})
