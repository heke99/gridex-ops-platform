import fs from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'
import type { CustomerSiteRow, GridOwnerRow, MeteringPointRow } from '@/lib/masterdata/types'
import SitesView from '@/components/admin/customers/CustomerSitesBusinessView'
const site = (id: string, extra = {}) => ({ id, company_id: 'company-a', customer_id: 'customer', site_name: `Anläggning ${id}`, facility_id: `735999${id}`, site_type: 'consumption', status: 'active', grid_owner_id: 'owner', price_area_code: 'SE3', move_in_date: '2026-12-01', move_out_date: '2027-06-30', street: 'Testvägen 1', postal_code: '11122', city: 'Teststad', ...extra }) as CustomerSiteRow
const point = (id: string, siteId: string, extra = {}) => ({ id, site_id: siteId, customer_id: 'customer', company_id: 'company-a', meter_point_id: `735888${id}`, status: 'active', measurement_type: 'consumption', grid_owner_id: 'owner', price_area_code: 'SE3', ...extra }) as MeteringPointRow
const owners = [{ id: 'owner', name: 'Syntetisk nätägare' }, { id: 'different-owner', name: 'Annan nätägare' }] as GridOwnerRow[]
const render = (sites = [site('one'), site('two', { status: 'pending_move' })], points = [point('meter1', 'one'), point('meter2', 'two')], companyId: string | null = 'company-a') => renderToStaticMarkup(React.createElement(SitesView, { companyId, customerId: 'customer', primarySiteId: 'one', sites, meteringPoints: points, gridOwners: owners }))
beforeEach(() => { vi.stubGlobal('React', React) })
it('shows every loaded own site and its physical metering identity, owner and move dates', () => {
  const html = render()
  expect(html).toContain('Kundens anläggningar (2)')
  for (const value of ['Anläggning one', 'Anläggning two', '735888meter1', '735888meter2', 'Syntetisk nätägare', '2026-12-01', '2027-06-30', 'Inflytt planerad']) expect(html).toContain(value)
  expect(html.match(/Visas i översikten/g)).toHaveLength(1)
  expect(html).not.toContain('<form')
  expect(html).not.toContain('href=')
  if (process.env.GRIDEX_UI_FIXTURE_DIR) fs.writeFileSync(`${process.env.GRIDEX_UI_FIXTURE_DIR}/customer-sites-company.html`, `<main>${html}</main>`)
})
it('does not expose sites from another customer or company', () => {
  const html = render([site('own'), site('foreign-company', { company_id: 'company-b' }), site('foreign-customer', { customer_id: 'other' })], [])
  expect(html).toContain('Anläggning own')
  expect(html).not.toContain('foreign-company')
  expect(html).not.toContain('foreign-customer')
})
it('does not expose metering points with conflicting company, customer or site references', () => {
  const html = render([site('one')], [point('own', 'one'), point('foreign-company', 'one', { company_id: 'company-b' }), point('foreign-customer', 'one', { customer_id: 'other' }), point('foreign-site', 'one', { customer_site_id: 'other-site' }), point('missing-company', 'one', { company_id: null })])
  expect(html).toContain('735888own')
  for (const hidden of ['foreign-company', 'foreign-customer', 'foreign-site', 'missing-company']) expect(html).not.toContain(hidden)
})
it('can display legacy points without customer_id through their verified own company/site link', () => {
  expect(render([site('one')], [point('legacy', 'one', { customer_id: null })])).toContain('735888legacy')
})
it('shows unknown fields as business text without internal identifier fallbacks', () => {
  const html = render([site('RAW_SITE_ID', { site_name: '', facility_id: null, site_type: 'RAW_TYPE', status: 'RAW_STATUS', grid_owner_id: 'RAW_OWNER_ID' })], [point('RAW_METER_ID', 'RAW_SITE_ID', { meter_point_id: null, status: 'RAW_METER_STATUS', measurement_type: 'RAW_MEASUREMENT' })])
  for (const hidden of ['RAW_SITE_ID', 'RAW_TYPE', 'RAW_STATUS', 'RAW_OWNER_ID', 'RAW_METER_ID', 'RAW_METER_STATUS', 'RAW_MEASUREMENT']) expect(html).not.toContain(hidden)
  expect(html).toContain('Anläggningsnummer saknas')
  expect(html).toContain('Mätpunktsnummer saknas')
  expect(html).toContain('Nätägaruppgifter saknas')
})
it('identifies inconsistent network owners without replacing their actual recorded identities', () => {
  const html = render([site('one')], [point('meter1', 'one', { grid_owner_id: 'different-owner' })])
  expect(html).toContain('Syntetisk nätägare')
  expect(html).toContain('Annan nätägare')
  expect(html).toContain('Nätägaren skiljer sig')
})
it('can show the single known meter owner when the site owner is not recorded', () => {
  expect(render([site('one', { grid_owner_id: null })], [point('meter1', 'one')])).toContain('Syntetisk nätägare')
})
it('fails closed for a missing company', () => {
  const html = render([site('one')], [], null)
  expect(html).toContain('kunde inte visas för valt bolag')
  expect(html).not.toContain('Anläggning one')
})
it('shows an empty message when no own sites are registered', () => {
  expect(render([], [])).toContain('Inga anläggningar registrerade')
})
it('keeps all loaded sites available inside a named keyboard accessible bounded list', () => {
  const html = render(Array.from({ length: 30 }, (_, i) => site(`long-${i}`)), [])
  expect(html).toContain('Anläggning long-29')
  expect(html).toContain('aria-label="Kundens anläggningar"')
  expect(html).toContain('tabindex="0"')
  expect(html).toContain('overflow-y-auto')
  if (process.env.GRIDEX_UI_FIXTURE_DIR) fs.writeFileSync(`${process.env.GRIDEX_UI_FIXTURE_DIR}/customer-sites-long-company.html`, `<main>${html}</main>`)
})
it('the server page selects this view only for companies and preserves platform editing', () => {
  const source = fs.readFileSync('app/admin/customers/[id]/page.part-4.tsx', 'utf8')
  expect(source).toContain('{!isPlatformAdmin ? <CustomerSitesBusinessView')
  expect(source).toContain('companyId={customerCompanyId}')
  expect(source).toContain('<CustomerSiteForm')
  expect(source).toContain('<CustomerSitesTable')
})

it('gives same-name sites distinct accessible metering region names', () => {
  const html = render([site('one', { site_name: 'Bostad' }), site('two', { site_name: 'Bostad' })])
  expect(html).toContain('aria-label="Mätpunkter för anläggning 1: Bostad"')
  expect(html).toContain('aria-label="Mätpunkter för anläggning 2: Bostad"')
})
