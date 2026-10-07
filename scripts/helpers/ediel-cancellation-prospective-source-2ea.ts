import { randomUUID } from 'node:crypto'
import { ownerSource, OWNER } from '../../__tests__/helpers/sourceOwnerFixtures'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { prodatRegisterGroups } from '@/lib/ediel/prodat/prodatRegisterGroups'
import { prodatRegisterReadingState } from '@/lib/ediel/prodat/prodatRegisterReadings'

/** Synthetic wire context only, not a DB row, READ or business capability. */
export type CancellationProspectiveContext = {
  external: string; receiver: string; sender: string; brpEdielId: string
  customerIdentity: { id: string }; gridAreaCode: string; caseReference: string
  requestedStartDate: string
}

function envelope(f: CancellationProspectiveContext, source: string, code: 'Z04' | 'Z05') {
  const body = tokenizeEdifact(source).segments.filter(segment => !['UNA', 'UNB', 'UNH', 'UNT', 'UNZ'].includes(segment.tag))
    .map(segment => segment.tag === 'BGM' ? `BGM+${code}+${randomUUID().replaceAll('-', '').slice(0,20)}+9+AB` : segment.raw)
  return EdifactEnvelopeCodec.encode({ sender: f.receiver, receiver: f.sender, senderQualifier: '14', receiverQualifier: '14',
    applicationReference: '23-DDQ-PRODAT', acknowledgementRequest: true, environment: 'test',
    interchangeReference: randomUUID().replaceAll('-', '').slice(0,14), messages: [{ messageReference: randomUUID().replaceAll('-', '').slice(0,14),
      messageTypeToken: 'PRODAT:D:97A:UN:E2SE6A', businessSegments: body }] })
}
export function buildCancellationProspectiveZ04(f: CancellationProspectiveContext) {
  const wire = ownerSource().raw_payload!.replaceAll(OWNER.external, f.external)
    .replaceAll('12345:160:SVK', `${f.receiver}:160:SVK`).replaceAll('54321:160:SVK', `${f.sender}:160:SVK`)
    .replaceAll('11111:160:SVK', `${f.brpEdielId}:160:SVK`).replaceAll('CUSTOMER-1::89', `${f.customerIdentity.id}:SE2:260`)
    .replaceAll('RFF+Z05:NET-1', `RFF+Z05:${f.gridAreaCode}`).replaceAll('RFF+LI:CASE-1', `RFF+LI:${f.caseReference}`)
    .replaceAll('202610010000', f.requestedStartDate.replaceAll('-', '') + '0000')
  // Prospective ordinary L counterpart input, before mail/source birth. Physical
  // declarations do not supply receiver inventory or a qualified READ receipt.
  const tokens = tokenizeEdifact(wire), grouped = prodatRegisterGroups(tokens.segments, tokens.una, 'Z04')
  const [own] = grouped.groups
  const reference = own?.segments.find(segment => ['RFF', 'NAD'].includes(segment.tag))
  if (grouped.groups.length !== 1 || grouped.problems.length || own.itemId !== f.external
    || own.identityAgency !== '9' || reference?.tag !== 'RFF'
    || ['214', '218', '259'].some(field => prodatRegisterReadingState(field, own.segments, tokens.una).present)) {
    throw Error('native_cancellation_ordinary_l_wire_scope_required')
  }
  const declarations = ['CCI++Z02', 'CAV+:::1', 'CCI++Z05', 'CAV+:::6', 'CCI++Z16', 'CAV+:::111']
  const completed = wire.slice(0, 9) + tokens.segments.flatMap(segment => segment === reference
    ? [...declarations, segment.raw] : [segment.raw]).join(tokens.una.segmentTerminator) + tokens.una.segmentTerminator
  return envelope(f, completed, 'Z04')
}
