// FINDINGS F80 (panels): the workbench DispatchPanels and the operational bridge
// panel offer the UTILTS engine only when the single server-side resumability
// rule says the source is resumable, label it "Återuppta hållna transaktioner"
// when transactions are held, and otherwise show the rule's explanation.
// Decisions are built with the real decideUtiltsSourceResumability /
// describeUtiltsSourceResumability. Synthetic data only.
import { createElement, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({ readForSources: vi.fn(), process: vi.fn(), negative: vi.fn() }))

vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: vi.fn(), rpc: vi.fn() } }))
vi.mock('@/app/admin/ediel/actions', () => ({
  createAckDraftAction: vi.fn(),
  createNegativeUtiltsResponseAction: io.negative,
  createProdatDraftAction: vi.fn(),
  processEdielOperationalMessageAction: io.process,
  pollMailboxAction: vi.fn(),
  sendEdielMessageAction: vi.fn(),
  prepareSwitchZ03Action: vi.fn(),
}))
vi.mock('@/lib/ediel/operationalBridge', () => ({
  getEdielOperationalBridgeSummary: () => ({
    switchRequestsOpen: 0, prodatZ03Outbound: 0, prodatZ04Inbound: 0, prodatZ05Inbound: 0,
    utiltsInboundMetering: 0, candidateInboundToProcess: 0, smtpEcpEnabled: false,
  }),
}))
vi.mock('@/lib/ediel/utilts/utiltsResumability', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ediel/utilts/utiltsResumability')>()),
  readUtiltsSourceResumabilityForSources: io.readForSources,
}))

import {
  decideUtiltsSourceResumability,
  describeUtiltsSourceResumability,
  type UtiltsResumabilityReplyRow,
  type UtiltsResumabilityTransactionRow,
  type UtiltsSourceResumability,
} from '@/lib/ediel/utilts/utiltsResumability'
import DispatchPanels, { type InboundUtiltsResumabilityView } from '@/components/admin/ediel/workbench/DispatchPanels'
import EdielOperationalBridgePanel from '@/components/admin/ediel/EdielOperationalBridgePanel'
import type { EdielMessageRow } from '@/lib/ediel/types'

const COMPANY = 'company-a'
const SOURCE_ID = '33333333-3333-4333-8333-000000000001'
const PRODAT_ID = '33333333-3333-4333-8333-000000000002'
const HELD_LABEL = 'Återuppta hållna transaktioner'
const UNAVAILABLE = 'Återupptagningsstatus kunde inte läsas för aktuell tenant och miljö.'

function tx(overrides: Partial<UtiltsResumabilityTransactionRow>): UtiltsResumabilityTransactionRow {
  return {
    source_transaction_id: 'TX1', disposition: 'internal_review', planned_response_type: 'none',
    final_response_type: null, response_message_id: null, finalized_at: null, issue_codes: [], ...overrides,
  }
}

function decide(transactions: UtiltsResumabilityTransactionRow[], replies: UtiltsResumabilityReplyRow[]): UtiltsSourceResumability {
  return decideUtiltsSourceResumability({
    companyId: COMPANY,
    environment: 'test',
    source: { id: SOURCE_ID, company_id: COMPANY, environment: 'test', direction: 'inbound', message_family: 'UTILTS' },
    transactions,
    replies,
  })
}

const contrl: UtiltsResumabilityReplyRow = { id: 'contrl-1', message_family: 'CONTRL', message_code: null, status: 'sent', transaction_reference: null }
const held = decide([tx({ issue_codes: ['UTILTS_ISSUER_IDENTITY_BASIS_UNAVAILABLE'] })], [contrl])
const notYetAnswered = decide([], [])
const rejected = decide(
  [tx({ disposition: 'guide_rejected', planned_response_type: 'utilts_err', final_response_type: 'utilts_err', response_message_id: 'err-1', finalized_at: '2026-10-22T08:00:00Z' })],
  [contrl, { id: 'err-1', message_family: 'UTILTS_ERR', message_code: null, status: 'sent', transaction_reference: 'TX1' }],
)

/** Mirrors what the rendering server component passes: decision + rule text, computed server-side. */
function view(decision: UtiltsSourceResumability): InboundUtiltsResumabilityView {
  return { resumable: decision.resumable, held: decision.reason === 'held_transactions', explanation: describeUtiltsSourceResumability(decision) }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;')
}

function renderDispatch(resumability: Record<string, InboundUtiltsResumabilityView> | null, selected = SOURCE_ID): string {
  const utiltsRow = { id: SOURCE_ID, message_family: 'UTILTS', message_code: 'E66', status: 'validated', direction: 'inbound' }
  const noop = () => undefined
  const props = {
    selectedMessageId: '', setSelectedMessageId: noop, sendableMessagesToShow: [], selectedMessage: null,
    mailbox: '', setMailbox: noop, pollRouteId: '', setPollRouteId: noop, recommendedRoutes: [], selectedPollRoute: null,
    selectedInboundUtiltsId: selected, setSelectedInboundUtiltsId: noop,
    inboundUtiltsMessagesToShow: selected ? [utiltsRow] : [], selectedInboundUtilts: selected ? utiltsRow : null,
    selectedAckSourceId: '', setSelectedAckSourceId: noop, ackableMessagesToShow: [], selectedAckSource: null,
    prodatCode: 'Z03', setProdatCode: noop, selectedRouteId: '', setSelectedRouteId: noop, selectedRoute: null,
    selectedSwitchId: '', senderEdielId: '', setSenderEdielId: noop, receiverEdielId: '', setReceiverEdielId: noop,
    senderSubAddress: '', setSenderSubAddress: noop, receiverSubAddress: '', setReceiverSubAddress: noop,
    applicationReference: '', setApplicationReference: noop, dispatchMailbox: '', setDispatchMailbox: noop,
    receiverEmail: '', setReceiverEmail: noop, recommendedRouteText: '',
    inboundUtiltsResumability: resumability,
  } as unknown as ComponentProps<typeof DispatchPanels>
  return renderToStaticMarkup(createElement(DispatchPanels, props))
}

function messageRow(overrides: Partial<EdielMessageRow>): EdielMessageRow {
  return {
    id: SOURCE_ID, company_id: COMPANY, environment: 'test', direction: 'inbound', message_family: 'UTILTS',
    message_code: 'E66', status: 'validated', switch_request_id: null, grid_owner_data_request_id: null,
    external_reference: null, transaction_reference: null, ...overrides,
  } as EdielMessageRow
}

async function renderBridge(messages: EdielMessageRow[]): Promise<string> {
  const element = await EdielOperationalBridgePanel({ messages, switchRequests: [], dataRequests: [], outboundRequests: [], routes: [] })
  return renderToStaticMarkup(element)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('DispatchPanels inbound UTILTS engine (F80)', () => {
  it('offers "Återuppta hållna transaktioner" for a held source and explains the hold', () => {
    expect(held.resumable).toBe(true)
    const html = renderDispatch({ [SOURCE_ID]: view(held) })
    expect(html).toContain(HELD_LABEL)
    expect(html).not.toContain('Kör UTILTS engine / skapa TGT-svar')
    expect(html).toContain(`name="edielMessageId" value="${SOURCE_ID}"`)
    expect(html).toContain('Hålls för intern granskning')
    expect(html).toContain(escapeHtml(describeUtiltsSourceResumability(held)))
    expect(html).not.toContain('Engine körs inte igen')
  })

  it('offers the engine with the normal label when the source has never been answered', () => {
    const html = renderDispatch({ [SOURCE_ID]: view(notYetAnswered) })
    expect(html).toContain('Kör UTILTS engine / skapa TGT-svar')
    expect(html).not.toContain(HELD_LABEL)
    expect(html).not.toContain('Hålls för intern granskning')
  })

  it('hides the engine and shows the rule explanation when the source is already answered (new file required)', () => {
    expect(rejected.resumable).toBe(false)
    const html = renderDispatch({ [SOURCE_ID]: view(rejected) })
    expect(html).not.toContain(HELD_LABEL)
    expect(html).not.toContain('Kör UTILTS engine / skapa TGT-svar')
    expect(html).toContain('Engine körs inte igen')
    expect(html).toContain(escapeHtml(describeUtiltsSourceResumability(rejected)))
    expect(html).toContain('ny, rättad fil')
  })

  it('fails closed when no server decision exists for the selected source', () => {
    for (const resumability of [null, {}]) {
      const html = renderDispatch(resumability)
      expect(html).not.toContain(HELD_LABEL)
      expect(html).not.toContain('Kör UTILTS engine / skapa TGT-svar')
      expect(html).toContain(UNAVAILABLE)
    }
  })

  it('renders neither button nor explanation when no inbound UTILTS is selected', () => {
    const html = renderDispatch({ [SOURCE_ID]: view(held) }, '')
    expect(html).not.toContain(HELD_LABEL)
    expect(html).not.toContain('Kör UTILTS engine / skapa TGT-svar')
    expect(html).not.toContain('Engine körs inte igen')
  })
})

describe('EdielOperationalBridgePanel inbound UTILTS engine (F80)', () => {
  it('reads the rule server-side for inbound UTILTS candidates only and offers resumption when held', async () => {
    io.readForSources.mockResolvedValue(new Map([[SOURCE_ID, held]]))
    const prodat = messageRow({ id: PRODAT_ID, message_family: 'PRODAT', message_code: 'Z04' })
    const html = await renderBridge([messageRow({}), prodat])
    expect(io.readForSources).toHaveBeenCalledTimes(1)
    expect(io.readForSources.mock.calls[0][0].map((row: EdielMessageRow) => row.id)).toEqual([SOURCE_ID])
    expect(html).toContain(HELD_LABEL)
    expect(html).toContain(escapeHtml(describeUtiltsSourceResumability(held)))
    // Non-UTILTS candidates keep their own engine button.
    expect(html.match(/Kör engine \/ skapa svar/g)).toHaveLength(1)
    expect(html).toContain(`name="edielMessageId" value="${PRODAT_ID}"`)
    expect(html).toContain(`name="edielMessageId" value="${SOURCE_ID}"`)
  })

  it('offers the normal engine for a never-answered UTILTS source', async () => {
    io.readForSources.mockResolvedValue(new Map([[SOURCE_ID, notYetAnswered]]))
    const html = await renderBridge([messageRow({})])
    expect(html).toContain('Kör engine / skapa svar')
    expect(html).not.toContain(HELD_LABEL)
  })

  it('hides the engine and explains why for an answered/rejected UTILTS source', async () => {
    io.readForSources.mockResolvedValue(new Map([[SOURCE_ID, rejected]]))
    const html = await renderBridge([messageRow({})])
    expect(html).not.toContain('Kör engine / skapa svar')
    expect(html).not.toContain(HELD_LABEL)
    expect(html).not.toContain(`name="edielMessageId" value="${SOURCE_ID}"`)
    expect(html).toContain('Engine körs inte igen')
    expect(html).toContain(escapeHtml(describeUtiltsSourceResumability(rejected)))
  })

  it('fails closed when the rule cannot be read', async () => {
    io.readForSources.mockRejectedValue(new Error('utilts_resumability_read_failed:replies'))
    const html = await renderBridge([messageRow({})])
    expect(html).not.toContain('Kör engine / skapa svar')
    expect(html).not.toContain(`name="edielMessageId" value="${SOURCE_ID}"`)
    expect(html).toContain(UNAVAILABLE)
  })

  it('does not read the rule when there is no inbound UTILTS candidate', async () => {
    const html = await renderBridge([messageRow({ id: PRODAT_ID, message_family: 'PRODAT', message_code: 'Z04' })])
    expect(io.readForSources).not.toHaveBeenCalled()
    expect(html).toContain('Kör engine / skapa svar')
  })
})
