export type EdielErrorLayer = 'syntax' | 'application' | 'functional'

export function mapEdielErrorToAck(input: { layer: EdielErrorLayer; code?: string | null }) {
  if (input.layer === 'syntax') {
    return { ackFamily: 'CONTRL' as const, outcome: 'negative' as const, contrlActionCode: '4' }
  }
  if (input.layer === 'functional') {
    return { ackFamily: 'UTILTS_ERR' as const, outcome: 'negative' as const, utiltsErrCode: input.code ?? 'E14' }
  }
  return { ackFamily: 'APERAK' as const, outcome: 'negative' as const, ercCode: input.code ?? '41' }
}
