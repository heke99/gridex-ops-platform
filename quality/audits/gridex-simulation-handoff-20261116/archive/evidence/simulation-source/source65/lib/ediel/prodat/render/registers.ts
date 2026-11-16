import { escapeEdifactValue } from '@/lib/ediel/core/edifactSerializer'
import { segmentComposite } from '@/lib/ediel/core/edifactTokenizer'
import { parseUna } from '@/lib/ediel/core/una'
import { PRODAT_26A_FIELD_MATRIX, PRODAT_26A_MESSAGE_CODES } from '@/lib/ediel/prodat/prodat26AFieldMatrix'
import { normalizeProdatRegisters, type ProdatMeterRegister, type ProdatMeterRegisterInput } from '@/lib/ediel/prodat/prodatRegisterInput'
import { prodatPositiveSequence, prodatRegisterLocalSegments, prodatRegisterTokens } from '@/lib/ediel/prodat/prodatRegisterFields'

function measurements(row: ProdatMeterRegister): string[] {
  const segments: string[] = []
  if (row.annualConsumption != null) segments.push(`QTY+31:${escapeEdifactValue(row.annualConsumption)}${row.annualConsumptionUnit ? ':'+escapeEdifactValue(row.annualConsumptionUnit) : ''}`)
  for (const [field,key] of [['214','meterConstant'],['218','meterDigitCount'],['259','meterTimeFrame']] as const) {
    const value = row[key]
    if (value == null) continue
    const descriptor = PRODAT_26A_FIELD_MATRIX.find(row => row.fieldNumber === field)!
    segments.push(descriptor.segmentPath.slice(0,-'/CAV'.length), `CAV+${':'.repeat(descriptor.cavComponent!)}${escapeEdifactValue(value)}`)
  }
  return segments
}

/** Expand exactly one object. Common SG8 fields occur only on register 1.
 * Callers composing several objects carry nextLineSequence into the next call.
 * This is serialization, not a second requirement/conditional rules engine. */
export function renderProdatRegisterObject(input: {
  code: string
  segments: readonly string[]
  registers?: readonly ProdatMeterRegisterInput[]
  firstLineSequence?: number
}): { segments: string[]; nextLineSequence: number; registerCount: number } {
  const una = parseUna(null)
  const tokens = prodatRegisterTokens(input.segments,una)
  const lines = tokens.filter(token => token.tag === 'LIN')
  if (lines.length !== 1) throw new Error('prodat_register_renderer_requires_one_object')
  const sourceLine = lines[0]
  const lineIndex = tokens.indexOf(sourceLine)
  const identity = segmentComposite(sourceLine,3,una)
  const registers = input.registers === undefined ? null : normalizeProdatRegisters(input.registers)
  const count = registers?.length ?? 1
  const start = input.firstLineSequence ?? 1
  if (!Number.isInteger(start) || start < 1 || start + count - 1 > 999999) throw new Error('prodat_register_line_sequence_invalid')
  const indexDescriptor = PRODAT_26A_FIELD_MATRIX.find(row => row.fieldNumber === '258')!
  if (count > 1 && indexDescriptor.requirements[PRODAT_26A_MESSAGE_CODES.findIndex(code => code === input.code)] !== 'D') throw new Error('prodat_register_function_not_allowed')
  if (count > 1 && (!identity[0] || !['9','89'].includes(identity[3]))) throw new Error('prodat_register_object_identity_required')
  const explicitIndex = registers?.some(row => row.registerIndex !== undefined) ?? false
  for (const [index,row] of (registers ?? []).entries()) {
    if ((count === 1 && row.registerIndex !== undefined) || (explicitIndex && (!prodatPositiveSequence(row.registerIndex ?? null) || Number(row.registerIndex) !== index + 1))) throw new Error('prodat_register_index_invalid')
  }
  const local = prodatRegisterLocalSegments(tokens,una)
  const common = tokens.slice(lineIndex+1).filter(token => registers === null || !local.has(token)).map(token => token.raw)
  const output = tokens.slice(0,lineIndex).map(token => token.raw)
  const location = identity.some(Boolean) ? `++${identity.map(value => escapeEdifactValue(value)).join(':')}` : ''
  for (let index = 0; index < count; index++) {
    const row = registers?.[index]
    const subline = count > 1 ? `+1:${escapeEdifactValue(explicitIndex ? row!.registerIndex! : String(index + 1))}` : ''
    output.push(`LIN+${start+index}${location}${subline}`)
    const own = row ? measurements(row) : []
    if (index === 0) {
      const cut = common.findIndex(raw => !raw.startsWith('DTM+') && !raw.startsWith('FTX+'))
      const at = cut < 0 ? common.length : cut
      output.push(...common.slice(0,at),...own,...common.slice(at))
    } else output.push(...own)
  }
  return {segments:output,nextLineSequence:start+count,registerCount:count}
}
