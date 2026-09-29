import type { EdielMessageRow } from '@/lib/ediel/types'

export type S02PlanningDefect = 'clean' | 'missing-point' | 'missing-quantity' | 'missing-both'
export type S02PlanningTransaction = {
  reference: string
  point: string
  quantity: number
  defect?: S02PlanningDefect
}

/** Synthetic physical bytes based on U/UE 25-A-4 pp50–52, UE pp69–72/93.
 * A forecast is nonbilling data. This is no historical issuer/mandate evidence. */
export function s02PlanningFixture(params: {
  company: string
  receiver?: string
  transactions: readonly S02PlanningTransaction[]
}): EdielMessageRow {
  const receiver = params.receiver ?? '21660'
  const wire = [
    "UNA:+.? '",
    `UNB+UNOC:3+91100:ZZ+${receiver}:ZZ+261001:1811+S02NATIVE001++23-DDQ-S02-S++1'`,
    "UNH+1+UTILTS:D:02B:UN:E5SE5A'", "BGM+S02:SVK:260+S02-DOCUMENT-001+9+AB'",
    "DTM+137:202610011811:203'", "DTM+735:?+0100:406'", "MKS+23+E04::260'",
    "NAD+MS+91100:SVK:260'", `NAD+MR+${receiver}:SVK:260'`, "NAD+DDQ'",
  ]
  for (const transaction of params.transactions) {
    wire.push(`IDE+24+${transaction.reference}'`)
    if (!['missing-point', 'missing-both'].includes(transaction.defect ?? 'clean')) wire.push(`LOC+172+${transaction.point}::9'`)
    wire.push("LOC+239+TES:SVK:260'", "LIN+++8716867000030:::9'",
      "DTM+324:202610010000202611010000:719'", "DTM+368:202610011810:203'", "DTM+354:1:802'",
      "STS+7++Z01:SVK:260'", "MEA+AAZ++KWH'", "SEQ++1'")
    if (!['missing-quantity', 'missing-both'].includes(transaction.defect ?? 'clean')) wire.push(`QTY+135:${transaction.quantity}'`)
  }
  wire.push(`UNT+${wire.length - 1}+1'`, "UNZ+1+S02NATIVE001'")
  return {
    id: `s02-planning-${params.company}`, company_id: params.company, environment: 'test', direction: 'inbound',
    message_standard: 'edifact', message_family: 'UTILTS', message_code: 'S02', message_version: 'E5SE5A',
    application_reference: '23-DDQ-S02-S', sender_ediel_id: '91100', receiver_ediel_id: receiver,
    raw_payload: wire.join('\n'), parsed_payload: {}, validation_report: {}, execution_context_snapshot: {},
    message_received_at: '2026-10-01T20:00:00Z', created_at: '2026-10-01T20:00:00Z',
    customer_id: null, site_id: null, metering_point_id: null, grid_owner_id: null, grid_owner_data_request_id: null,
  } as unknown as EdielMessageRow
}

export function s02PlanningPair(defect: S02PlanningDefect, ownFirst: boolean): S02PlanningTransaction[] {
  const own = { reference: 'S02-OWN', point: '735999260731000007', quantity: 111, defect }
  const sibling = { reference: 'S02-SIBLING', point: '735999888000001014', quantity: 222 }
  return ownFirst ? [own, sibling] : [sibling, own]
}
