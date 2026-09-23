import {singleMessage, legalParty} from '@/lib/ediel/utilts/receivedStructuralSources'
import {segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {parseProdatMessage, parsedProdatObjects} from '@/lib/ediel/prodat/parser'
import {prodatMarketMinuteToUtc} from '@/lib/ediel/prodat/render/dates'
import type {ProdatRegisterValidationEvidence} from '@/lib/ediel/prodat/prodatRegisterValidationEvidence'

export type SourceObjectScope = Omit<ProdatRegisterValidationEvidence['objects'][number], 'disposition'|'reasons'>

/** Physical binding only: acceptance still requires the fresh canonical facet,
 * actual tenant/party owners, successful business writes and SQL revalidation.
 * Multi-message/delegated-sender/subaddress namespaces stay unavailable here. */
export function readCommittedZ04Wire(raw:string, scope:SourceObjectScope) {
  const ast = singleMessage(raw, 'PRODAT')
  if (!ast || ast.messages[0].messageCode !== 'Z04' || scope.messageIndex !== 0
    || scope.messageReference !== ast.messages[0].messageReference || scope.identityAgency !== '9' || !scope.objectId) return null
  const legalSender = legalParty(ast,'FR','LIN',['160','SVK'])
  const legalReceiver = legalParty(ast,'DO','LIN',['160','SVK'])
  const unb = ast.segments.find(segment => segment.tag === 'UNB')!
  const sender = segmentComposite(unb,2,ast.una), receiver = segmentComposite(unb,3,ast.una)
  // Accepted wire grammar does not establish authority for an unimplemented
  // party subaddress or delegated-sender binding. Do not discard those parts.
  if (!legalSender || !legalReceiver || sender.length !== 2 || receiver.length !== 2
    || !['14','ZZ'].includes(sender[1]) || !['14','ZZ'].includes(receiver[1])
    || sender[0] !== legalSender || !receiver[0] || receiver[0] !== receiver[0].trim()) return null
  const parsed = parseProdatMessage(raw)
  const objects = parsedProdatObjects(parsed).filter(object => object.meteringPointId === scope.objectId && object.identityAgency === scope.identityAgency)
  if (objects.length !== 1 || !objects[0].validRegisterChain || objects[0].registers.length !== scope.registers.length || parsed.timezoneOffset !== '1') return null
  const minute = objects[0].registers[0]?.contractStartDate
  const utc = prodatMarketMinuteToUtc(minute)
  if (!minute || !utc) return null
  return {parties:{legalSender,legalReceiver,transportSender:sender[0],transportReceiver:receiver[0]},
    effectiveFrom:{fieldNumber:'210' as const,marketMinute:minute,utc,committedDatePrecision:'market_calendar_day' as const},
    marketDate:`${minute.slice(0,4)}-${minute.slice(4,6)}-${minute.slice(6,8)}`}
}
