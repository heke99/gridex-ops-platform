import { describe, expect, it } from 'vitest'
import { observeUtiltsFieldScopes, readUtiltsFieldOccurrences } from '@/lib/ediel/utilts/fieldMatrixOccurrences'
import { getUtiltsFieldRules } from '@/lib/ediel/rulebook/utiltsFieldMatrix'

function row(code: string, semanticKey: string) {
  const found = getUtiltsFieldRules(code).find(rule => rule.semanticKey === semanticKey)
  if (!found) throw new Error('test_source_row_missing')
  return found
}
const wire = (body: string) => "UNA:+.? 'UNB+UNOC:3+S+R+261023:1200+I++++23-DDK-S01-S'UNH+1+UTILTS:D:02B:UN:E5SE5A'BGM+S01:SVK:260+DOC+9+AB'" + body + "UNT+1+1'UNZ+1+I'"

describe('UTILTS source field physical occurrence projection', () => {
  it('uses only its own CCI/CAV characteristic and the observation direct-reference slot', () => {
    const scopes = observeUtiltsFieldScopes(wire("IDE+24+OWN'CCI+++E12::260'CAV+E17::260'CCI+++E02::260'CAV+E14::260'SEQ++1'RFF+AES:OWN'QTY+220:1'RFF+AES:LATE'SEQ++2'QTY+220:2'RFF+AES:SIBLING'"))
    const transaction = scopes.transactions[0]
    expect(readUtiltsFieldOccurrences(row('E66', 'metering_point_type'), transaction, scopes.una)).toMatchObject([{ value: 'E17' }])
    expect(readUtiltsFieldOccurrences(row('E66', 'register_id'), transaction.observations[0], scopes.una)).toMatchObject([{ value: 'OWN' }])
    expect(readUtiltsFieldOccurrences(row('E66', 'register_id'), transaction.observations[1], scopes.una)).toEqual([])
  })

  it('does not borrow a transaction field from an IDE sibling even with reused identity', () => {
    const scopes = observeUtiltsFieldScopes(wire("IDE+24+SAME'LOC+172+FIRST::9'IDE+24+SAME'LOC+175+OTHER::9'"))
    const first = readUtiltsFieldOccurrences(row('S01', 'metering_point_id'), scopes.transactions[0], scopes.una)
    const second = readUtiltsFieldOccurrences(row('S01', 'metering_point_id'), scopes.transactions[1], scopes.una)
    expect(first).toMatchObject([{ value: 'FIRST', transactionIndex: 0, referenceNumber: 'SAME' }])
    expect(second).toEqual([])
  })

  it('does not let observation597 satisfy transaction512 or another SEQ530a', () => {
    const scopes = observeUtiltsFieldScopes(wire("IDE+24+OWN'SEQ++1'QTY+220:0'DTM+597:202610010000:203'SEQ++2'QTY+220:12'"))
    const transaction = scopes.transactions[0]
    expect(readUtiltsFieldOccurrences(row('E66', 'registration_date'), transaction, scopes.una)).toEqual([])
    expect(readUtiltsFieldOccurrences(row('E66', 'meter_reading_date'), transaction.observations[0], scopes.una)).toMatchObject([{ value: '202610010000', observationIndex: 0 }])
    expect(readUtiltsFieldOccurrences(row('E66', 'meter_reading_date'), transaction.observations[1], scopes.una)).toEqual([])
  })

  it('ties STS520 and DTM530 to their own preceding quantity window', () => {
    const scopes = observeUtiltsFieldScopes(wire("IDE+24+OWN'SEQ++1'QTY+220:0'STS+8+56'DTM+597:202610010000:203'QTY+136:25'STS+8+21'QTY+42:3'DTM+597:202610010015:203'"))
    const scope = scopes.transactions[0].observations[0]
    expect(readUtiltsFieldOccurrences(row('E66', 'meter_reading_quality'), scope, scopes.una)).toMatchObject([{ value: '56' }])
    expect(readUtiltsFieldOccurrences(row('E66', 'quantity_quality'), scope, scopes.una)).toMatchObject([{ value: '21' }])
    expect(readUtiltsFieldOccurrences(row('E66', 'maximum_power_timestamp'), scope, scopes.una)).toMatchObject([{ value: '202610010015' }])
  })

  it('retains an empty supplied forbidden field and distinguishes zero and NULL', () => {
    const scopes = observeUtiltsFieldScopes(wire("IDE+24+OWN'LOC+172+::9'SEQ++1'QTY+220:NULL'QTY+136:0'"))
    expect(readUtiltsFieldOccurrences(row('S01', 'metering_point_id'), scopes.transactions[0], scopes.una)).toMatchObject([{ value: '', supplied: true }])
    expect(readUtiltsFieldOccurrences(row('E66', 'meter_reading'), scopes.transactions[0].observations[0], scopes.una)).toMatchObject([{ value: 'NULL' }])
    expect(readUtiltsFieldOccurrences(row('E66', 'periodic_quantity'), scopes.transactions[0].observations[0], scopes.una)).toMatchObject([{ value: '0' }])
  })

  it('honors alternate UNA and escaped component/data separators', () => {
    const scopes = observeUtiltsFieldScopes('UNA*;.! ~UNB;UNOC*3;S;R;261023*1200;I;;;;REF~UNH;1;UTILTS*D*02B*UN*E5SE5A~BGM;S01*SVK*260;D;9;AB~IDE;24;OWN~LOC;172;A!*B!;C**9~UNT;1;1~UNZ;1;I~')
    expect(readUtiltsFieldOccurrences(row('S01', 'metering_point_id'), scopes.transactions[0], scopes.una)).toMatchObject([{ value: 'A*B;C' }])
  })

  it('reads the own NAD party rather than UNB sender and its own header rather than a later message', () => {
    const scopes = observeUtiltsFieldScopes(wire("NAD+MS+12345:SVK:260'IDE+24+ONE'NAD+MS+99999:SVK:260'") + "UNB+UNOC:3+Z+R+261023:1200+J++++OTHER'UNH+2+UTILTS:D:02B:UN:E5SE5A'BGM+S01:SVK:260+DOC2+9+AB'NAD+MS+54321:SVK:260'IDE+24+TWO'UNT+1+2'UNZ+1+J'")
    expect(readUtiltsFieldOccurrences(row('S01', 'sender_ediel_id'), scopes.headers[0], scopes.una)).toMatchObject([{ value: '12345', messageIndex: 0 }])
    expect(readUtiltsFieldOccurrences(row('S01', 'sender_ediel_id'), scopes.headers[1], scopes.una)).toMatchObject([{ value: '54321', messageIndex: 1 }])
  })
})

