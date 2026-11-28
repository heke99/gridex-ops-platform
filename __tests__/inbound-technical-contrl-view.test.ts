import React from 'react'
import { createHash } from 'node:crypto'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import Page from '@/app/admin/inbound-mail/[id]/page'

const mail = 'd824e5d0-6a02-49ea-8fd1-2a254c24a588'
const company = 'e603832e-829d-4b40-8366-28239f349339'
const source = '54953fe0-aeb5-4c7d-89b1-ac5ffefef779'
const ack = 'ca111703-1190-4757-b3ed-883f2dd5e6e7'
const actor = '50000000-0000-4000-8000-000000000099'
const io = vi.hoisted(() => ({
  scope: 'negative' as 'negative' | 'positive' | 'denied' | 'duplicate' | 'unbound' | 'foreign' | 'mismatched' | 'unscoped',
  query: vi.fn(),
  rpc: vi.fn(),
  platform: vi.fn(),
}))
vi.mock('@/lib/admin/guards', () => ({
  requirePlatformAdminAccess: () => io.platform(),
}))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from(table: string) {
      const filters: [string, unknown][] = []
      let projection: string | undefined
      const row = () => io.query(table, filters, projection)
      const query = {
        select: (columns: string) => { projection = columns; return query },
        eq: (field: string, value: unknown) => { filters.push([field, value]); return query },
        in: (field: string, value: unknown) => { filters.push([field, value]); return query },
        is: (field: string, value: unknown) => { filters.push([field, value]); return query },
        order: () => query,
        limit: () => query,
        maybeSingle: async () => ({ data: row()?.[0] ?? null, error: null }),
        then: (finish: (value: unknown) => unknown) => Promise.resolve({ data: row(), error: null }).then(finish),
      }
      return query
    },
    rpc: (name: string, args: unknown) => io.rpc(name, args),
  },
}))
vi.mock('@/app/admin/inbound-mail/actions', () => ({ reprocessInboundEmailAction: vi.fn() }))
vi.mock('@/app/admin/inbound-mail/[id]/InboundManualReviewForm', () => ({
  default: () => React.createElement('span', null, 'Manuell uppföljning tillgänglig'),
}))
vi.mock('@/components/admin/AdminHeader', () => ({
  default: ({ title }: { title: string }) => React.createElement('h1', null, title),
}))

const digest = (raw: string) => createHash('sha256').update(raw).digest('hex')
// Synthetic retained TEST original from the physical wrong-UNT case.
const raw = `UNA:+.? '
UNB+UNOC:3+70240:ZZ+16880:ZZ+261101:1214+SYN26E66BADUNT++23-DDQ-E66-T++1++1'
UNH+1+UTILTS:D:02B:UN:E5SE5A'
BGM+E66::260+SYNTHETIC-E66-RAD43-JULY+9+AB'
DTM+137:202611011214:203'
DTM+735:?+0200:406'
MKS+23+E02::260'
NAD+MS+70240:SVK:260'
NAD+MR+16880:SVK:260'
NAD+DDQ'
RFF+ACW:SYNTHETIC-E73-RAD43-DISTINCT'
IDE+24+SYN26E66BADUNT'
LOC+172+735999261031000247::9'
LOC+239+TES:SVK:260'
LIN+++8716867000030:::9'
DTM+324:202607010000202607010030:719'
DTM+597:202607010030:203'
DTM+354:15:806'
STS+7++E88::260'
MEA+AAZ++KWH'
CCI+++E12::260'
CAV+E17::260'
SEQ++1'
QTY+136:500'
DTM+597:202607010000:203'
STS+7++21::260'
SEQ++2'
QTY+136:700'
DTM+597:202607010015:203'
STS+7++21::260'
UNT+999+1'
UNZ+1+SYN26E66BADUNT'`
const sourceRecord = { id: source, company_id: company, environment: 'test', direction: 'inbound',
  message_family: 'UTILTS', message_code: 'E66', message_standard: 'edifact', raw_payload: raw,
  inbound_email_message_id: mail }

beforeEach(() => {
  vi.stubGlobal('React', React)
  vi.clearAllMocks()
  io.scope = 'negative'
  io.platform.mockResolvedValue({ userId: actor, email: 'local@example.invalid', permissions: [], companyId: company })
  io.query.mockImplementation((table: string) => {
    if (table === 'inbound_email_messages') return [{ id: mail, company_id: io.scope === 'unscoped' ? null : company, environment: 'test', processing_status: 'manual_review' }]
    if (table === 'inbound_processing_jobs') return [{ id: '42f34530-4bf7-4544-85ce-57a9a7f555f6',
      status: 'manual_review', step: 'manual_review', review_resolved_at: null, error_message: null }]
    if (table === 'ediel_messages') return io.scope === 'unbound' ? [] :
      io.scope === 'duplicate' ? [sourceRecord, { ...sourceRecord, id: ack }] :
      io.scope === 'foreign' ? [{ ...sourceRecord, company_id: actor }] : [sourceRecord]
    return []
  })
  io.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    expect(name).toBe('gridex_read_outbound_acks_for_source_v2')
    expect(args).toEqual({ p_source_message_id: source, p_ack_family: 'CONTRL', p_actor_user_id: actor, p_phase: 'read' })
    if (io.scope === 'denied') return { data: null, error: { code: '42501' } }
    const positive = io.scope === 'positive'
    const ackRaw = EdifactEnvelopeCodec.encode({
      sender: '16880', receiver: '70240', interchangeReference: 'ACKI',
      applicationReference: null, environment: 'test', acknowledgementRequest: false,
      messages: [{ messageReference: 'ACKM', messageTypeToken: 'CONTRL:2:2:UN:EDIEL2',
        businessSegments: [`UCI+SYN26E66BADUNT+70240:ZZ+16880:ZZ+${positive ? 1 : 4}`] }],
    })
    return { error: null, data: { version: 2, executionActorUserId: actor, executionPhase: 'read',
      sourceMessageId: source, sourcePayloadHash: digest(raw), environment: 'test', companyId: io.scope === 'mismatched' ? actor : company,
      originals: [{ status: 'qualified', payloadHash: digest(ackRaw), message: {
        id: ack, company_id: company, environment: 'test', direction: 'outbound', message_family: 'CONTRL',
        related_message_id: source, raw_payload: ackRaw,
      } }],
    } }
  })
})

const render = async () => renderToStaticMarkup(await Page({ params: Promise.resolve({ id: mail }), searchParams: Promise.resolve({}) }))

it('shows a verified negative technical receipt without claiming the associated review is done', async () => {
  const html = await render()
  expect(html).toContain('Negativ teknisk kvittens sparad')
  expect(html).toContain('Manuell uppföljning tillgänglig')
  expect(html).toContain('Processa om')
  expect(html).not.toContain('Åtgärd krävs innan jobbet kan fortsätta')
  expect(html).not.toContain(digest(raw))
  expect(html).not.toContain(ack)
  expect(io.rpc).toHaveBeenCalledTimes(1)
  expect(io.query).toHaveBeenCalledWith('ediel_messages', expect.arrayContaining([
    ['inbound_email_message_id', mail], ['company_id', company], ['environment', 'test'], ['direction', 'inbound'],
  ]), 'id,inbound_email_message_id,company_id,environment,direction,raw_payload,message_family')
})

it.each(['positive', 'denied', 'duplicate', 'unbound', 'foreign', 'mismatched'] as const)('keeps ordinary review and avoids claiming negative proof when %s', async scope => {
  io.scope = scope
  const html = await render()
  expect(html).not.toContain('Negativ teknisk kvittens sparad')
  expect(html).toContain('Åtgärd krävs innan jobbet kan fortsätta')
})

it('never reads mail or technical receipts without the platform page guard', async () => {
  io.platform.mockRejectedValueOnce(new Error('platform-required'))
  await expect(render()).rejects.toThrow('platform-required')
  expect(io.query).not.toHaveBeenCalled()
  expect(io.rpc).not.toHaveBeenCalled()
})

it('skips the source and ACK reads when company scope is missing', async () => {
  io.scope = 'unscoped'
  expect(await render()).not.toContain('Negativ teknisk kvittens sparad')
  expect(io.query.mock.calls.some(([table]) => table === 'ediel_messages')).toBe(false)
  expect(io.rpc).not.toHaveBeenCalled()
})
