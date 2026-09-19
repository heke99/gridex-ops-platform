import { canonicalProdat26AFieldRules, prodatRegisterFieldScope } from '@/lib/ediel/prodat/prodat26AFieldMatrix'
import { validateFieldMatrixPayload } from '@/lib/ediel/rulebook/fieldMatrix'
import { parseUna, type EdifactServiceStringAdvice } from '@/lib/ediel/core/una'
import { canonicalProdatSubtypeAlias } from '@/lib/ediel/rulebook/prodatSubtypeRegistry'
import { prodatCharacteristicValue } from '@/lib/ediel/prodat/prodatCharacteristicFields'
import { resolveProdatRegisterRequirement, type ProdatDependentConditionFacts } from '@/lib/ediel/prodat/prodatDependentConditionEngine'
import { prodatRegisterFieldState } from '@/lib/ediel/prodat/prodatRegisterFields'
import { prodatRegisterGroups, prodatRegisterMessageSegments } from '@/lib/ediel/prodat/prodatRegisterGroups'
import type { RulebookFieldRule } from '@/lib/ediel/rulebook/fieldMatrix'
import type { EdielRulebookIssue } from '@/lib/ediel/rulebook/rulebook'

/** Compose register decisions with an already resolved policy, never introduce
 * an independent rule store. Structure/base field checks stay in fieldMatrix. */
export function validateProdatRegisterPolicy(input: {
  code: string
  rawSegments: readonly string[]
  una?: EdifactServiceStringAdvice
  facts?: ProdatDependentConditionFacts
  rules: readonly RulebookFieldRule[]
  /** Outbound business validation requires independent physical inventory.
   * Parse-only inbound validation keeps structural topology checks only. */
  requireIndependentInventory?: boolean
}): { issues: EdielRulebookIssue[]; handledFields: Set<string> } {
  const una = input.una ?? parseUna(null)
  const { groups } = prodatRegisterGroups(prodatRegisterMessageSegments(input.rawSegments,una),una,input.code)
  const handledFields = new Set<string>()
  const issues: EdielRulebookIssue[] = []
  const facts = input.facts ?? {}
  const requireIndependentInventory = (input.requireIndependentInventory ?? true)
    && ['Z04','Z06','Z10'].includes(input.code.toUpperCase())
  const add = (field: string, line: number, code: string, description: string) => {
    const rule = input.rules.find(rule => rule.fieldNumber === field)
    if (rule) issues.push({scope:'prodat_register',severity:'error',blocking:true,code,title:'PRODAT registervillkor',fieldPath:field === '258' ? 'LIN/C829/1082' : rule.segmentPath,
      description:`LIN ${line + 1}, fält ${field}: ${description} (P26.A §2.2 / bilaga2 s.114–116).`})
  }
  if (facts.registerObjects) {
    const expected = new Set<string>()
    for (const fact of facts.registerObjects) {
      const identity = JSON.stringify([fact.meteringPointId,fact.identityAgency])
      if (expected.has(identity)) issues.push({scope:'prodat_register',severity:'error',blocking:true,code:'PRODAT_REGISTER_EVIDENCE_UNDETERMINED',title:'Tvetydigt registerunderlag',description:'Objektets faktaunderlag förekommer mer än en gång.',fieldPath:'LIN/C829/1082'})
      expected.add(identity)
      if (!groups.some(group=>group.itemId===fact.meteringPointId && group.identityAgency===fact.identityAgency)) {
        issues.push({scope:'prodat_register',severity:'error',blocking:true,code:'PRODAT_REGISTER_EXPECTED_OBJECT_MISSING',title:'Förväntat objekt saknas',description:'Ett objekt i det uttryckliga faktaunderlaget saknas i meddelandet.',fieldPath:'LIN/C212/7140'})
      }
    }
  }
  const tariffs = new Map<number, Set<string>>()
  const reportedInventory = new Set<string>()
  for (const group of groups) {
    const first = group.firstLineIndex === null ? null : groups.find(row => row.lineIndex === group.firstLineIndex)
    const objectFacts = facts.registerObjects?.filter(row => row.meteringPointId === group.itemId && row.identityAgency === group.identityAgency)
    const fact = objectFacts?.length === 1 ? objectFacts[0] : null
    // An explicit object inventory has exact scope; no fallback from A to B.
    const readings = facts.registerObjects === undefined ? facts.meterReadingsSentInUtilts : fact?.meterReadingsSentInUtilts
    const inventoryKey = JSON.stringify([group.itemId, group.identityAgency])
    if (requireIndependentInventory && !reportedInventory.has(inventoryKey)) {
      reportedInventory.add(inventoryKey)
      if (facts.registerObjects !== undefined && objectFacts?.length === 0) {
        add('258',group.lineIndex,'PRODAT_REGISTER_UNEXPECTED_OBJECT','Meddelandet innehåller ett objekt som saknas i det uttryckliga registerunderlaget')
        add('258',group.lineIndex,'PRODAT_REGISTER_EVIDENCE_UNDETERMINED','Objektets faktaunderlag saknas; ett annat objekt eller ett rotvärde kan inte fylla det')
      } else if (!objectFacts || objectFacts.length !== 1 || !Number.isInteger(fact?.expectedRegisterCount)
        || (fact?.expectedRegisterCount as number) < 1 || (fact?.expectedRegisterCount as number) > 999999) {
        add('258',group.lineIndex,'PRODAT_REGISTER_EVIDENCE_UNDETERMINED','Objektets oberoende registerantal saknas eller är tvetydigt')
      } else if (fact!.expectedRegisterCount !== group.registerCount) {
        add('258',group.lineIndex,'PRODAT_REGISTER_COUNT_MISMATCH','Antalet register stämmer inte med det uttryckliga objektunderlaget')
      }
    }
    const subtype = first ? canonicalProdatSubtypeAlias(prodatCharacteristicValue('223',first.segments,una),input.code) : null
    for (const rule of input.rules) {
      const field = rule.fieldNumber ?? ''
      const state = prodatRegisterFieldState(field,group.segments,una)
      if (!state) continue
      if (field === '258' && !requireIndependentInventory) {
        handledFields.add(field)
        continue
      }
      const status = resolveProdatRegisterRequirement({messageCode:input.code,fieldNumber:field,subtype,
        registerCount:group.registerCount,registerPosition:group.registerPosition,fieldPresent:state.present,
        firstFieldPresent:first ? Boolean(prodatRegisterFieldState(field,first.segments,una)?.present) : false,
        meterReadingsSentInUtilts:readings,market:facts.market,expectedRegisterCount:fact?.expectedRegisterCount})
      if (status === null) continue
      handledFields.add(field)
      if (status === 'undetermined') add(field,group.lineIndex,'PRODAT_DEPENDENT_CONDITION_UNDETERMINED','Villkoret kan inte avgöras från objektets källstyrda fakta')
      else if (status === 'required' && (!state.value || state.malformed)) add(field,group.lineIndex,rule.errorCodeIfMissing ?? 'PRODAT_DEPENDENT_FIELD_MISSING','Eget giltigt registervärde krävs; inget annat register kan fylla det')
      else if (status === 'forbidden' && state.present) add(field,group.lineIndex,rule.errorCodeIfInvalid ?? 'FIELD_MATRIX_FORBIDDEN_FIELD_PRESENT','Fältet får inte anges i denna registerkontext')
      // p116: register tariff codes differ, even when quantities/constants do not.
      if (field === '259' && state.value && !state.malformed && group.registerCount > 1 && first) {
        const seen = tariffs.get(first.lineIndex) ?? new Set<string>()
        if (seen.has(state.value)) add(field,group.lineIndex,'PRODAT_REGISTER_TARIFF_DUPLICATE','Räkneverkskoden upprepas inom samma objekt')
        seen.add(state.value); tariffs.set(first.lineIndex,seen)
      }
    }
  }
  return {issues,handledFields}
}

/** Existing matrix + condition engine narrowed to register fields. Entry-point
 * adapters use this rather than reimplementing register rules. */
export function validateProdatRegisterPayload(input: {
  code:string; rawSegments:readonly string[]; una?:EdifactServiceStringAdvice;
  facts?:ProdatDependentConditionFacts; requireConditions?:boolean;
}): EdielRulebookIssue[] {
  const rules = canonicalProdat26AFieldRules(input.code).filter(rule => prodatRegisterFieldScope(rule.fieldNumber ?? '') === 'local')
  const issues = validateFieldMatrixPayload({family:'PRODAT',code:input.code,rawSegments:input.rawSegments,una:input.una,mode:'parse'},rules)
  if (input.requireConditions) issues.push(...validateProdatRegisterPolicy({...input,rules,requireIndependentInventory:true}).issues)
  return issues
}
