import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MessagesPage from '@/app/admin/ediel/messages/page'

const id = (number: number) => `10000000-0000-4000-8000-${String(number).padStart(12, '0')}`
const companyA = id(1)
const companyB = id(2)
const actor = id(3)
const sourceTime = '2026-10-01T00:00:00.123456+00:00'
const ackTime = '2026-11-01T00:00:00.654321+00:00'

type Row = {
  id: string
  company_id: string
  created_at: string
  direction: 'inbound' | 'outbound'
  message_family: string
  message_code: string | null
  related_message_id: string | null
  status: string
}
function row(number: number, overrides: Partial<Row> = {}): Row {
  return {
    id: id(number), company_id: companyA, created_at: sourceTime, direction: 'inbound',
    message_family: 'PRODAT', message_code: 'Z04', related_message_id: null, status: 'received',
    ...overrides,
  }
}
const primary = Array.from({ length: 103 }, (_, index) => row(100 + index))
const contrls = Array.from({ length: 105 }, (_, index) => row(400 + index, {
  created_at: ackTime, direction: 'outbound', message_family: 'CONTRL', message_code: 'CONTRL', related_message_id: id(202),
}))
const records = [
  ...primary, ...contrls,
  row(520, { created_at: ackTime, message_family: 'CONTRL', message_code: 'CONTRL' }),
  row(521, { created_at: ackTime, message_family: 'APERAK', related_message_id: id(202) }),
  row(522, { created_at: ackTime, message_family: 'UTILTS_ERR', message_code: 'ERR', related_message_id: id(202) }),
  row(523, { created_at: ackTime, message_family: 'UTILTS', message_code: 'err', related_message_id: id(202) }),
  row(524, { created_at: ackTime, message_family: 'UTILTS', message_code: null, related_message_id: id(202) }),
  row(525, { created_at: ackTime, message_family: 'PRODAT', related_message_id: id(202), status: 'failed' }),
  row(526, { created_at: ackTime, company_id: companyB }),
]
const selected = vi.hoisted(() => ({
  companyId: '', permitted: true, queries: [] as URLSearchParams[],
  ackLookups: [] as { companyId: string; actorUserId: string; sourceMessageId: string }[],
}))
vi.mock('@/lib/admin/guards', () => ({
  requirePlatformAdminAccess: async () => {
    if (!selected.permitted) throw new Error('Platform access denied')
    return { userId: actor, companyId: selected.companyId, isPlatformAdmin: true }
  },
  isPlatformAdminContext: () => true,
}))
vi.mock('@/lib/tenant/scope', () => ({ getOperationalCompanyScope: async () => ({ companyId: selected.companyId }) }))
vi.mock('@/lib/tenant/liveAccess', () => ({ getTenantLiveAccessForAdmin: async () => ({ canUseLiveEdiel: true }) }))
vi.mock('@/components/admin/AdminHeader', () => ({ default: () => null }))
vi.mock('@/app/admin/ediel/actions', () => ({
  deleteAllEdielMessagesAction: vi.fn(), deleteEdielMessageAction: vi.fn(), pollMailboxAction: vi.fn(),
  processEdielOperationalMessageAction: vi.fn(), sendEdielMessageAction: vi.fn(),
}))
vi.mock('@/lib/ediel/inbound/businessAckReadModel', () => ({
  readBusinessAckStatus: vi.fn(), businessAckStatusPresentation: vi.fn(() => ({ state: 'unknown' })),
  readBusinessAckStatusForDisplay: async (input: { companyId: string; actorUserId: string; sourceMessageId: string }) => {
    selected.ackLookups.push(input)
    const messages = input.companyId === companyA && input.sourceMessageId === id(202) ? [contrls[0]] : []
    return { messages, heldOriginalIds: [] }
  },
}))

function isAck(row: Row) {
  return ['CONTRL', 'APERAK', 'UTILTS_ERR'].includes(row.message_family)
    || (row.message_family === 'UTILTS' && row.message_code?.toUpperCase() === 'ERR')
}
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return {supabaseService: createClient('http://127.0.0.1:32175', 'synthetic-key', {
    auth: {persistSession: false, autoRefreshToken: false},
    global: { fetch: async (input, init) => {
      const request = new Request(input, init)
      const url = new URL(request.url)
      expect(url.origin).toBe('http://127.0.0.1:32175')
      expect(url.pathname).toBe('/rest/v1/ediel_messages')
      expect(request.method).toBe('GET')
      const query = url.searchParams
      selected.queries.push(query)
      let rows = records.filter(row => ['company_id','message_family','direction','status'].every(column => {
        const filter = query.get(column)
        return !filter || filter === 'eq.' + row[column as keyof Row]
      }))
      for (const expression of query.getAll('or')) {
        if (expression.includes('related_message_id.is.null')) {
          expect(expression).toContain('message_family.not.in.(CONTRL,APERAK,UTILTS_ERR)')
          expect(expression).toContain('message_code.is.null')
          expect(expression).toContain('message_code.not.ilike.ERR')
          rows = rows.filter(row => !row.related_message_id || !isAck(row))
        } else if (expression.includes('message_family.eq.UTILTS_ERR')) {
          expect(expression).toContain('and(message_family.eq.UTILTS,message_code.ilike.ERR)')
          rows = rows.filter(row => row.message_family === 'UTILTS_ERR' || (row.message_family === 'UTILTS' && isAck(row)))
        } else {
          const cutoff = /^\(created_at\.lt\.([^,]+),and\(created_at\.eq\.\1,id\.lt\.([a-f0-9-]+)\)\)$/.exec(expression)
          if (!cutoff) throw new Error('Unexpected synthetic filter')
          rows = rows.filter(row => row.created_at < cutoff[1] || (row.created_at === cutoff[1] && row.id < cutoff[2]))
        }
      }
      rows.sort((left,right) => right.created_at.localeCompare(left.created_at)
        || (query.get('order')?.includes('id.desc') ? right.id.localeCompare(left.id) : 0))
      return Response.json(rows.slice(0, Number(query.get('limit'))))
    } },
  })}
})

async function render(params: Record<string, string | string[]> = {}) {
  return renderToStaticMarkup(await MessagesPage({ searchParams: Promise.resolve(params) }))
}
function nextParams(html: string) {
  const href = Array.from(html.matchAll(/href="([^"]+)"[^>]*>Nästa sida<\/a>/g))[0]?.[1]
  expect(href).toBeDefined()
  return Object.fromEntries(new URL(href.replaceAll('&amp;','&'), 'http://127.0.0.1').searchParams)
}
function containsLink(html: string, rowId: string) {
  return html.includes(`href="/admin/ediel/messages/${rowId}"`)
}

beforeEach(() => {
  selected.companyId = companyA
  selected.permitted = true
  selected.queries = []
  selected.ackLookups = []
})

describe('Ediel message center lists primary messages before loading their acknowledgments', () => {
  it('keeps older sources visible behind linked acknowledgments and loads only displayed sources', async () => {
    const html = await render()

    expect(containsLink(html, id(202))).toBe(true)
    expect(containsLink(html, id(400))).toBe(true)
    expect(containsLink(html, id(504))).toBe(false)
    expect(containsLink(html, id(520))).toBe(true)
    expect(containsLink(html, id(524))).toBe(true)
    expect(containsLink(html, id(525))).toBe(true)
    expect(containsLink(html, id(526))).toBe(false)
    expect(selected.queries[0].get('company_id')).toBe('eq.' + companyA)
    expect(selected.queries[0].get('limit')).toBe('101')
    expect(selected.ackLookups).toHaveLength(100)
    expect(selected.ackLookups).toContainEqual({companyId: companyA, actorUserId: actor, sourceMessageId: id(202)})
    expect(selected.ackLookups.some(lookup => lookup.sourceMessageId === id(504))).toBe(false)
  })

  it('reaches older cards without duplicates across equal microsecond timestamps', async () => {
    const first = await render({direction:'inbound'})
    const query = nextParams(first)
    const second = await render(query)

    expect(query.direction).toBe('inbound')
    expect(containsLink(first, id(106))).toBe(true)
    expect(containsLink(first, id(105))).toBe(false)
    expect(containsLink(second, id(106))).toBe(false)
    expect(containsLink(second, id(105))).toBe(true)
    expect(containsLink(second, id(100))).toBe(true)
    expect(second).not.toContain('Nästa sida')
    expect(second).toContain('Första sidan')
    expect(selected.queries[1].getAll('or').some(value => value.includes(sourceTime))).toBe(true)
  })

  it('pages direct CONTRL results and matches both canonical and legacy UTILTS error acknowledgments', async () => {
    const first = await render({family:'CONTRL',direction:'outbound',status:'received'})
    expect(containsLink(first, id(504))).toBe(true)
    expect(containsLink(first, id(400))).toBe(false)
    const query = nextParams(first)
    expect(query).toMatchObject({family:'CONTRL',direction:'outbound',status:'received'})
    const second = await render(query)
    expect(containsLink(second, id(400))).toBe(true)
    expect(containsLink(second, id(504))).toBe(false)

    const errors = await render({family:'UTILTS_ERR'})
    expect(containsLink(errors, id(522))).toBe(true)
    expect(containsLink(errors, id(523))).toBe(true)
    expect(containsLink(errors, id(524))).toBe(false)
  })

  it('reapplies current company scope when following an existing cursor after a switch', async () => {
    const query = nextParams(await render())
    selected.companyId = companyB
    selected.ackLookups = []
    const page = await render(query)

    expect(containsLink(page, id(202))).toBe(false)
    expect(page).toContain('Inga Ediel-meddelanden hittades för filtret.')
    expect(selected.queries[1].get('company_id')).toBe('eq.' + companyB)
    expect(selected.ackLookups).toEqual([])
  })

  it('uses the first page when a malformed or ambiguous cursor is supplied', async () => {
    const malformed = await render({before:'invalid-date',beforeId:id(100)})
    const invalidCalendarDay = await render({before:'2026-02-31T00:00:00+00:00',beforeId:id(100)})
    const ambiguous = await render({before:[sourceTime,ackTime],beforeId:id(100)})

    expect(containsLink(malformed, id(202))).toBe(true)
    expect(containsLink(invalidCalendarDay, id(202))).toBe(true)
    expect(containsLink(ambiguous, id(202))).toBe(true)
    expect(selected.queries.every(query => query.getAll('or').length === 1)).toBe(true)
  })

  it('checks platform access before reading the list or any acknowledgments', async () => {
    selected.permitted = false

    await expect(render()).rejects.toThrow('Platform access denied')
    expect(selected.queries).toEqual([])
    expect(selected.ackLookups).toEqual([])
  })
})
