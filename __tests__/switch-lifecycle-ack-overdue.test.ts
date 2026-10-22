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
