// reality-defects: J2-B5
// J2-B5 (scenario J2, batch 5d): one quarter-hour meter-month was stored as 2,880 items of ~11 kB each (32 MB), and
// gridex_store_billing_underlay_batch exceeded the 8 s statement timeout (57014) on every monthly run, so the month
// was never billed. Each item repeated its source basis inside the gate snapshot, the supply period's basis and the
// rule pack snapshot. compactUnderlayItemMetadata keeps each once and refers to it; nothing is lost.
import { expect, it } from 'vitest'
import { compactUnderlayItemMetadata } from '@/lib/billing/underlayEngine'

const rulePack = { version: '25-A-4:r4', snapshot: { checksum: 'c'.repeat(64), version: '25-A-4:r4', rulePack: { id: 'rp', family: 'UTILTS', huge: 'x'.repeat(3000) } }, profileKey: 'UTILTS:E66' }
const supply = { contract: 'k', legal: 'y'.repeat(1200) }
const basis = (n: number) => ({ qualified: true, quantityKwh: String(n), sourceMessageId: 'm', normalizedValueId: 'n' + n, sourceRulePackBasis: rulePack })
const item = (n: number) => ({ source_normalized_metering_value_id: 'n' + n, metadata: { source_row_id: 'n' + n, source_basis: basis(n),
  billing_gate_snapshot: { status: 'eligible', normalized_metering_value_id: 'n' + n, source_basis: basis(n), supply_source_basis: supply } } })

it('keeps one copy of each shared basis and every item still names exactly what it referred to', () => {
  const items = Array.from({ length: 2880 }, (_, n) => item(n))
  const before = JSON.stringify(items).length
  const shared = compactUnderlayItemMetadata(items as never)!
  const after = JSON.stringify(items).length + JSON.stringify(shared).length
  expect(after).toBeLessThan(before / 4)
  expect(shared).toEqual({ version: 1, supply_source_basis: supply, rule_pack_bases: { ['c'.repeat(64)]: rulePack } })
  const meta = items[7].metadata as Record<string, any>
  expect(meta.billing_gate_snapshot).toEqual({ status: 'eligible', normalized_metering_value_id: 'n7', source_basis_ref: 'item.source_basis',
    supply_source_basis_ref: 'underlay.payload.item_metadata_shared.supply_source_basis' })
  expect(meta.source_basis).toEqual({ ...basis(7), sourceRulePackBasis: { ref: 'underlay.payload.item_metadata_shared.rule_pack_bases.' + 'c'.repeat(64), checksum: 'c'.repeat(64), version: '25-A-4:r4' } })
})

it('a gate snapshot whose basis differs from the item basis, and differing supply bases, are kept as they are', () => {
  const items = [item(1), item(2)]
  ;(items[0].metadata.billing_gate_snapshot as Record<string, unknown>).source_basis = { other: true }
  ;(items[1].metadata.billing_gate_snapshot as Record<string, unknown>).supply_source_basis = { other: true }
  const shared = compactUnderlayItemMetadata(items as never)
  expect((items[0].metadata.billing_gate_snapshot as Record<string, unknown>).source_basis).toEqual({ other: true })
  expect((items[0].metadata.billing_gate_snapshot as Record<string, unknown>).supply_source_basis).toEqual(supply)
  expect(shared).toEqual({ version: 1, rule_pack_bases: { ['c'.repeat(64)]: rulePack } })
})

it('the source objects are never changed', () => {
  const sourceBasis = basis(1), gate = { status: 'eligible', source_basis: sourceBasis, supply_source_basis: supply }
  const items = [{ metadata: { source_basis: sourceBasis, billing_gate_snapshot: gate } }]
  compactUnderlayItemMetadata(items as never)
  expect(gate.source_basis).toBe(sourceBasis)
  expect(sourceBasis.sourceRulePackBasis).toBe(rulePack)
})
