import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import type { OutboundRequestRow } from '@/lib/cis/types'
vi.mock('@/components/admin/CustomerName', () => ({ default: () => 'Syntetisk kund' }))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => React.createElement('a', { href }, children) }))
vi.mock('@/app/admin/cis/actions', () => ({ updateOutboundRequestStatusAction: vi.fn() }))
vi.mock('@/app/admin/outbound/unresolved/actions', () => ({ assignRouteToUnresolvedOutboundAction: vi.fn(), rerunUnresolvedRouteResolutionAction: vi.fn() }))
import List from '@/app/admin/outbound/unresolved/UnresolvedRequestsList'
const request = { id: 'internal-outbound-id', customer_id: 'synthetic-customer', request_type: 'supplier_switch', source_type: 'supplier_switch_request', source_id: null, status: 'queued', channel_type: 'unresolved', site_id: null, metering_point_id: null, grid_owner_id: 'internal-grid-owner-id', created_at: '2026-11-15T08:00:00Z', updated_at: '2026-11-15T08:00:00Z', payload: { marker: 'INTERNAL-PAYLOAD' } } as unknown as OutboundRequestRow
const props = { requests: [request], routes: [], switchRequests: [], dataRequests: [], sites: [], meteringPoints: [] }
it('defaults to business-only rendering without route controls or internal references', () => {
  vi.stubGlobal('React', React)
  const html = renderToStaticMarkup(React.createElement(List, props))
  expect(html).toContain('Syntetisk kund')
  expect(html).toContain('Kontakta support')
  expect(html).toContain('/admin/customers/synthetic-customer')
  for (const marker of ['internal-outbound-id', 'internal-grid-owner-id', 'supplier_switch_request', 'Matchande routes', 'INTERNAL-PAYLOAD', '<form']) expect(html).not.toContain(marker)
})
it('keeps the platform route troubleshooting available when enabled by the server', () => {
  vi.stubGlobal('React', React)
  const html = renderToStaticMarkup(React.createElement(List, { ...props, showTechnicalDetails: true }))
  expect(html).toContain('Matchande routes')
  expect(html).toContain('internal-grid-owner-id')
})
