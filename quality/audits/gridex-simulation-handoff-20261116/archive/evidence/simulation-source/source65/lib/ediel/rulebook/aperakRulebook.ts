import { CANONICAL_EDIEL_ERRORS } from '@/lib/ediel/rulebook/mapEdielError'

export const APERAK_CANONICAL_RULES = {
  positive: { ercCode: '100', fieldCode: null, text: 'OK' },
  negativeUsesErcFtx: true,
  oneAperakPerSourceProdat: true,
  noAperakOnAperak: true,
  noAperakOnContrl: true,
  waitingQueueNotUsedInSweden: true,
  multiFacilityPartialAckRequired: true,
  canonicalErrors: CANONICAL_EDIEL_ERRORS.filter((error) => error.family === 'APERAK'),
}
