import {tokenizeEdifact, segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {prodatRegisterGroups} from '@/lib/ediel/prodat/prodatRegisterGroups'
import type {ProdatRegisterValidationEvidence} from '@/lib/ediel/prodat/prodatRegisterValidationEvidence'
import {isEvidenceRecord} from '@/lib/ediel/utilts/durableSourceDiscovery'

function keys(value: unknown, expected: string[]): value is Record<string, unknown> {
  return isEvidenceRecord(value) && Object.keys(value).length === expected.length && expected.every(key=>Object.hasOwn(value,key))
}
function text(value: unknown): value is string {
  return typeof value === 'string' && /^[^\x00-\x1f\x7f]{1,128}$/.test(value) && value === value.trim()
}
const nullableText = (value:unknown) => value === null || text(value)
const integer = (value:unknown, min:number) => Number.isSafeInteger(value) && (value as number) >= min && (value as number) < 8192

/** Bind the fresh canonical register projection to every original physical LIN.
 * This validates serialization and scope only. It never recomputes a rule
 * decision or upgrades a register facet into source/business/party approval.
 */
export function bindReceivedRegisterValidation(value: unknown, raw: string): ProdatRegisterValidationEvidence | null {
  if (!keys(value,['version','owner','coverage','objects']) || value.version !== 1 || value.owner !== 'validateProdatRegisterPolicy'
    || value.coverage !== 'canonical_register_only' || !Array.isArray(value.objects) || value.objects.length > 8192) return null
  try {
    const tokens=tokenizeEdifact(raw)
    if (tokens.segments.length > 8192) return null
    const groups=prodatRegisterGroups(tokens.segments,tokens.una).groups
    const expected=new Map<string,typeof groups>()
    const references=new Map<number,string|null>()
    let messageIndex=-1
    for (const token of tokens.segments) if (token.tag==='UNH') references.set(++messageIndex,segmentComposite(token,1,tokens.una)[0] || null)
    for (const group of groups) {
      const key=JSON.stringify([group.messageIndex,group.itemId,group.identityAgency,group.itemId ? null : group.lineIndex])
      expected.set(key,[...(expected.get(key) ?? []),group])
    }
    if (expected.size !== value.objects.length) return null
    const seen=new Set<string>()
    for (const object of value.objects) {
      if (!keys(object,['messageIndex','messageReference','objectId','identityAgency','disposition','registers','reasons'])
        || !integer(object.messageIndex,-1) || !nullableText(object.messageReference) || !nullableText(object.objectId) || !nullableText(object.identityAgency)
        || !['accepted','rejected','unavailable'].includes(String(object.disposition))
        || !Array.isArray(object.registers) || !object.registers.length || object.registers.length>8192
        || !Array.isArray(object.reasons) || object.reasons.length>128
        || !object.reasons.every(reason=>typeof reason==='string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(reason))
        || new Set(object.reasons).size!==object.reasons.length) return null
      if (object.disposition==='accepted' ? object.reasons.length!==0 : object.reasons.length===0) return null
      if ((object.messageIndex!==0 || !text(object.messageReference) || !text(object.objectId) || !['9','89'].includes(String(object.identityAgency)))
        && object.disposition!=='unavailable') return null
      const first=object.registers[0]
      if (!isEvidenceRecord(first)) return null
      const key=JSON.stringify([object.messageIndex,object.objectId,object.identityAgency,object.objectId ? null : first.lineIndex])
      const physical=expected.get(key)
      if (!physical || seen.has(key) || physical.length!==object.registers.length || object.messageReference!==(references.get(object.messageIndex as number) ?? null)) return null
      seen.add(key)
      for (const [index, register] of object.registers.entries()) {
        if (!keys(register,['lineIndex','lineNumber','registerIndex','registerPosition','segmentIndex'])
          || !integer(register.lineIndex,0) || !integer(register.segmentIndex,0) || !integer(register.registerPosition,1)
          || !nullableText(register.lineNumber) || !nullableText(register.registerIndex)) return null
        const actual=physical[index]
        if (register.lineIndex!==actual.lineIndex || register.lineNumber!==actual.lineNumber || register.registerIndex!==actual.registerIndex
          || register.registerPosition!==actual.registerPosition || register.segmentIndex!==actual.segments[0].index) return null
      }
    }
    // Fresh detached serialization prevents later mutation of owner output.
    return JSON.parse(JSON.stringify(value)) as ProdatRegisterValidationEvidence
  } catch { return null }
}
