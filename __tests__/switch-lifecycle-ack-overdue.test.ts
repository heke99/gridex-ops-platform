// reality-defects: GOR-05 (scenario I, scripts/reality/chain-i-grid-owner-rejects.test.ts)
// The operator's switch lifecycle says the grid owner's CONTRL/APERAK is overdue once the 30-minute watch from
// the actual send has passed (TM-CONTRL, ENV-04). Display only: the stage stays awaiting_response, no resend.
import { describe, expect, it } from 'vitest'
import { getSwitchLifecycle } from '@/lib/operations/controlTower'
import type { OutboundRequestRow } from '@/lib/cis/types'
import type { SupplierSwitchRequestRow } from '@/lib/operations/types'

const request = { id: 'switch-1', status: 'prepared', failure_reason: null } as unknown as SupplierSwitchRequestRow
const sentAt = '2026-10-22T10:00:00.000Z'
const outbound = (status: string, sent_at: string | null = sentAt) => ({ id: 'out-1', status, sent_at } as unknown as OutboundRequestRow)
const at = (minutes: number) => new Date(Date.parse(sentAt) + minutes * 60_000)

describe('switch lifecycle while the grid owner has not answered the Z03', () => {
  it('within 30 minutes of the send it is waiting for the acknowledgement', () => {
    expect(getSwitchLifecycle({ request, outboundRequest: outbound('sent'), now: at(29) })).toEqual({ stage: 'awaiting_response', label: 'Väntar på kvittens',
      reason: 'PRODAT Z03 är skickad och väntar på transport-/applikationskvittens.' })
  })

  it('after 30 minutes without CONTRL/APERAK it is overdue for an operator, same stage, no resend', () => {
    const lifecycle = getSwitchLifecycle({ request, outboundRequest: outbound('sent'), now: at(31) })
    expect(lifecycle).toMatchObject({ stage: 'awaiting_response', label: 'Kvittens försenad', responseOverdue: true })
    expect(lifecycle.reason).toContain(sentAt)
    expect(lifecycle.reason).toContain('Ingen automatisk omsändning')
  })

  it('an acknowledged request (waiting for Z04) and one without a send time are never ACK-overdue', () => {
    expect(getSwitchLifecycle({ request, outboundRequest: outbound('acknowledged'), now: at(600) }).responseOverdue).toBeUndefined()
    expect(getSwitchLifecycle({ request, outboundRequest: outbound('sent', null), now: at(600) }).responseOverdue).toBeUndefined()
  })
})

// reality-defects: I-B10 (scenario I6, batch 5d): the switches page passes the site's pre-send readiness. A gap in it
// (here a move-in date the contract start replaces, I-B2a) made every switch "Blockerad", also one whose Z03 was
// already sent, so the operator never saw "Kvittens försenad".
describe('I-B10 a dispatched switch shows its acknowledgement state, not the pre-send readiness', () => {
  const notReady = { isReady: false, issues: [{ code: 'move_in_date_missing', title: 'Inflyttningsdatum saknas' }] } as never
  it('a sent Z03 past its deadline is overdue even when the site readiness has a gap', () => {
    expect(getSwitchLifecycle({ request, readiness: notReady, outboundRequest: outbound('sent'), now: at(31) }))
      .toMatchObject({ stage: 'awaiting_response', label: 'Kvittens försenad', responseOverdue: true })
  })
  it('before the dispatch the readiness gap still blocks', () => {
    for (const status of ['queued', 'prepared']) expect(getSwitchLifecycle({ request, readiness: notReady, outboundRequest: outbound(status, null) }))
      .toMatchObject({ stage: 'blocked', label: 'Blockerad' })
    expect(getSwitchLifecycle({ request, readiness: notReady, outboundRequest: null })).toMatchObject({ stage: 'blocked' })
  })
})

// reality-defects: I-B12 (scenario I6, batch 5e): after 30 minutes the inbound overdue monitor flags the unanswered
// Z03's outbound request `waiting_attention` ("Ediel-kvittens saknas"). The lifecycle had no branch for that status,
// so once I-B10 let the outbound state through, the silent switch was "Oklassificerad", never "Kvittens försenad".
describe('I-B12 an outbound request the overdue monitor flagged', () => {
  const flagged = (acknowledged_at: string | null, failure_reason: string) =>
    ({ id: 'out-1', status: 'waiting_attention', sent_at: sentAt, acknowledged_at, failure_reason } as unknown as OutboundRequestRow)
  it('flagged before any acknowledgement it is overdue for an operator, with no resend', () => {
    const lifecycle = getSwitchLifecycle({ request, outboundRequest: flagged(null, 'Ediel-kvittens saknas'), now: at(31) })
    expect(lifecycle).toMatchObject({ stage: 'awaiting_response', label: 'Kvittens försenad', responseOverdue: true })
    expect(lifecycle.reason).toContain(sentAt)
    expect(lifecycle.reason).toContain('Ingen automatisk omsändning')
  })
  it('flagged after the acknowledgement it waits for the Z04 and says the answer is late, never ACK-overdue', () => {
    const lifecycle = getSwitchLifecycle({ request, outboundRequest: flagged('2026-10-22T10:05:00.000Z', 'Z04-svar saknas'), now: at(2000) })
    expect(lifecycle).toMatchObject({ stage: 'awaiting_market_confirmation', label: 'Z04 försenad' })
    expect(lifecycle.reason).toContain('Z04-svar saknas')
    expect(lifecycle.responseOverdue).toBeUndefined()
  })
})
