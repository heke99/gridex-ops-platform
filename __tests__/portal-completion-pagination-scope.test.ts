import { createElement, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  customers: [
    { id: '00000000-0000-4000-8000-000000000010', customer_number: 'A' },
    { id: '00000000-0000-4000-8000-000000000020', customer_number: 'B' },
  ],
  listSites: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('next/link', () => ({ default: (props: ComponentProps<'a'>) => createElement('a', props) }))
vi.mock('@/app/portal/komplettera/actions', () => ({ submitPortalCompletionAction: async () => undefined }))
vi.mock('@/lib/customer-portal/db', () => ({
  getCustomerPortalContext: async () => ({
    companyId: '00000000-0000-4000-8000-000000000001',
    customers: fixture.customers,
    customerIds: fixture.customers.map(customer => customer.id),
  }),
  listPortalInfoRequests: async (_context: unknown, options: { cursor?: unknown }) => ({
    requests: [],
    continued: Boolean(options.cursor),
    nextCursor: options.cursor ? undefined : 'next-signed-cursor',
  }),
  listPortalCompletions: async () => [],
  listPortalSites: fixture.listSites,
}))
import PortalCompletionPage from '@/app/portal/komplettera/page'

function navigation(html: string, label: string) {
  const href = Array.from(html.matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)).find(match => match[2] === label)?.[1]
  expect(href).toBeDefined()
  return new URL(href!.replaceAll('&amp;', '&'), 'http://localhost')
}
async function render(url: URL) {
  return renderToStaticMarkup(await PortalCompletionPage({
    searchParams: Promise.resolve(Object.fromEntries(url.searchParams)),
  }))
}
const origin = 'http://localhost/portal/komplettera'

it('keeps the selected write account and selected site list when paging in either direction', async () => {
  fixture.listSites.mockResolvedValue([])
  const selected = fixture.customers[1].id
  const first = await render(new URL(origin + '?customer=' + selected))
  const next = navigation(first, 'Fler öppna uppgiftsbegäranden')
  expect(next.searchParams.get('customer')).toBe(selected)
  const second = await render(next)
  const back = navigation(second, 'Visa första sidan')
  expect(back.searchParams.get('customer')).toBe(selected)
  expect(back.searchParams.has('request_cursor')).toBe(false)
  const firstAgain = await render(back)
  for (const page of [first, second, firstAgain]) {
    expect(page).toContain('name="customer_id" value="' + selected + '"')
    expect(page).not.toContain('name="customer_id" value="' + fixture.customers[0].id + '"')
  }
  expect(fixture.listSites.mock.calls.slice(-3).map(([context]) => context.customerIds)).toEqual([[selected], [selected], [selected]])
})

it('does not turn a rejected account selector into default account write access during pagination', async () => {
  const foreign = '00000000-0000-4000-8000-000000000099'
  fixture.listSites.mockClear()
  const first = await render(new URL(origin + '?customer=' + foreign))
  const next = navigation(first, 'Fler öppna uppgiftsbegäranden')
  expect(next.searchParams.has('customer')).toBe(true)
  expect(next.searchParams.get('customer')).not.toBe(foreign)
  const second = await render(next)
  const firstAgain = await render(navigation(second, 'Visa första sidan'))
  for (const page of [first, second, firstAgain]) {
    expect(page).toContain('Det valda kundkontot är inte tillgängligt.')
    expect(page).not.toContain('name="customer_id"')
  }
  expect(fixture.listSites).not.toHaveBeenCalled()
})

it('keeps the existing default-account path without adding a selector', async () => {
  const first = await render(new URL(origin))
  const next = navigation(first, 'Fler öppna uppgiftsbegäranden')
  expect(next.searchParams.has('customer')).toBe(false)
  const second = await render(next)
  expect(navigation(second, 'Visa första sidan').search).toBe('')
  expect(second).toContain('name="customer_id" value="' + fixture.customers[0].id + '"')
})
