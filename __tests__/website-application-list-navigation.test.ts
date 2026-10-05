import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'
import type { WebsiteApplicationAdminRow } from '@/lib/admin/websiteIntegrationOps'

const io = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('@/lib/admin/guards', () => ({
  requireAdminPageAccess: async () => ({ userId: 'synthetic-admin' }),
  isPlatformAdminContext: () => false,
}))
vi.mock('@/lib/tenant/adminScope', () => ({
  resolveAdminTenantReadScope: async () => ({ companyId: 'synthetic-company', isPlatformAdmin: false }),
}))
vi.mock('@/lib/admin/websiteIntegrationOps', () => ({ listWebsiteApplications: io.list }))
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => React.createElement('a', { href }, children),
}))
vi.mock('@/app/admin/website-applications/actions', () => ({
  checkWebsiteApplicationReadinessAction: vi.fn(),
  markWebsiteApplicationFacilityDataReceivedAction: vi.fn(),
  requestWebsiteApplicationGridOwnerInfoAction: vi.fn(),
  resolveWebsiteApplicationEnergyAction: vi.fn(),
  updateWebsiteApplicationReviewAction: vi.fn(),
}))

import WebsiteApplicationsPage from '@/app/admin/website-applications/page'

function row(id: string, source_table?: WebsiteApplicationAdminRow['source_table']): WebsiteApplicationAdminRow {
  return {
    id, source_table, company_id: 'synthetic-company', api_client_id: null,
    customer_id: null, customer_site_id: null, metering_point_id: null, contract_id: null,
    external_customer_id: id, external_account_id: null, customer_number: null,
    source: null, status: 'needs_information', idempotency_key: null,
    payload: null, response_payload: null, warnings: null, processed_at: null,
    created_at: '2026-10-01T10:00:00Z', updated_at: null,
    customers: { full_name: id },
  }
}

beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('React', React) })

it('opens every intake source with its own ID and source, while external fallback remains read-only', async () => {
  io.list.mockResolvedValue([
    row('website-row', 'website_customer_applications'),
    row('external-row', 'external_contract_intakes'),
    row('legacy-row'),
  ])
  const html = renderToStaticMarkup(await WebsiteApplicationsPage({ searchParams: Promise.resolve({}) }))
  const articles = html.match(/<article\b[\s\S]*?<\/article>/g) ?? []
  expect(articles).toHaveLength(3)
  const destinations = [
    '/admin/website-applications/website-row?source=website_customer_applications',
    '/admin/website-applications/external-row?source=external_contract_intakes',
    '/admin/website-applications/legacy-row?source=website_customer_applications',
  ]
  articles.forEach((article, index) => {
    expect(article).toContain(`href="${destinations[index]}">Öppna ansökan</a>`)
    expect(article).toContain(`href="${destinations[index]}">${['website-row', 'external-row', 'legacy-row'][index]}</a>`)
  })
  expect(articles[1]).not.toContain('<form')
  expect(articles[0]).toContain('name="application_id" value="website-row"')
  expect(articles[2]).toContain('name="application_id" value="legacy-row"')
  expect(io.list).toHaveBeenCalledWith({ companyId: 'synthetic-company', status: null, limit: 150 })
})
