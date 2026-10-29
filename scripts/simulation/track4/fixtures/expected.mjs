// Independent expected-invoice computation for the T4 fixture contract.
//
// Commercial terms (fixed, hand-chosen so that one VAT amount is an exact half-öre tie):
//   energy:      fixed price 84.75 öre/kWh (= 0.8475 SEK/kWh), 100 % fixed base component
//   monthly fee: 49.50 SEK ex VAT per invoice month, not prorated (no explicit proration flag in the snapshot)
//   VAT:         25 %
//
// Rounding rule actually found in the product code (base 1c0c088):
//   lib/pricing/basePriceCalculator.ts   roundMoney(v) = Math.round(v * 100) / 100        (energy line, ex VAT)
//   lib/pricing/pricePreviewBuilder.ts   line VAT = roundMoney(line.amountExVat * vatRate)   (energy line)
//   lib/pricing/priceComponentCalculator.ts  fee ex VAT = roundMoney(amount), fee VAT = roundMoney(exVat * vatRate)
//   totals: totalExVat = roundMoney(sum line ex), vat = roundMoney(sum line VAT), inc = roundMoney(ex + vat)
// i.e. VAT is rounded PER LINE and summed (not VAT on the total).
//
// ORACLE CANDIDATE, NOT AN ORACLE: nothing in the repo says half-öre ties must round up, or that VAT must be
// per line. This module therefore computes three variants and the scenario steps assert the product against
// the exact-decimal per-line variant and RECORD the others as findings when they differ:
//   exact_per_line  exact decimal arithmetic, ties away from zero (half-up), VAT per line   <- asserted
//   js_float        the product's own floating point formula (Math.round(v*100)/100)
//   exact_on_total  exact decimal, VAT computed once on the rounded ex-VAT total
// Money is represented as integer öre (BigInt) in the exact variants.

export const FIXTURE_TERMS = {
  priceArea: 'SE3',
  fixedOrePerKwh: '84.75',
  monthlyFeeSek: '49.50',
  vatRate: '0.25',
  contractStart: '2026-01-01',
}

/** kWh per billing month used by the fixture (one underlay per month; see fixtures/seed.mjs). */
export const FIXTURE_MONTHS = {
  main: { month: '2026-09', kwh: '437.215' },          // MAIN04/05 chain
  concurrentPrepare: { month: '2026-08', kwh: '120.500' }, // BILLNEG01.01
  concurrentApprove: { month: '2026-07', kwh: '310.000' }, // BILLNEG01.02
}

/** Parse a decimal string into {int: BigInt, scale: number}. */
function dec(text) {
  const [i, f = ''] = String(text).split('.')
  return { int: BigInt(i + f), scale: f.length }
}

/** round-half-up of numerator/denominator for non-negative values */
function divRoundHalfUp(n, d) {
  return (2n * n + d) / (2n * d)
}

function pow10(n) { return 10n ** BigInt(n) }

/** exact: kwh * (ore/100) in SEK, rounded half-up to öre, as integer öre */
function energyOre(kwh, orePerKwh) {
  const k = dec(kwh), p = dec(orePerKwh)
  // SEK = k * p / 100  ->  öre = k * p  (since 1 SEK = 100 öre and price is in öre): öre amount = k.int*p.int / 10^(k.scale+p.scale)
  return divRoundHalfUp(k.int * p.int, pow10(k.scale + p.scale))
}

function sekToOre(sek) {
  const d = dec(sek)
  return divRoundHalfUp(d.int * 100n, pow10(d.scale))
}

function vatOre(exOre, rate) {
  const r = dec(rate)
  return divRoundHalfUp(exOre * r.int, pow10(r.scale))
}

const fmt = (ore) => `${ore / 100n}.${String(ore % 100n).padStart(2, '0')}`

export function computeExpected({ kwh, terms = FIXTURE_TERMS }) {
  // ---- exact_per_line
  const energyEx = energyOre(kwh, terms.fixedOrePerKwh)
  const feeEx = sekToOre(terms.monthlyFeeSek)
  const energyVat = vatOre(energyEx, terms.vatRate)
  const feeVat = vatOre(feeEx, terms.vatRate)
  const exactPerLine = {
    energy_ex_vat: fmt(energyEx), energy_vat: fmt(energyVat),
    fee_ex_vat: fmt(feeEx), fee_vat: fmt(feeVat),
    total_ex_vat: fmt(energyEx + feeEx), total_vat: fmt(energyVat + feeVat), total_inc_vat: fmt(energyEx + feeEx + energyVat + feeVat),
  }
  // ---- exact_on_total
  const totalEx = energyEx + feeEx
  const totalVatOnTotal = vatOre(totalEx, terms.vatRate)
  const exactOnTotal = { total_ex_vat: fmt(totalEx), total_vat: fmt(totalVatOnTotal), total_inc_vat: fmt(totalEx + totalVatOnTotal) }
  // ---- js_float (the product's formulas)
  const roundMoney = (v) => Math.round(v * 100) / 100
  const price = Number(terms.fixedOrePerKwh) / 100
  const rate = Number(terms.vatRate)
  const fEnergyEx = roundMoney(Number(kwh) * (price * (100 / 100)))
  const fEnergyVat = roundMoney(fEnergyEx * rate)
  const fFeeEx = roundMoney(Number(terms.monthlyFeeSek) * 1)
  const fFeeVat = roundMoney(fFeeEx * rate)
  const fTotalEx = roundMoney(fEnergyEx + fFeeEx)
  const fTotalVat = roundMoney(fEnergyVat + fFeeVat)
  const jsFloat = {
    energy_ex_vat: fEnergyEx.toFixed(2), energy_vat: fEnergyVat.toFixed(2), fee_ex_vat: fFeeEx.toFixed(2), fee_vat: fFeeVat.toFixed(2),
    total_ex_vat: fTotalEx.toFixed(2), total_vat: fTotalVat.toFixed(2), total_inc_vat: roundMoney(fTotalEx + fTotalVat).toFixed(2),
  }
  const same = (a, b) => ['total_ex_vat', 'total_vat', 'total_inc_vat'].every((k) => a[k] === b[k])
  return {
    kwh,
    rule: 'per-line VAT, half-up to öre (exact_per_line is asserted; see header for the other variants)',
    exact_per_line: exactPerLine,
    js_float: jsFloat,
    exact_on_total: exactOnTotal,
    variants_agree: { exact_vs_float: same(exactPerLine, jsFloat), per_line_vs_on_total: same(exactPerLine, exactOnTotal) },
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const [key, m] of Object.entries(FIXTURE_MONTHS)) console.log(key, m.month, JSON.stringify(computeExpected({ kwh: m.kwh }), null, 1))
}
