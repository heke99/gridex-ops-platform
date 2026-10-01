/** Logical decimal quantities are strings; binary floating point is diagnostic. */
export function canonicalUtiltsDecimal(value: string, decimalMark = '.'): string {
  const mark = decimalMark === ',' ? ',' : decimalMark === '.' ? '.' : null
  if (!mark || !new RegExp(`^-?[0-9]+(?:\\${mark}[0-9]+)?$`).test(value)) throw new Error('utilts_decimal_invalid')
  const negative = value.startsWith('-')
  const [integer, fraction = ''] = (negative ? value.slice(1) : value).split(mark)
  const whole = integer.replace(/^0+(?=\d)/, '')
  const part = fraction.replace(/0+$/, '')
  const canonical = whole + (part ? `.${part}` : '')
  return negative && canonical !== '0' ? `-${canonical}` : canonical
}

export function isCanonicalUtiltsDecimal(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try { return canonicalUtiltsDecimal(value) === value } catch { return false }
}

export function sumUtiltsDecimals(values: readonly string[]): string {
  let scale = 0
  let total = BigInt(0)
  for (const value of values) {
    if (!isCanonicalUtiltsDecimal(value)) throw new Error('utilts_decimal_invalid')
    const [integer, fraction = ''] = value.split('.')
    if (fraction.length > scale) { total *= BigInt(10) ** BigInt(fraction.length - scale); scale = fraction.length }
    const negative = integer.startsWith('-')
    const absolute = (negative ? integer.slice(1) : integer) + fraction.padEnd(scale, '0')
    total += BigInt(absolute) * (negative ? -BigInt(1) : BigInt(1))
  }
  const negative = total < BigInt(0)
  const digits = (negative ? -total : total).toString().padStart(scale + 1, '0')
  return canonicalUtiltsDecimal((negative ? '-' : '') + (scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits))
}

/** Retained V1 already contains a binary approximation. Preserve that number's
 * JSON decimal value for legacy totals; it is not a reconstructed original. */
export function retainedV1NumberDecimal(value: number): string {
  if (!Number.isFinite(value)) throw new Error('utilts_decimal_invalid')
  const spelling = String(value)
  if (!/[eE]/.test(spelling)) return canonicalUtiltsDecimal(spelling)
  const [mantissa, exponent] = spelling.toLowerCase().split('e')
  const negative = mantissa.startsWith('-')
  const [whole, fraction=''] = (negative ? mantissa.slice(1) : mantissa).split('.')
  const digits = whole + fraction
  const position = whole.length + parseInt(exponent,10)
  const decimal = position <= 0 ? `0.${'0'.repeat(-position)}${digits}`
    : position >= digits.length ? digits + '0'.repeat(position-digits.length) : `${digits.slice(0,position)}.${digits.slice(position)}`
  return canonicalUtiltsDecimal((negative ? '-' : '')+decimal)
}

/** Source-supported active-energy units, with exact powers of ten only. */
export function utiltsEnergyQuantityKwh(quantity:string,unit:string):string | null {
  const places=unit==='KWH' ? 0 : unit==='MWH' ? 3 : unit==='GWH' ? 6 : null
  if(places===null) return null
  if(!isCanonicalUtiltsDecimal(quantity)) throw new Error('utilts_decimal_invalid')
  const negative=quantity.startsWith('-')
  const [whole,fraction='']=(negative ? quantity.slice(1) : quantity).split('.')
  const digits=whole+fraction.padEnd(places,'0')
  const position=whole.length+places
  return canonicalUtiltsDecimal((negative ? '-' : '')+(position>=digits.length ? digits : `${digits.slice(0,position)}.${digits.slice(position)}`))
}
