import { randomUUID } from 'node:crypto'
import { ownerSource, OWNER } from '../../__tests__/helpers/sourceOwnerFixtures'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { segmentComposite, segmentSourceSpan, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { prodatRegisterGroups } from '@/lib/ediel/prodat/prodatRegisterGroups'
import { prodatRegisterReadingState } from '@/lib/ediel/prodat/prodatRegisterReadings'
import { prodatCharacteristicValues } from '@/lib/ediel/prodat/prodatCharacteristicFields'

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
  // Explicit synthetic active installation/profiled monthly settlement, before mail or
  // source birth. The source fixture's register111 is not a qualified READ.
  const wire = ownerSource({ readingDeclarations: true, environment: 'test',
    sourceCodes: { installationStatus: 'Z12', settlementMethod: 'Z31' },
  }).raw_payload!.replaceAll(OWNER.external, f.external)
    .replaceAll('12345:160:SVK', `${f.receiver}:160:SVK`).replaceAll('54321:160:SVK', `${f.sender}:160:SVK`)
    .replaceAll('11111:160:SVK', `${f.brpEdielId}:160:SVK`).replaceAll('CUSTOMER-1::89', `${f.customerIdentity.id}:SE2:260`)
    .replaceAll('RFF+Z05:NET-1', `RFF+Z05:${f.gridAreaCode}`).replaceAll('RFF+LI:CASE-1', `RFF+LI:${f.caseReference}`)
    .replaceAll('202610010000', f.requestedStartDate.replaceAll('-', '') + '0000')
  const tokens = tokenizeEdifact(wire), grouped = prodatRegisterGroups(tokens.segments, tokens.una, 'Z04')
  const [own] = grouped.groups
  const reference = own?.segments.find(segment => ['RFF', 'NAD'].includes(segment.tag))
  if (grouped.groups.length !== 1 || grouped.problems.length || own.itemId !== f.external
    || own.identityAgency !== '9' || own.registerPosition !== 1 || reference?.tag !== 'RFF'
    || [['223', 'Z22'], ['306', 'Z12'], ['254', 'Z31']].some(([field, expected]) => {
      const values = prodatCharacteristicValues(field, own.segments, tokens.una)
      return values.length !== 1 || values[0] !== expected
    })
    || [['214', '1'], ['218', '6'], ['259', '111']].some(([field, expected]) => {
      const state = prodatRegisterReadingState(field, own.segments, tokens.una)
      return !state.present || state.malformed || state.value !== expected
    })) {
    throw Error('native_cancellation_ordinary_l_wire_scope_required')
  }
  // Explicit NEW synthetic scenario: RKv1.7 cumulative total active-import
  // electricity, one untimed tariff (all hours/days/months), constant1/digits6.
  // This selects101 before birth; it is not inferred from Z31 or one LIN and
  // supplies no receiver READ, UTILTS receipt or historical applicability.
  const index = own.segments.findIndex(segment => segment.tag === 'CCI'
    && segmentComposite(segment, 2, tokens.una)[0] === 'Z16')
  const descriptor = index < 0 ? undefined : own.segments[index]
  const counter = index < 0 ? undefined : own.segments[index + 1]
  const span = counter ? segmentSourceSpan(counter) : null
  const element = tokens.una.dataElementSeparator, component = tokens.una.componentDataElementSeparator
  if (!counter || !span || descriptor?.raw !== `CCI${element}${element}Z16`
    || counter.raw !== `CAV${element}${component.repeat(3)}111`
    || wire.slice(span.startOffset, span.endOffset) !== counter.raw) {
    throw Error('native_cancellation_ordinary_l_wire_scope_required')
  }
  const prospective = wire.slice(0, span.startOffset) + counter.raw.slice(0, -3) + '101' + wire.slice(span.endOffset)
  const revised = tokenizeEdifact(prospective), revisedGroups = prodatRegisterGroups(revised.segments, revised.una, 'Z04')
  const revisedOwn = revisedGroups.groups[0]
  const reading = revisedOwn && prodatRegisterReadingState('259', revisedOwn.segments, revised.una)
  if (revisedGroups.groups.length !== 1 || revisedGroups.problems.length
    || revisedOwn?.itemId !== own.itemId || revisedOwn.identityAgency !== own.identityAgency
    || revisedOwn.registerPosition !== 1 || !reading?.present || reading.malformed || reading.value !== '101'
    || revised.segments[counter.index]?.raw !== `CAV${element}${component.repeat(3)}101`) {
    throw Error('native_cancellation_ordinary_l_wire_scope_required')
  }
  return envelope(f, prospective, 'Z04')
}
