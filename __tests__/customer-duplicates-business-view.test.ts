import fs from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'
const io = vi.hoisted(() => ({ platform: false, companyId: 'company-a' as string | null, permissions: ['customers.read'], groups: [] as Array<Record<string, unknown>>, list: vi.fn(), merge: vi.fn() }))
vi.mock('@/lib/admin/guards', () => ({
  requireAdminPageKeyAccess: async () => ({ userId: 'staff', companyId: io.companyId, roles: [], permissions: io.permissions, isPlatformAdmin: io.platform }),
  isPlatformAdminContext: () => io.platform,
}))
vi.mock('@/lib/tenant/scope', () => ({ getOperationalCompanyScope: vi.fn() }))
vi.mock('@/lib/customers/duplicates', () => ({ listDuplicateCustomerGroups: io.list }))
vi.mock('@/app/admin/customers/duplicates/actions', () => ({ mergeCustomersAction: io.merge }))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => React.createElement('a', { href }, children) }))
vi.mock('@/components/admin/AdminHeader', () => ({ default: ({ title, subtitle }: { title: string; subtitle: string }) => React.createElement('header', null, React.createElement('h1', null, title), React.createElement('p', null, subtitle)) }))
import Page from '@/app/admin/customers/duplicates/page'
const candidate = (id: string) => ({ id, company_id: 'company-a', full_name: `Syntetisk kund ${id}`, customer_number: `K-${id}`, personal_number: '200001011234', email: 'kund@example.invalid' })
beforeEach(() => {
  vi.stubGlobal('React', React); io.platform = false; io.companyId = 'company-a'; io.permissions = ['customers.read']
  io.groups = [{ groupKey: 'group', reason: 'Samma e-post', candidates: [candidate('one'), candidate('two')] }]
  io.list.mockReset().mockImplementation(async () => io.groups); io.merge.mockReset()
})
const render = async () => renderToStaticMarkup(await Page())
it('keeps read-only duplicate review scoped and free of merge controls or technical wording', async () => {
  const html = await render()
  expect(io.list).toHaveBeenCalledWith('company-a')
  expect(html).toContain('Syntetisk kund one')
  expect(html).toContain('href="/admin/customers/two"')
  expect(html).not.toContain('200001011234')
  expect(html).not.toContain('<form')
  expect(html).not.toContain('merge')
  expect(html).not.toContain('bulk')
  expect(io.merge).not.toHaveBeenCalled()
  if (process.env.GRIDEX_UI_FIXTURE_DIR) fs.writeFileSync(`${process.env.GRIDEX_UI_FIXTURE_DIR}/duplicates-reader-company.html`, html)
})
it('retains writer selections and reason field in a collapsed merge form', async () => {
  io.permissions.push('customers.write')
  const html = await render()
  expect(html).toContain('Slå ihop kunder')
  expect(html).toMatch(/<input(?=[^>]*name="primaryCustomerId")(?=[^>]*value="one")[^>]*>/)
  expect(html).toMatch(/<input(?=[^>]*name="sourceCustomerIds")(?=[^>]*value="two")[^>]*>/)
  expect(html).toContain('name="reason"')
  expect(html).toContain('<details')
  expect(html).not.toMatch(/<details[^>]*open/)
  expect(io.merge).not.toHaveBeenCalled()
  if (process.env.GRIDEX_UI_FIXTURE_DIR) fs.writeFileSync(`${process.env.GRIDEX_UI_FIXTURE_DIR}/duplicates-writer-company.html`, html)
})
it('retains platform merge controls when its permission array is empty, matching server guard bypass', async () => {
  io.platform = true; io.permissions = []
  expect(await render()).toContain('name="primaryCustomerId"')
})
it('fails closed without a canonical company for a tenant user', async () => {
  io.companyId = null
  await expect(render()).rejects.toThrow('saknar ett aktivt bolag')
  expect(io.list).not.toHaveBeenCalled()
})
it('does not expose groups from another company even if a loader returns them', async () => {
  io.groups = [{ groupKey: 'foreign', reason: 'Samma e-post', candidates: [{ ...candidate('foreign'), company_id: 'company-b' }, candidate('own')] }]
  const html = await render()
  expect(html).not.toContain('Syntetisk kund foreign')
  expect(html).not.toContain('name="primaryCustomerId"')
})
it('omits platform merge controls for a mixed-company group', async () => {
  io.platform = true
  io.groups = [{ groupKey: 'mixed', reason: 'Samma e-post', candidates: [candidate('own'), { ...candidate('foreign'), company_id: 'company-b' }] }]
  const html = await render()
  expect(html).toContain('Syntetisk kund foreign')
  expect(html).not.toContain('name="primaryCustomerId"')
})

it('gives same-reason groups distinct human labels and retains long lists', async () => {
  io.groups = Array.from({ length: 8 }, (_, group) => ({ groupKey: `group-${group}`, reason: 'Samma e-post', candidates: Array.from({ length: 15 }, (_, index) => candidate(`group-${group}-customer-${index}`)) }))
  const html = await render()
  expect(html).toContain('aria-label="Kunder i grupp 1: Samma e-post"')
  expect(html).toContain('aria-label="Kunder i grupp 8: Samma e-post"')
  expect(html).toContain('Syntetisk kund group-7-customer-14')
  if (process.env.GRIDEX_UI_FIXTURE_DIR) fs.writeFileSync(`${process.env.GRIDEX_UI_FIXTURE_DIR}/duplicates-long-company.html`, html)
  io.permissions.push('customers.write')
  const writable = await render()
  expect(writable).toContain('aria-label="Kunder att slå ihop i grupp 1"')
  expect(writable).toContain('aria-label="Kunder att slå ihop i grupp 8"')
})
