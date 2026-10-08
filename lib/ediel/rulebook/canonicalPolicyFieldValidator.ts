import {redeemReceivedZ02EndUserAddressContext,type ReceivedZ02EndUserAddressContext} from '@/lib/ediel/prodat/receivedZ02EndUserAddressContext'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {validateReceivedZ14ReportingContext,type ReceivedZ14ReportingContext} from '@/lib/ediel/prodat/receivedZ14ReportingContext'
import {projectProdatSourceFunctionObjects,type ReceivedProdatSourceFunctionValidation} from '@/lib/ediel/prodat/prodatSourceFunctionValidation'
import {prodatDateState} from '@/lib/ediel/prodat/prodatDateFields'
import {evidenceHash} from '@/lib/ediel/utilts/durableSourceDiscovery'
import {prodatEndUserWireSubtype} from './prodatEndUserPolicy'
import {evaluateProdatTransactionReason} from '@/lib/ediel/prodat/prodatTransactionReason'
import type {DeathStatusValidationContext} from '@/lib/ediel/prodat/prodatDeathStatusAuthority'
import {projectProdatApplicationObjects,type ProdatApplicationObjectValidation} from '@/lib/ediel/prodat/prodatApplicationObjectValidation'
import {validateCanonicalAckGuide} from './ackGuidePolicy'
import {validateEdifactHeaderGuide} from './edifactHeaderGuide'
import {utiltsDecimalGuideViolations} from '@/lib/ediel/utilts/quantityPrecision'
import {segmentComposite,segmentElementCount,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {DEFAULT_UNA,serializeUna} from '@/lib/ediel/core/una'
import {prodatRegisterGroups} from '@/lib/ediel/prodat/prodatRegisterGroups'
import {projectProdatRegisterValidation, type ProdatRegisterValidationEvidence} from '@/lib/ediel/prodat/prodatRegisterValidationEvidence'
import { prodatFreeTextField, validateProdatFreeText } from '@/lib/ediel/prodat/prodatFreeText'
import {evaluateIncomingSelectedProdatAck} from '@/lib/ediel/prodat/prodatIncomingSelectedAck'
import {evaluateIncomingProdatPermissionAckFields} from '@/lib/ediel/prodat/prodatPermissionAckFields'
import {evaluateIncomingProdatEnergyProduct,incomingProduct242IsFalse} from '@/lib/ediel/prodat/prodatEnergyProduct'
import {prodatFieldDiagnostic,prodatLocalDiagnostic} from '@/lib/ediel/prodat/prodatFieldDiagnostic'
import {isGasApplicabilityField} from '@/lib/ediel/prodat/prodatGasApplicability'
import {validateProdatGasApplicability} from './prodatGasApplicabilityPolicy'
import {evaluateProdatDeathStatus,type ProdatDeathObjectCondition} from './prodatDeathStatusPolicy'
import {isMeterChangeField} from '@/lib/ediel/prodat/prodatMeterChangeFacts'
import {validateProdatMeterChange} from './prodatMeterChangePolicy'
import {isReportingPermissionField,type ExpectedContext} from '@/lib/ediel/prodat/prodatReportingPermissionContext'
import {validateProdatReportingPermission} from './prodatReportingPermissionPolicy'
import {isProdatDateEventField} from '@/lib/ediel/prodat/prodatDateEvents'
import {validateProdatDateEvents} from './prodatDateEventPolicy'
import {validateProdatInvoicee} from './prodatInvoiceePolicy'
import {INVOICEE_FIELDS} from '@/lib/ediel/prodat/prodatInvoicee'
import {validateProdatEndUserAddress} from './prodatEndUserAddressPolicy'
import {END_USER_ADDRESS_CODES} from '@/lib/ediel/prodat/prodatEndUserAddress'
import { isZ14DependentField } from '@/lib/ediel/rulebook/prodatZ14Policy'
import { isSourceBoundOptionalInstallationField, validateProdatOptionalInstallationPolicy } from '@/lib/ediel/rulebook/prodatOptionalInstallationPolicy'
import { isSourceBoundEndUserField, isProdatFieldInInapplicableParent } from '@/lib/ediel/prodat/prodatParentApplicability'
import { prodatSourceSubtypeRule } from '@/lib/ediel/prodat/prodatSubtypeRequirement'
import { validateProdatSubtypePolicy } from '@/lib/ediel/rulebook/prodatSubtypePolicy'
import { canonicalProdat26AFieldRules, prodatRegisterFieldScope } from '@/lib/ediel/prodat/prodat26AFieldMatrix'
import { validateProdatRegisterPolicy } from '@/lib/ediel/rulebook/prodatRegisterPolicy'
import type { EdifactServiceStringAdvice } from '@/lib/ediel/core/una'
import type { CanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import {
  fieldRulePresent,
  recordIgnoredProdatField,
  validateFieldMatrixPayload,
  type FieldMatrixEvaluationInput,
  type RulebookFieldRule,
  type ProdatIgnoredField,
} from '@/lib/ediel/rulebook/fieldMatrix'
import type { EdielRulebookIssue } from '@/lib/ediel/rulebook/rulebook'

function asRulebookFieldRule(value: unknown): RulebookFieldRule {
  return value as RulebookFieldRule
}

/** Physical R210 observation can precede an unavailable A business ground.
 * It supplies neither that ground nor any response or business capability. */
export function observeReceivedZ04RequiredStart(input:{rawSegments:readonly string[];una?:EdifactServiceStringAdvice}):EdielRulebookIssue[] {
 const una=input.una??DEFAULT_UNA,groups=prodatRegisterGroups(input.rawSegments,una,'Z04').groups
 const rule=canonicalProdat26AFieldRules('Z04').find(rule=>rule.fieldNumber==='210')
 if(rule?.requirement!=='required')return []
 return groups.filter(group=>group.messageIndex===0&&group.validRegisterChain&&group.registerPosition===1
  &&prodatEndUserWireSubtype('Z04',group.segments,una)==='A'&&!prodatDateState('210',group.segments,una).present).map(group=>({
   code:'FIELD_MATRIX_REQUIRED_FIELD_MISSING',severity:'error',blocking:true,title:'Obligatoriskt PRODAT-fält saknas',
   description:'Eget fält 210 DTM+92 saknas enligt P26.A §2.2.',fieldPath:rule.segmentPath,
   prodatDiagnostic:prodatFieldDiagnostic('210','missing',{code:'Z04',rawSegments:input.rawSegments,una},group.segments.map(row=>row.raw),
    'PRODAT26A:§2.2:Z04:210',group.lineIndex,'object'),
  }))
}

/** Actual structural-only register invocation. No operational policy, local
 * inventory, APP or source-function projection is selected or manufactured. */
export function validateReceivedZ04RequiredStartStructure(input:{rawSegments:readonly string[];una?:EdifactServiceStringAdvice}) {
 const una=input.una??DEFAULT_UNA,rules=canonicalProdat26AFieldRules('Z04').filter(rule=>prodatRegisterFieldScope(rule.fieldNumber??'')==='local')
 const base=validateFieldMatrixPayload({family:'PRODAT',code:'Z04',direction:'inbound',mode:'parse',rawSegments:input.rawSegments,una},rules)
 const register=validateProdatRegisterPolicy({code:'Z04',direction:'inbound',rawSegments:input.rawSegments,una,rules,requireIndependentInventory:false})
 const evidence=projectProdatRegisterValidation({code:'Z04',rawSegments:input.rawSegments,una,registerIssues:register.issues,fieldIssues:base,
  handledFields:register.handledFields,completeRuleSelection:canonicalProdat26AFieldRules('Z04')
   .filter(rule=>prodatRegisterFieldScope(rule.fieldNumber??'')==='local').every(expected=>rules.some(rule=>rule.fieldNumber===expected.fieldNumber))})
 requiredStartStructures.set(evidence,{wire:requiredStartStructureWire(input.rawSegments,una),facts:evidenceHash(JSON.stringify(evidence)),at:Date.now()})
 return {evidence,issues:[...base,...register.issues]}
}
const requiredStartStructures=new WeakMap<object,{wire:string;facts:string;at:number}>()
const requiredStartStructureWire=(segments:readonly string[],una:EdifactServiceStringAdvice)=>evidenceHash(JSON.stringify([segments,serializeUna(una)]))
/** Only the actual fresh structural invocation can hand off its own result.
 * Register JSON, mutation, copies and repeat redemptions provide no proof. */
export function consumeReceivedZ04RequiredStartStructure(evidence:unknown,raw:string):boolean {
 if(!evidence||typeof evidence!=='object')return false
 const actual=requiredStartStructures.get(evidence);requiredStartStructures.delete(evidence)
 const wire=tokenizeEdifact(raw)
 return Boolean(actual&&actual.wire===requiredStartStructureWire(wire.segments.map(row=>row.raw),wire.una)
  &&actual.facts===evidenceHash(JSON.stringify(evidence))&&Date.now()>=actual.at&&Date.now()-actual.at<=2000)
}

/** Original availability decides received229 presence; reply values may change.
 * Only the exact readonly source capability can supply that condition. */
function receivedZ02AddressIssues(input: {
 policy:CanonicalEdielPolicy;sourceMessage?:EdielMessageRow;receivedZ02EndUserAddressContext?:ReceivedZ02EndUserAddressContext;
 rawPayload?:string|null;rawSegments?:readonly string[]|null;una?:EdifactServiceStringAdvice
}):EdielRulebookIssue[]{
 if(!input.receivedZ02EndUserAddressContext)return []
 const sourceRule='PRODAT26A:Z02/229:received-original-availability'
 const unqualified=(reason:string):EdielRulebookIssue[]=>[{severity:'error',blocking:true,
  code:'PRODAT_RECEIVED_Z02_END_USER_ADDRESS_SCOPE_UNQUALIFIED',title:'Adressunderlag saknar eget källbevis',description:reason,
  fieldPath:'NAD+UD/C059/3042[1..3]',prodatDiagnostic:prodatLocalDiagnostic('local_unknown',sourceRule,reason)}]
 try{
  const message=input.sourceMessage
  if(!message?.raw_payload||input.rawPayload!==message.raw_payload)throw Error('received_z02_address_actual_payload_required')
  const wire=tokenizeEdifact(message.raw_payload)
  if(JSON.stringify(input.rawSegments)!==JSON.stringify(wire.segments.map(segment=>segment.raw))
   ||serializeUna(input.una??wire.una)!==serializeUna(wire.una))throw Error('received_z02_address_actual_wire_required')
  const facts=redeemReceivedZ02EndUserAddressContext({message,context:input.receivedZ02EndUserAddressContext,policy:input.policy})
  const groups=prodatRegisterGroups(wire.segments,wire.una,'Z02').groups.filter(group=>group.registerPosition===1)
  if(groups.length!==facts.length)throw Error('received_z02_address_whole_object_scope_required')
  const issues:EdielRulebookIssue[]=[]
  for(const group of groups){
   const fact=facts.find(candidate=>candidate.meteringPointId===group.itemId&&candidate.identityAgency===group.identityAgency)
   if(!fact)throw Error('received_z02_address_own_object_required')
   const parties=group.segments.filter(segment=>segment.tag==='NAD'&&segmentComposite(segment,1,wire.una)[0]==='UD')
   // The mandatory UD parent is independently owned by the existing R policy.
   if(parties.length!==1)continue
   const address=segmentComposite(parties[0],5,wire.una)
   const missing=!address.some(value=>value.trim())
   const invalid=segmentElementCount(parties[0],wire.una)>9||address.length>3
    ||address.some(value=>value.length>35||/[\x00-\x1f\x7f]/.test(value))
    ||!address[0]?.trim()&&address.slice(1).some(value=>value.trim())
    ||address[0]?.trim()==='.'&&!address.slice(1).some(value=>value.trim())
   if(invalid||missing&&fact.availability==='available')issues.push({severity:'error',blocking:true,
    code:invalid?'PRODAT_RECEIVED_Z02_END_USER_ADDRESS_FORMAT_INVALID':'PRODAT_RECEIVED_Z02_END_USER_ADDRESS_MISSING',
    title:invalid?'Elanvändaradress har ogiltigt format':'Tillgänglig elanvändaradress saknas',
    description:invalid?'Z02:229 kräver högst tre 35-teckens komponenter och första adressfältet enligt P26.A s.118.':'Z02:229 saknas trots adress i det korrelerade, accepterat sända egna Z01-originalet.',
    fieldPath:'NAD+UD/C059/3042[1..3]',prodatDiagnostic:prodatFieldDiagnostic('229',invalid?'invalid':'missing',
     {code:'Z02',rawSegments:input.rawSegments,una:wire.una},group.segments.map(segment=>segment.raw),sourceRule,group.lineIndex)})
  }
  return issues
 }catch(error){return unqualified(error instanceof Error?error.message:String(error))}
}

/**
 * Field validation consumes a previously resolved canonical policy snapshot.
 * The legacy field-matrix dependency fallback is deliberately disabled by
 * running the structural/base validation in parse mode; PRODAT D cardinality is
 * then decided by source-bound wire rules for migrated cells and the existing
 * policy conditions for cells not yet migrated. Register overlays stay separate.
 */
export function validateCanonicalPolicyFields(input: {
  onIgnoredField?: (field: ProdatIgnoredField) => void
  onRegisterValidation?: (evidence: ProdatRegisterValidationEvidence) => void
  sourceFunctionContext?:DeathStatusValidationContext
  sourceMessage?:EdielMessageRow
  receivedZ02EndUserAddressContext?:ReceivedZ02EndUserAddressContext
  onSourceFunctionObjects?:(evidence:ReceivedProdatSourceFunctionValidation)=>void
  onApplicationObjects?: (evidence: ProdatApplicationObjectValidation) => void
  reportingContext?: ExpectedContext
  receivedReportingContext?:ReceivedZ14ReportingContext
  policy: CanonicalEdielPolicy
  rawSegments?: readonly string[] | null
  rawPayload?: string | null
  scope?: 'all' | 'dependent_only'
  una?: EdifactServiceStringAdvice
}): EdielRulebookIssue[] {
  if (input.policy.family === 'APERAK' || input.policy.family === 'CONTRL' || input.policy.family === 'UTILTS_ERR') return validateCanonicalAckGuide(input)
  let sourceFunctionConditions:ProdatDeathObjectCondition[]=[]
  const rules = input.policy.fieldRules.map(asRulebookFieldRule).filter(rule => !(input.policy.family === 'PRODAT' && input.policy.direction === 'inbound' && (['322','324','506'].includes(rule.fieldNumber ?? '') || rule.fieldNumber === '242' && incomingProduct242IsFalse(input.policy.code)))).flatMap((rule): RulebookFieldRule[] => {
    if (input.policy.code === 'Z14' && input.policy.direction === 'outbound' && isZ14DependentField(rule.fieldNumber ?? '')) return [rule]
    // The new UD parent is selected per wire object below, never from a root snapshot.
    if (['Z06', 'Z09'].includes(input.policy.code) && (rule.fieldNumber === '229' || isSourceBoundEndUserField(input.policy.code, rule.fieldNumber ?? ''))) return [rule]
    if (input.policy.direction === 'inbound') return [rule]
    if (input.policy.family !== 'PRODAT' || !isProdatFieldInInapplicableParent({
      messageCode: input.policy.code, subtype: input.policy.subtype, fieldNumber: rule.fieldNumber,
    })) return [rule]
    // Inbound extra information is ignored (§2.2); outbound must not carry it.
    return input.policy.direction === 'outbound' ? [{ ...rule, requirement: 'forbidden' }] : []
  })
  let observedApplicationReference=input.policy.applicationReference
  if(input.policy.family==='PRODAT'){
    const una=input.una??DEFAULT_UNA
    const wire=tokenizeEdifact(input.rawPayload??serializeUna(una)+(input.rawSegments??[]).join(una.segmentTerminator)+una.segmentTerminator)
    const headers=wire.segments.filter(segment=>segment.tag==='UNB')
    // A pre-envelope builder still uses its resolved route. Once UNB exists,
    // field311 must observe the physical source, including an absent value;
    // the policy's expected reference cannot manufacture a wire observation.
    if(headers.length)observedApplicationReference=headers.length===1?(segmentComposite(headers[0],7,wire.una)[0]||null):null
  }
  const matrixInput: FieldMatrixEvaluationInput = {
    una: input.una,
    direction: input.policy.direction as 'inbound' | 'outbound',
    onIgnoredField: input.onIgnoredField,
    family: input.policy.family,
    code: input.policy.code,
    rawSegments: input.rawSegments ?? null,
    applicationReference: input.policy.applicationReference,
    expectedApplicationReference: input.policy.applicationReference,
    // Do not let the legacy `send => dependent required` fallback execute.
    mode: 'parse',
  }

  const baseRules = input.policy.family === 'PRODAT' ? rules.filter(rule => {
    const field = rule.fieldNumber ?? ''
    // The physical national223 owner also runs before subtype policy resolves.
    if(field==='223')return false
    // FTX301/303 have no national rejection mapping. Outbound uses the local
    // construction guard below; incoming gray/unused text remains raw evidence.
    if (prodatFreeTextField(field)) return false
    if(isGasApplicabilityField(input.policy.code,field))return false
    if(field==='310'&&['Z05','Z06','Z09'].includes(input.policy.code))return false
    if(isMeterChangeField(input.policy.code,field))return false
    if(isReportingPermissionField(input.policy.code,field)||isProdatDateEventField(input.policy.code,field))return false
    if ((input.policy.code === 'Z14' && isZ14DependentField(field)) || isSourceBoundEndUserField(input.policy.code, field)) {
      return input.policy.direction === 'inbound'
    }
    return !prodatSourceSubtypeRule(input.policy.code, field)
  }) : rules
  // Physical field311 observations belong to its selected base rule. Other
  // consumers use the already selected process/guide reference, including
  // partial field validations that do not own the interchange header.
  const baseInput = baseRules.some(rule => rule.fieldNumber === '311')
    ? {...matrixInput, applicationReference: observedApplicationReference}
    : matrixInput
  const issues = input.scope === 'dependent_only'
    ? input.policy.family === 'PRODAT'
      ? validateFieldMatrixPayload(baseInput, baseRules.filter(rule => prodatRegisterFieldScope(rule.fieldNumber ?? '') === 'local'))
      : []
    : validateFieldMatrixPayload(baseInput, baseRules)
  if (input.scope !== 'dependent_only') issues.push(...validateEdifactHeaderGuide({
    direction: input.policy.direction as 'inbound' | 'outbound', rawPayload: input.rawPayload, rawSegments: input.rawSegments, una: input.una,
  }))
  if(input.policy.family==='UTILTS' && input.scope!=='dependent_only' && input.rawSegments?.length) {
    const una=input.una ?? DEFAULT_UNA
    const wire=tokenizeEdifact(serializeUna(una)+input.rawSegments.join(una.segmentTerminator)+una.segmentTerminator)
    issues.push(...utiltsDecimalGuideViolations(wire.segments,wire.una).map(violation=>({severity:'error' as const,code:violation.code,title:'Felaktigt numeriskt fält',description:violation.description,fieldPath:violation.field,blocking:true})))
  }
  if (input.policy.family !== 'PRODAT') return issues
  if(input.scope!=='dependent_only'&&rules.some(rule=>rule.fieldNumber==='223'))issues.push(...evaluateProdatTransactionReason({...matrixInput,rawSegments:input.rawSegments??[]}).issues)
  if (input.policy.direction === 'outbound') issues.push(...validateProdatFreeText({ code: input.policy.code, rawSegments: input.rawSegments ?? [], una: input.una }))
  if (input.policy.direction === 'inbound') {
    const energy = evaluateIncomingProdatEnergyProduct({...matrixInput,rawSegments:input.rawSegments??[]})
    issues.push(...energy.issues)
    for (const object of energy.objects) if (object.applicability === 'false') {
      recordIgnoredProdatField(matrixInput, '506', [], 'object', object.lineIndex)
    }
    if (incomingProduct242IsFalse(input.policy.code)) {
      for (const group of prodatRegisterGroups(input.rawSegments ?? [],input.una,input.policy.code).groups) {
        recordIgnoredProdatField(matrixInput, '242', [], 'object', group.lineIndex)
      }
    }
    issues.push(...evaluateIncomingSelectedProdatAck({...matrixInput,rawSegments:input.rawSegments??[],facts:input.policy.prodatDependentFacts,selectedFields:input.policy.fieldRules.map(asRulebookFieldRule).map(rule=>rule.fieldNumber??'')}).issues)
    const permissionFields=input.policy.fieldRules.map(asRulebookFieldRule).map(rule=>rule.fieldNumber??'').filter(field=>['322','324'].includes(field))
    if(permissionFields.length)issues.push(...evaluateIncomingProdatPermissionAckFields({...matrixInput,rawSegments:input.rawSegments??[],selectedFields:permissionFields}).issues)
  }
  issues.push(...validateProdatSubtypePolicy(matrixInput, input.policy.direction === 'inbound'
    ? rules.filter(rule => !isReportingPermissionField(input.policy.code,rule.fieldNumber??'') && !isProdatDateEventField(input.policy.code,rule.fieldNumber??'') && !(input.policy.code === 'Z14' && (isZ14DependentField(rule.fieldNumber ?? '') || ['321','323'].includes(rule.fieldNumber ?? ''))) && !isSourceBoundEndUserField(input.policy.code, rule.fieldNumber ?? '')) : rules.filter(rule=>!isReportingPermissionField(input.policy.code,rule.fieldNumber??'') && !isProdatDateEventField(input.policy.code,rule.fieldNumber??'')), input.policy.direction))
  if (input.policy.direction === 'outbound') issues.push(...validateProdatOptionalInstallationPolicy(matrixInput, rules))
  const register = validateProdatRegisterPolicy({
    code:input.policy.code,
    rawSegments:input.rawSegments ?? [],
    una:input.una,
    facts:input.policy.prodatDependentFacts,
    rules,
    direction:input.policy.direction as 'inbound'|'outbound',
    onIgnoredField:input.onIgnoredField,
    requireIndependentInventory:input.policy.direction === 'outbound',
    applicationReference:input.policy.applicationReference,
  })
  const registerEvidence=projectProdatRegisterValidation({
    code: input.policy.code, rawSegments: input.rawSegments ?? [], una: input.una,
    registerIssues: register.issues, fieldIssues: issues, handledFields: register.handledFields,
    completeRuleSelection: input.scope !== 'dependent_only' && canonicalProdat26AFieldRules(input.policy.code)
      .filter(rule => prodatRegisterFieldScope(rule.fieldNumber ?? '') === 'local')
      .every(expected => rules.some(rule => rule.fieldNumber === expected.fieldNumber)),
  })
  input.onRegisterValidation?.(registerEvidence)
  issues.push(...register.issues)
  issues.push(...receivedZ02AddressIssues(input))
  if(input.policy.direction==='outbound' && rules.some(rule=>rule.fieldNumber==='229')) issues.push(...validateProdatEndUserAddress({code:input.policy.code,rawSegments:input.rawSegments??[],una:input.una,facts:input.policy.prodatDependentFacts}))

  if(rules.some(rule=>INVOICEE_FIELDS.includes(rule.fieldNumber??''))) issues.push(...validateProdatInvoicee({code:input.policy.code,rawSegments:input.rawSegments??[],una:input.una,facts:input.policy.prodatDependentFacts,direction:input.policy.direction as 'inbound'|'outbound'}))

  if(rules.some(rule=>isProdatDateEventField(input.policy.code,rule.fieldNumber??'')))issues.push(...validateProdatDateEvents({code:input.policy.code,rawSegments:input.rawSegments??[],una:input.una,facts:input.policy.prodatDependentFacts,direction:input.policy.direction as 'inbound'|'outbound'}))

  if((input.policy.direction!=='inbound'||input.policy.code==='Z13')&&rules.some(rule=>isReportingPermissionField(input.policy.code,rule.fieldNumber??'')))issues.push(...validateProdatReportingPermission({code:input.policy.code,rawSegments:input.rawSegments??[],una:input.una,facts:input.policy.prodatDependentFacts,direction:input.policy.direction as 'inbound'|'outbound',reportingContext:input.reportingContext}))

  if(input.policy.direction!=='inbound'&&rules.some(rule=>isMeterChangeField(input.policy.code,rule.fieldNumber??'')))issues.push(...validateProdatMeterChange({code:input.policy.code,rawSegments:input.rawSegments??[],una:input.una,facts:input.policy.prodatDependentFacts,direction:input.policy.direction as 'inbound'|'outbound',applicationReference:input.policy.applicationReference}))

  if((input.policy.direction!=='inbound'||input.policy.prodatDependentFacts?.deathStatus)&&rules.some(rule=>rule.fieldNumber==='310')){
    const result=evaluateProdatDeathStatus({code:input.policy.code,rawSegments:input.rawSegments??[],una:input.una,facts:input.policy.prodatDependentFacts,direction:input.policy.direction as 'inbound'|'outbound'})
    issues.push(...result.issues);sourceFunctionConditions=result.objectConditions
  }

  if(input.policy.direction!=='inbound'&&rules.some(rule=>isGasApplicabilityField(input.policy.code,rule.fieldNumber??'')))issues.push(...validateProdatGasApplicability({code:input.policy.code,rawSegments:input.rawSegments??[],una:input.una,facts:input.policy.prodatDependentFacts,direction:input.policy.direction as 'inbound'|'outbound',applicationReference:input.policy.applicationReference,fields:rules.map(rule=>rule.fieldNumber??'')}))

  const dependentByField = new Map(
    input.policy.prodatDependentConditions.map((condition) => [condition.fieldNumber, condition] as const),
  )

  for (const rule of rules.filter((candidate) => candidate.requirement === 'dependent')) {
    const fieldNumber = String(rule.fieldNumber ?? '').trim()
    if(isGasApplicabilityField(input.policy.code,fieldNumber))continue
    if(fieldNumber==='310')continue
    if(isMeterChangeField(input.policy.code,fieldNumber))continue
    if(isReportingPermissionField(input.policy.code,fieldNumber)||isProdatDateEventField(input.policy.code,fieldNumber))continue
    if(INVOICEE_FIELDS.includes(fieldNumber)) continue
    if(fieldNumber==='229' && END_USER_ADDRESS_CODES.includes(input.policy.code)) continue
    if (input.policy.code === 'Z14' && input.policy.direction === 'outbound' && isZ14DependentField(fieldNumber)) continue
    if (register.handledFields.has(fieldNumber) || prodatSourceSubtypeRule(input.policy.code, fieldNumber)
      || isSourceBoundEndUserField(input.policy.code, fieldNumber)
      || isSourceBoundOptionalInstallationField(input.policy.code, fieldNumber)) continue
    const condition = dependentByField.get(fieldNumber)

    if (!condition) {
      issues.push({
        severity: 'error',
        blocking: true,
        prodatDiagnostic:prodatLocalDiagnostic('internal','PRODAT:dependent-condition-policy','Executable source condition absent'),
        code: 'PRODAT_DEPENDENT_CONDITION_MISSING',
        title: 'PRODAT D-villkor saknas',
        description: `Fält ${fieldNumber || rule.fieldKey} är D i den canonicala matrisen men saknar exekverbart villkor.`,
        fieldPath: rule.segmentPath,
      })
      continue
    }

    if (condition.status === 'undetermined') {
      issues.push({
        severity: 'error',
        blocking: true,
        prodatDiagnostic:prodatLocalDiagnostic('local_unknown',condition.id,'Receiver-local condition facts unknown'),
        code: 'PRODAT_DEPENDENT_CONDITION_UNDETERMINED',
        title: 'PRODAT D-villkor kan inte avgöras',
        description: `${condition.id} kan inte avgöras från källstyrda fakta; produktion ska blockeras i stället för att gissa.`,
        fieldPath: rule.segmentPath,
      })
      continue
    }

    if (condition.status === 'required' && !fieldRulePresent(rule, matrixInput)) {
      issues.push({
        severity: 'error',
        blocking: true,
        prodatDiagnostic:prodatFieldDiagnostic(fieldNumber,'missing',matrixInput,input.rawSegments??[],condition.id),
        code: rule.errorCodeIfMissing ?? 'PRODAT_DEPENDENT_FIELD_MISSING',
        title: 'Obligatoriskt PRODAT-fält saknas',
        description: `${condition.id} är required enligt ${condition.source.document}: ${condition.source.note}`,
        fieldPath: rule.segmentPath,
      })
    }
  }

  if(input.policy.direction==='inbound')issues.push(...validateReceivedZ14ReportingContext({code:input.policy.code,
    rawPayload:input.rawPayload,rawSegments:input.rawSegments,una:input.una,context:input.receivedReportingContext}))
  input.onApplicationObjects?.(projectProdatApplicationObjects({register:registerEvidence,issues,
    completeInvocation:input.scope!=='dependent_only' && input.policy.direction==='inbound'
      && canonicalProdat26AFieldRules(input.policy.code).every(expected=>input.policy.fieldRules.map(asRulebookFieldRule).some(rule=>rule.fieldNumber===expected.fieldNumber)),
  }))
  if(input.scope!=='dependent_only'&&input.policy.direction==='inbound'){
    const facet=projectProdatSourceFunctionObjects({register:registerEvidence,conditions:sourceFunctionConditions,context:input.sourceFunctionContext})
    if(facet)input.onSourceFunctionObjects?.(facet)
  }
  return issues
}
