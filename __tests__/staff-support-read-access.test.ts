import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeIntegrationApiScopes } from '@/lib/integrations/apiClientSecrets'
import { getAdminNavigationGroups } from '@/lib/admin/navigation'
import {
  CUSTOMER_PORTAL_SCOPES,
  permissionGroupLabelsForScopes,
  recommendedPermissionGroups,
  scopesForPermissionGroups,
} from '@/lib/integrations/apiClientScopes'

const state = vi.hoisted(() => ({
  permissions: [] as string[],
  reads: [] as string[],
}))

// Keep the actual permission catalog and evaluator: a wrong page key must
// change the observed access decision, rather than merely a mock call.
vi.mock('@/lib/admin/guards', async () => {
  const { getAdminPageRequirement, hasPermissionRequirement } = await import('@/lib/admin/accessModel')
  return {
    isPlatformAdminContext: () => false,
    requireAdminPageKeyAccess: async (key: Parameters<typeof getAdminPageRequirement>[0]) => {
      if (!hasPermissionRequirement(state.permissions, getAdminPageRequirement(key))) {
        throw new Error('support-read-forbidden')
      }
      return {
        userId: 'staff-a', email: 'support@example.invalid', permissions: state.permissions,
        roles: ['customer_service'], isAdmin: true, isPlatformAdmin: false, companyId: 'company-a',
      }
    },
  }
})
vi.mock('@/lib/tenant/scope', () => ({
  getOperationalCompanyScope: async () => ({ companyId: 'company-a', companyName: 'Bolag A' }),
}))
vi.mock('@/lib/customer-cases/db', () => ({
  listCustomerCases: async ({ companyId }: { companyId: string | null }) => {
    state.reads.push(`list:${companyId}`)
    return companyId === 'company-a' ? [supportCase] : []
  },
  getCustomerCaseById: async (id: string, companyId: string | null) => {
    state.reads.push(`case:${id}:${companyId}`)
    return id === supportCase.id && companyId === supportCase.company_id ? supportCase : null
  },
  listCustomerCaseEvents: async (id: string, companyId: string | null) => {
    state.reads.push(`events:${id}:${companyId}`)
    return [{ id: 'event-a', event_type: 'support_internal_note', message: 'Intern supporthistorik', payload: { visibility: 'internal' }, created_at: '2026-10-03T12:00:00Z' }]
  },
}))
vi.mock('@/lib/customer-cases/support', () => ({
  listTenantSupportCustomerOptions: async (companyId: string) => {
    state.reads.push(`customers:${companyId}`)
    return [{ id: 'customer-a', label: 'Kund A' }]
  },
}))
vi.mock('@/lib/customer-service/supportAttachments', () => ({
  SupportAttachmentError: class extends Error {},
  listSupportAttachments: async ({ companyId, customerId, caseId, audience }: Record<string, unknown>) => {
    state.reads.push(`attachments:${companyId}:${customerId}:${caseId}:${audience}`)
    return [attachment]
  },
  downloadSupportAttachment: async ({ companyId, customerId, caseId, reference, audience }: Record<string, unknown>) => {
    state.reads.push(`download:${companyId}:${customerId}:${caseId}:${reference}:${audience}`)
    return { row: attachment, bytes: Buffer.from('%PDF-support-attachment') }
  },
}))
vi.mock('@/app/admin/customer-cases/actions', () => ({
  createCustomerCaseFromFormAction: async () => {}, updateCustomerCaseStatusAction: async () => {},
  addInternalNoteAction: async () => {}, recordPhoneInteractionAction: async () => {},
  replyToCustomerAction: async () => {}, uploadSupportAttachmentAction: async () => {},
}))
vi.mock('@/components/admin/AdminHeader', () => ({ default: ({ title }: { title: string }) => React.createElement('header', null, title) }))
vi.mock('@/components/admin/CustomerName', () => ({ default: 'span' }))
vi.mock('@/components/admin/support/SupportCaseComposer', () => ({ default: 'section' }))
vi.mock('next/link', () => ({ default: 'a' }))

import SupportListPage from '@/app/admin/customer-cases/page'
import SupportDetailPage from '@/app/admin/customer-cases/[caseId]/page'
import { GET as downloadAttachment } from '@/app/admin/customer-cases/[caseId]/attachments/[reference]/route'

const supportCase = {
  id: 'case-a', company_id: 'company-a', customer_id: 'customer-a', title: 'Supportärende A',
  customer_name: 'Kund A', description: 'Kundens supportfråga', status: 'open', priority: 'normal',
  source: 'tenant_support_web', metadata: { support_case: true }, reason_category: 'support',
  created_at: '2026-10-03T12:00:00Z',
}
const attachment = {
  public_reference: 'attachment-a', file_name: 'support.pdf', byte_size: 23,
  detected_mime_type: 'application/pdf', visibility: 'internal', uploaded_by_kind: 'staff', scan_status: 'released',
}
const attachmentContext = { params: Promise.resolve({ caseId: 'case-a', reference: 'attachment-a' }) }
const attachmentRequest = new Request('https://support123.gridex.se/admin/customer-cases/case-a/attachments/attachment-a')

describe('native support read authorization', () => {
  beforeEach(() => {
    state.permissions = []
    state.reads = []
  })

  it.each(['cases.read', 'customers.read'])('lets %s read the list, detail and released attachment within the selected company', async (permission) => {
    state.permissions = [permission]

    const list = renderToStaticMarkup(await SupportListPage({ searchParams: Promise.resolve({}) }))
    expect(list).toContain('Supportärende A')
    expect(list).toContain('/admin/customer-cases/case-a')
    expect(state.reads).toEqual(['list:company-a', 'customers:company-a'])

    state.reads = []
    const detail = renderToStaticMarkup(await SupportDetailPage({ params: Promise.resolve({ caseId: 'case-a' }) }))
    expect(detail).toContain('Intern supporthistorik')
    expect(detail).toContain('/admin/customer-cases/case-a/attachments/attachment-a')
    expect(state.reads).toEqual(['case:case-a:company-a', 'events:case-a:company-a', 'attachments:company-a:customer-a:case-a:staff'])

    state.reads = []
    const response = await downloadAttachment(attachmentRequest, attachmentContext)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('%PDF-support-attachment')
    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('content-disposition')).toContain('attachment;')
    expect(state.reads).toEqual(['case:case-a:company-a', 'download:company-a:customer-a:case-a:attachment-a:staff'])
  })

  it.each(['metering.read', 'billing_underlay.read', 'cases.write'])('denies %s without support read authority before any service read', async (permission) => {
    state.permissions = [permission]
    const results = await Promise.allSettled([
      SupportListPage({ searchParams: Promise.resolve({}) }),
      SupportDetailPage({ params: Promise.resolve({ caseId: 'case-a' }) }),
      downloadAttachment(attachmentRequest, attachmentContext),
    ])
    expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected', 'rejected'])
    for (const result of results) {
      if (result.status === 'rejected') expect(result.reason.message).toBe('support-read-forbidden')
    }
    expect(state.reads).toEqual([])
  })

  it('returns no attachment for a case outside the selected company', async () => {
    state.permissions = ['cases.read']
    const response = await downloadAttachment(attachmentRequest, {
      params: Promise.resolve({ caseId: 'case-in-company-b', reference: 'attachment-b' }),
    })
    expect(response.status).toBe(404)
    expect(state.reads).toEqual(['case:case-in-company-b:company-a'])
  })

  it.each([
    ['cases.read', true], ['customers.read', true], ['metering.read', false], ['billing_underlay.read', false],
  ] as const)('shows the support navigation entry to %s according to support read authority', (permission, visible) => {
    const links = getAdminNavigationGroups({ permissions: [permission], roles: ['customer_service'], isPlatformAdmin: false })
      .flatMap((group) => group.items.map((item) => item.href))
    expect(links.includes('/admin/customer-cases')).toBe(visible)
  })
})

describe('explicit staff integration permissions', () => {
  const staffScopes = [
    'staff_sessions.write', 'staff_context.read', 'staff_customers.read', 'staff_support.read', 'staff_support.write',
  ]

  it('retains each supported staff scope when an administrator saves explicit scopes', () => {
    expect(normalizeIntegrationApiScopes([...staffScopes, 'staff_support.read', 'staff_admin.write']))
      .toEqual(staffScopes)
  })

  it.each([
    ['staff_sessions', 'staff_sessions.write', 'Personalinloggning'],
    ['staff_context', 'staff_context.read', 'Personalens behörigheter'],
    ['staff_customers', 'staff_customers.read', 'Personalens kundlista'],
    ['staff_support_read', 'staff_support.read', 'Läs support som personal'],
    ['staff_support_write', 'staff_support.write', 'Handlägg support som personal'],
  ])('grants only the selected %s capability and displays its staff label', (group, scope, label) => {
    expect(scopesForPermissionGroups([group])).toEqual([scope])
    expect(permissionGroupLabelsForScopes([scope])).toEqual([label])
  })

  it('keeps staff privileges outside the default website and customer portal grants', () => {
    const defaults = scopesForPermissionGroups(recommendedPermissionGroups())
    for (const scope of staffScopes) {
      expect(defaults).not.toContain(scope)
      expect(CUSTOMER_PORTAL_SCOPES).not.toContain(scope)
    }
  })
})
