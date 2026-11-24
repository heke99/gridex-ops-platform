import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'

vi.mock('@/app/admin/cis/actions', () => ({ queueSupplierSwitchOutboundAction: vi.fn() }))
vi.mock('@/app/admin/operations/actions', () => ({ finalizeSupplierSwitchExecutionAction: vi.fn(), retryOutboundFromSwitchDetailAction: vi.fn(), validateSupplierSwitchBeforeProcessingAction: vi.fn() }))
import CustomerDeliveryCaseLinks from '@/components/admin/customers/CustomerDeliveryCaseLinks'
import { buildCustomerCardWorkflow } from '@/lib/customer-operations/customerCardWorkflow'
import { buildCustomerCardSnapshot } from '@/lib/customers/customerCardSnapshot'
import { buildCustomerStatusCards } from '@/lib/customer-operations/customerActionRegistry'
import { buildTenantCustomerCardView } from '@/lib/customer-operations/customerCardTenantView'
import type { SupplierSwitchRequestRow } from '@/lib/operations/types'
import type { CustomerSiteRow } from '@/lib/masterdata/types'

const site = { id: 'site-a', company_id: 'company-a', customer_id: 'customer-a', site_name: 'Teststugan', facility_id: '735999111111111111' } as CustomerSiteRow
const anotherSite = { ...site, id: 'site-b', site_name: 'Testvillan', facility_id: '735999111111111112' }
const foreignSite = { ...site, id: 'site-c', customer_id: 'customer-b', site_name: 'Fel kunds anläggning' }
const active = { id: 'request-a', company_id: 'company-a', customer_id: 'customer-a', site_id: site.id, request_type: 'move_in', requested_start_date: '2026-12-01', status: 'queued' } as SupplierSwitchRequestRow
const sites = [site, anotherSite, foreignSite]
const snapshot = buildCustomerCardSnapshot({ sites: [site, anotherSite], meteringPoints: [], infoRequests: [], contracts: [] })

function workflow(switchRequests: SupplierSwitchRequestRow[]) {
  return buildCustomerCardWorkflow({ customerId: 'customer-a', snapshot, sites, meteringPoints: [], contracts: [], switchRequests, powersOfAttorney: [], isPlatformAdmin: false, infoRequests: [] })
}

it.each(['queued', 'submitted', 'accepted', 'cancellation_requested', 'cancellation_sent'] as const)('keeps %s followable without asserting response or offering a duplicate start', status => {
  const current = workflow([{ ...active, status }])
  expect(current.primaryAction).toBe('follow_supplier_switch')
  expect(current.adminMessage).toBe('Leveransärende pågår.')
  const view = buildTenantCustomerCardView({ snapshot, workflow: current, switchInProgress: true })
  expect(view.processSteps.find(step => step.id === 'facility')?.explanation).not.toContain('väntar på svar')
  expect(view.primaryAction).toBeNull()
  expect(buildCustomerStatusCards({ workflow: current, snapshot }).find(card => card.id === 'supplier_switch')).toMatchObject({
    value: 'Pågår', description: 'Leveransärendet är registrerat. Aktuellt läge visas i ärendet.',
  })
})

it('does not associate a foreign request or site with the customer workflow', () => {
  const current = workflow([{ ...active, company_id: 'company-b' }, { ...active, site_id: foreignSite.id }])
  expect(current.primaryAction).not.toBe('follow_supplier_switch')
})

it('renders only the persisted same-customer same-site destinations for an allowed reader', () => {
  const props = { canReadSwitches: true, companyId: 'company-a', customerId: 'customer-a', sites,
    requests: [active, { ...active, id: 'request-b', site_id: anotherSite.id, request_type: 'switch' as const },
      { ...active, id: 'wrong-company', company_id: 'company-b' }, { ...active, id: 'wrong-site', site_id: foreignSite.id },
      { ...active, id: 'wrong-customer', customer_id: 'customer-b' }] }
  const html = renderToStaticMarkup(React.createElement(CustomerDeliveryCaseLinks, props))
  expect(html).toContain('href="/admin/operations/switches/request-a"')
  expect(html).toContain('Inflytt · Teststugan · 735999111111111111')
  expect(html).toContain('href="/admin/operations/switches/request-b"')
  expect(html).toContain('Leverantörsbyte · Testvillan · 735999111111111112')
  for (const marker of ['wrong-company', 'wrong-site', 'wrong-customer', 'Fel kunds anläggning']) expect(html).not.toContain(marker)
  for (const unavailable of [{ canReadSwitches: false }, { companyId: null }]) {
    expect(renderToStaticMarkup(React.createElement(CustomerDeliveryCaseLinks, { ...props, ...unavailable }))).toBe('')
  }
})
