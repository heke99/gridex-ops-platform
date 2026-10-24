import { segmentComposite, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'

/** Current source, not the historical 2013 workbook or the guide's PIA example.
 * Tidsserieprodukter!row21 / OT!row85 / LOD o BAP!rows10,58. The fixture
 * represents synthetic eSett -> BRP, not an actual market/issuer approval. */
export const S01_L359_FIXTURE_SOURCE = Object.freeze({
  document: 'TSP20260928.xls', locator: 'https://www.ediel.se/Portal/Document/2702',
  sha256: '53034f2fd3de416a84f755b454fc72378930126446909cee5eae968111db816b',
  product: 'L359', row: 21, guideSha256: 'b76a61b9aa6f136771e5db4948296d1b632b8d775314eb6c93783595ae419db2',
})

export type S01L359FixtureTransaction = Readonly<{
  transactionId: string
  latestUpdateDate: string
  quantity: string
  gridAreaId?: string
}>

/** Reuse only the fixture's envelope/explicit parties. Reconstruct the whole
 * transaction; replacing BGM on E66 would retain forbidden point/TN/type fields.
 * Native reception must still qualify the synthetic issuer/transport witness
 * and the BRP recipient. No caller-supplied accepted rows or series are seeded. */
export function s01L359AggregateWire(envelope: string, transactions: readonly S01L359FixtureTransaction[]): string {
  if (!envelope.startsWith("UNA:+.? '")) throw Error('s01_fixture_standard_una_required')
  if (!transactions.length || new Set(transactions.map(t => t.transactionId)).size !== transactions.length) throw Error('s01_fixture_transaction_membership')
  const wire = tokenizeEdifact(envelope)
  const one = (tag: string, qualifier?: string) => {
    const found = wire.segments.filter(s => s.tag === tag && (qualifier === undefined || segmentComposite(s, 1, wire.una)[0] === qualifier))
    if (found.length !== 1) throw Error(`s01_fixture_envelope_${tag}_${qualifier ?? ''}`)
    return found[0]
  }
  const unb = one('UNB').raw.split('+'), unh = one('UNH'), bgm = one('BGM')
  unb[7] = '23-DDK-S01-S'
  const parts = [unb.join('+'), unh.raw, `BGM+S01:SVK:260+${segmentComposite(bgm, 2, wire.una)[0]}+9+AB`,
    one('DTM', '137').raw, 'DTM+735:?+0100:406', 'MKS+23+E03::260', one('NAD', 'MS').raw, one('NAD', 'MR').raw, 'NAD+DDK']
  for (const t of transactions) {
    if (!/^[A-Za-z0-9_-]{1,35}$/.test(t.transactionId) || !/^\d{12}$/.test(t.latestUpdateDate)
      || !/^-?\d+(?:\.\d+)?$/.test(t.quantity) || !/^[A-Z0-9]{1,3}$/.test(t.gridAreaId ?? 'TES')) throw Error('s01_fixture_transaction_invalid')
    parts.push(`IDE+24+${t.transactionId}`, `LOC+239+${t.gridAreaId ?? 'TES'}:SVK:260`, 'LIN+++8716867000030:::9',
      'PIA+1+Z04:PC:SVK:260+U46:PT:SVK:260+Z02:OT:SVK:260+Z58:LOD:SVK:260+Z05:BAP:SVK:260',
      'DTM+324:202606010000202607010000:719', `DTM+368:${t.latestUpdateDate}:203`, 'DTM+354:1:802',
      'STS+7++E43::260', 'MEA+AAZ++KWH', 'CCI+++E02::260', 'CAV+E01::260', 'SEQ++1', `QTY+136:${t.quantity}`)
  }
  parts.push(`UNT+${parts.length}+${segmentComposite(unh, 1, wire.una)[0]}`, one('UNZ').raw)
  return ["UNA:+.? '", ...parts.map(part => part + "'")].join('\n')
}
