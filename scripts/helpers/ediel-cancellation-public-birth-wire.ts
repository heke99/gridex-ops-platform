import { randomUUID } from 'node:crypto'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { ownerSource, OWNER } from '../../__tests__/helpers/sourceOwnerFixtures'
import { closureFixture, CLOSURE_OBJECT } from '../../__tests__/helpers/closureWireFixtures'
import type { NormalSwitchStageNativeFixture } from './ediel-normal-switch-native-fixture'

/** Reuse only the retained #627 pure wire construction. No parsed facts,
 * profile INSERT, original grant or cancellation authority is transferred. */
export function cancellationPublicBirthWire(f: NormalSwitchStageNativeFixture, code: 'Z04' | 'Z05', li: string, endMinute: string) {
  const source = code === 'Z04'
    ? ownerSource().raw_payload!.replaceAll(OWNER.external, f.external)
      .replaceAll('RFF+LI:CASE-1', `RFF+LI:${li}`)
      .replaceAll('202610010000', f.requestedStartDate.replaceAll('-', '') + '0000')
      .replaceAll('CAV+Z22', 'CAV+Z24')
    : closureFixture({ reason: 'Z24', minute: endMinute, li }).wire.replaceAll(CLOSURE_OBJECT, f.external)
  const wire = source.replaceAll('12345:160:SVK', `${f.receiver}:160:SVK`)
    .replaceAll('54321:160:SVK', `${f.sender}:160:SVK`)
    .replaceAll('11111:160:SVK', `${f.brpEdielId}:160:SVK`)
    .replaceAll('CUSTOMER-1::89', `${f.customerIdentity.id}:${f.customerIdentity.qualifier}:${f.customerIdentity.agency}`)
    .replaceAll('RFF+Z05:NET-1', `RFF+Z05:${f.gridAreaCode}`)
  const body = tokenizeEdifact(wire).segments.filter(segment => !['UNA', 'UNB', 'UNH', 'UNT', 'UNZ'].includes(segment.tag))
    .map(segment => segment.tag === 'BGM' ? `BGM+${code}+${randomUUID().replaceAll('-', '').slice(0, 20)}+9+AB` : segment.raw)
  return EdifactEnvelopeCodec.encode({ sender: f.receiver, receiver: f.sender, senderQualifier: '14', receiverQualifier: '14',
    applicationReference: '23-DDQ-PRODAT', acknowledgementRequest: true, environment: 'test',
    interchangeReference: randomUUID().replaceAll('-', '').slice(0, 14),
    messages: [{ messageReference: randomUUID().replaceAll('-', '').slice(0, 14),
      messageTypeToken: 'PRODAT:D:97A:UN:E2SE6A', businessSegments: body }] })
}
