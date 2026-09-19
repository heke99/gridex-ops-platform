import {prodatFieldDiagnostic,prodatLocalDiagnostic,type ProdatDiagnostic} from '@/lib/ediel/prodat/prodatFieldDiagnostic'
import { isProdatReadingField, prodatRegisterReadingMarket, prodatRegisterReadingState, prodatRegisterReadingSubtype } from '@/lib/ediel/prodat/prodatRegisterReadings'
import { canonicalProdat26AFieldRules, prodatRegisterFieldScope } from '@/lib/ediel/prodat/prodat26AFieldMatrix'
import { validateFieldMatrixPayload } from '@/lib/ediel/rulebook/fieldMatrix'
import { parseUna, type EdifactServiceStringAdvice } from '@/lib/ediel/core/una'
import { canonicalProdatSubtypeAlias } from '@/lib/ediel/rulebook/prodatSubtypeRegistry'
import { prodatCharacteristicValue } from '@/lib/ediel/prodat/prodatCharacteristicFields'
import { resolveProdatRegisterRequirement, type ProdatDependentConditionFacts, type ProdatDependentConditionStatus } from '@/lib/ediel/prodat/prodatDependentConditionEngine'
import { prodatRegisterFieldState, prodatRegisterTokens } from '@/lib/ediel/prodat/prodatRegisterFields'
import { prodatRegisterGroups, prodatRegisterMessageSegments } from '@/lib/ediel/prodat/prodatRegisterGroups'
import type { RulebookFieldRule } from '@/lib/ediel/rulebook/fieldMatrix'
import type { EdielRulebookIssue } from '@/lib/ediel/rulebook/rulebook'

const PRODAT_REGISTER_UNDETERMINED_SCOPE_CODES = new Set([
  'PRODAT_REGISTER_EVIDENCE_UNDETERMINED',
  'PRODAT_REGISTER_EXPECTED_OBJECT_MISSING',
  'PRODAT_REGISTER_UNEXPECTED_OBJECT',
])

/** Interpret the canonical register-policy result for rendered diagnostics.
 * This adds no rule authority: it only prevents a pre-wire aggregate from being
 * exported as resolved after exact wire object/agency validation found a gap. */
function isProdatRegisterInventoryScopeUndetermined(
  issues: readonly Pick<EdielRulebookIssue, 'code'>[],
): boolean {
  return issues.some(issue => PRODAT_REGISTER_UNDETERMINED_SCOPE_CODES.has(issue.code))
}

export function reconcileProdatRegisterInventoryStatus(
  aggregateStatus: ProdatDependentConditionStatus,
  issues: readonly Pick<EdielRulebookIssue, 'code'>[],
): ProdatDependentConditionStatus {
  return isProdatRegisterInventoryScopeUndetermined(issues) ? 'undetermined' : aggregateStatus
}

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
  /** Trusted policy context for body fragments; actual UNB takes precedence. */
  applicationReference?: string | null
}): { issues: EdielRulebookIssue[]; handledFields: Set<string>; readings: Map<string, ProdatDependentConditionStatus> } {
  const una = input.una ?? parseUna(null)
  const message = prodatRegisterMessageSegments(input.rawSegments,una)
  const { groups } = prodatRegisterGroups(message,una,input.code)
  const readingsDecisions = new Map<string, ProdatDependentConditionStatus>()
  const handledFields = new Set<string>()
  const issues: EdielRulebookIssue[] = []
  const facts = input.facts ?? {}
  const requireIndependentInventory = (input.requireIndependentInventory ?? true)
    && ['Z04','Z06','Z10'].includes(input.code.toUpperCase())
  const market = requireIndependentInventory
    ? prodatRegisterReadingMarket(prodatRegisterTokens(input.rawSegments, una), una, input.applicationReference) : facts.market
  const add = (field: string, line: number, code: string, description: string, diagnostic?: ProdatDiagnostic) => {
    const rule = input.rules.find(rule => rule.fieldNumber === field)
    if (rule) issues.push({prodatDiagnostic:diagnostic ?? prodatFieldDiagnostic(field,'invalid',input,[], 'PRODAT26A:P47/114–116',line),scope:'prodat_register',severity:'error',blocking:true,code,title:'PRODAT registervillkor',fieldPath:field === '258' ? 'LIN/C829/1082' : rule.segmentPath,
      description:`LIN ${line + 1}, fält ${field}: ${description} (P26.A §2.2 / bilaga2 s.114–116).`})
  }
  if (requireIndependentInventory) {
    const firstLine = message.findIndex(token => token.tag === 'LIN')
    const header = firstLine < 0 ? message : message.slice(0, firstLine)
    for (const field of ['214', '218', '259']) if (prodatRegisterReadingState(field, header, una).present) {
      add(field, -1, 'PRODAT_REGISTER_READING_SCOPE_INVALID', 'Registervärdet måste tillhöra ett eget LIN-register, inte meddelandehuvudet')
    }
  }
  if (facts.registerObjects) {
    const expected = new Set<string>()
    for (const fact of facts.registerObjects) {
      const identity = JSON.stringify([fact.meteringPointId,fact.identityAgency])
      if (expected.has(identity)) issues.push({prodatDiagnostic:prodatLocalDiagnostic('local_evidence','PRODAT26A:register-inventory','Ambiguous local inventory'),scope:'prodat_register',severity:'error',blocking:true,code:'PRODAT_REGISTER_EVIDENCE_UNDETERMINED',title:'Tvetydigt registerunderlag',description:'Objektets faktaunderlag förekommer mer än en gång.',fieldPath:'LIN/C829/1082'})
      expected.add(identity)
      if (!groups.some(group=>group.itemId===fact.meteringPointId && group.identityAgency===fact.identityAgency)) {
        issues.push({prodatDiagnostic:prodatLocalDiagnostic('local_evidence','PRODAT26A:register-inventory','Local inventory object absent'),scope:'prodat_register',severity:'error',blocking:true,code:'PRODAT_REGISTER_EXPECTED_OBJECT_MISSING',title:'Förväntat objekt saknas',description:'Ett objekt i det uttryckliga faktaunderlaget saknas i meddelandet.',fieldPath:'LIN/C212/7140'})
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
    const readings = !requireIndependentInventory && facts.registerObjects === undefined ? facts.meterReadingsSentInUtilts : fact?.meterReadingsSentInUtilts
    const inventoryKey = JSON.stringify([group.itemId, group.identityAgency])
    if (requireIndependentInventory && !reportedInventory.has(inventoryKey)) {
      reportedInventory.add(inventoryKey)
      if (facts.registerObjects !== undefined && objectFacts?.length === 0) {
        add('258',group.lineIndex,'PRODAT_REGISTER_UNEXPECTED_OBJECT','Meddelandet innehåller ett objekt som saknas i det uttryckliga registerunderlaget',prodatLocalDiagnostic('local_evidence','PRODAT26A:register-inventory','Local inventory evidence mismatch'))
        add('258',group.lineIndex,'PRODAT_REGISTER_EVIDENCE_UNDETERMINED','Objektets faktaunderlag saknas; ett annat objekt eller ett rotvärde kan inte fylla det',prodatLocalDiagnostic('local_evidence','PRODAT26A:register-inventory','Local inventory evidence mismatch'))
      } else if (!objectFacts || objectFacts.length !== 1 || !Number.isInteger(fact?.expectedRegisterCount)
        || (fact?.expectedRegisterCount as number) < 1 || (fact?.expectedRegisterCount as number) > 999999) {
        add('258',group.lineIndex,'PRODAT_REGISTER_EVIDENCE_UNDETERMINED','Objektets oberoende registerantal saknas eller är tvetydigt',prodatLocalDiagnostic('local_evidence','PRODAT26A:register-inventory','Local inventory evidence mismatch'))
      } else if (fact!.expectedRegisterCount !== group.registerCount) {
        add('258',group.lineIndex,'PRODAT_REGISTER_COUNT_MISMATCH','Antalet register stämmer inte med det uttryckliga objektunderlaget',prodatLocalDiagnostic('local_evidence','PRODAT26A:register-inventory','Local inventory evidence mismatch'))
      }
    }
    const subtype = first ? requireIndependentInventory
      ? prodatRegisterReadingSubtype(input.code, first.segments, una)
      : canonicalProdatSubtypeAlias(prodatCharacteristicValue('223',first.segments,una),input.code) : null
    for (const rule of input.rules) {
      const field = rule.fieldNumber ?? ''
      const readingField = isProdatReadingField(field)
      const state = requireIndependentInventory && readingField
        ? prodatRegisterReadingState(field, group.segments, una) : prodatRegisterFieldState(field,group.segments,una)
      if (!state) continue
      if (field === '258' && !requireIndependentInventory) {
        handledFields.add(field)
        continue
      }
      const status = resolveProdatRegisterRequirement({messageCode:input.code,fieldNumber:field,subtype,
        registerCount:group.registerCount,registerPosition:group.registerPosition,fieldPresent:state.present,
        firstFieldPresent:first ? Boolean((requireIndependentInventory && readingField ? prodatRegisterReadingState(field, first.segments, una) : prodatRegisterFieldState(field,first.segments,una))?.present) : false,
        meterReadingsSentInUtilts:readings,market,expectedRegisterCount:fact?.expectedRegisterCount,outboundReadings:requireIndependentInventory})
      if (status === null) continue
      handledFields.add(field)
      if (readingField && requireIndependentInventory) {
        const previous = readingsDecisions.get(field)
        const next = status === 'undetermined' ? 'undetermined' : status === 'required' ? 'required' : 'not_required'
        readingsDecisions.set(field, previous === 'undetermined' || next === 'undetermined' ? 'undetermined' : previous === 'required' || next === 'required' ? 'required' : 'not_required')
        if (state.present && state.malformed) add(field, group.lineIndex, 'PRODAT_REGISTER_READING_INVALID', 'Angiven CCI/CAV måste vara ett unikt, korrekt placerat registervärde i källans komponent')
      }
      if (status === 'undetermined') add(field,group.lineIndex,'PRODAT_DEPENDENT_CONDITION_UNDETERMINED','Villkoret kan inte avgöras från objektets källstyrda fakta', prodatLocalDiagnostic('local_unknown','PRODAT26A:register-readings','Receiver-local readings condition unknown'))
      else if (status === 'required' && (!state.value || state.malformed)) add(field,group.lineIndex,rule.errorCodeIfMissing ?? 'PRODAT_DEPENDENT_FIELD_MISSING','Eget giltigt registervärde krävs; inget annat register kan fylla det', prodatFieldDiagnostic(field,state.malformed ? 'invalid' : 'missing',input,[],'PRODAT26A:P47/114–116',group.lineIndex))
      else if (status === 'forbidden' && state.present) add(field,group.lineIndex,rule.errorCodeIfInvalid ?? 'FIELD_MATRIX_FORBIDDEN_FIELD_PRESENT','Fältet får inte anges i denna registerkontext')
      // p116: register tariff codes differ, even when quantities/constants do not.
      if (field === '259' && state.value && !state.malformed && group.registerCount > 1 && first) {
        const seen = tariffs.get(first.lineIndex) ?? new Set<string>()
        if (seen.has(state.value)) add(field,group.lineIndex,'PRODAT_REGISTER_TARIFF_DUPLICATE','Räkneverkskoden upprepas inom samma objekt')
        seen.add(state.value); tariffs.set(first.lineIndex,seen)
      }
    }
  }
  if (isProdatRegisterInventoryScopeUndetermined(issues)) {
    for (const field of readingsDecisions.keys()) readingsDecisions.set(field, 'undetermined')
  }
  return {issues,handledFields,readings:readingsDecisions}
}

/** Existing matrix + condition engine narrowed to register fields. Entry-point
 * adapters use this rather than reimplementing register rules. */
export function validateProdatRegisterPayload(input: {
  code:string; rawSegments:readonly string[]; una?:EdifactServiceStringAdvice;
  facts?:ProdatDependentConditionFacts; requireConditions?:boolean; applicationReference?:string|null;
}): EdielRulebookIssue[] {
  const rules = canonicalProdat26AFieldRules(input.code).filter(rule => prodatRegisterFieldScope(rule.fieldNumber ?? '') === 'local')
  const issues = validateFieldMatrixPayload({family:'PRODAT',code:input.code,rawSegments:input.rawSegments,una:input.una,mode:'parse'},rules)
  if (input.requireConditions) issues.push(...validateProdatRegisterPolicy({...input,rules,requireIndependentInventory:true}).issues)
  return issues
}
