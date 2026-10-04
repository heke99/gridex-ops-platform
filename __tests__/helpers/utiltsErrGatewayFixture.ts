import { energyHandoffMessage, observationHandoffMessage } from './utiltsObservationHandoff'
import type { EdielMessageRow } from '@/lib/ediel/types'

export type UtiltsAckFixtureTransaction = {
  reference: string
  outcome: 'accepted' | 'guide_rejected' | 'processability_rejected'
}

/** Synthetic physical source bytes only, never historical issuer evidence.
 * October's functional fault is a two-quarter period with one observation
 * (E87); September uses the existing E19 register-observation fixture. */
export function utiltsErrGatewayFixture(params: {
  company: string
  transactions: UtiltsAckFixtureTransaction[]
  date?: '2026-09-30' | '2026-10-01'
  receiver?: string
}): EdielMessageRow {
  const date = params.date ?? '2026-10-01'
  const base = date === '2026-09-30'
    ? observationHandoffMessage(date, params.company)
    : energyHandoffMessage(date, params.company)
  const lines = base.raw_payload!.split('\n')
  const start = lines.findIndex(line => line.startsWith('IDE+'))
  const end = lines.findIndex(line => line.startsWith('UNT+'))
  const template = lines.slice(start, end)
  const receiver = params.receiver ?? '21660'
  const wire = lines.slice(0, start).map(line => line.replaceAll('21660', receiver)
    // This prospective harness is a physical test interchange: request at
    // UNB0031 and test indicator UNB0035 are separate service elements.
    .replace(/^(UNB\+.*)\+\+1'$/, "$1++1++1'"))
  for (const transaction of params.transactions) {
    wire.push(...template.map(line => {
      let own = line.replaceAll('GRIDEX2607E66001', transaction.reference)
      if (transaction.outcome === 'guide_rejected') {
        own = own.replace('735999260731000007::9', '735999260731000007::260')
      }
      if (date === '2026-10-01' && transaction.outcome === 'processability_rejected') {
        own = own.replace('202607010000202607010015:719', '202607010000202607010030:719')
          .replace('DTM+597:202607010020:203', 'DTM+597:202607010040:203')
      }
      return own
    }))
  }
  wire.push(`UNT+${wire.length - 1}+1'`, lines[lines.length - 1])
  return {
    ...base,
    raw_payload: wire.join('\n'),
    sender_ediel_id: '91100',
    receiver_ediel_id: receiver,
  }
}
