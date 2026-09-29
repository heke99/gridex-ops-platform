import {supportedUtiltsConsumptionIdentity} from './consumptionIdentity'
import {supabaseService} from '@/lib/supabase/service'
import {isEvidenceUuid} from './durableSourceDiscovery'
import {parseSourceReceiptInstant} from './receivedSourceInventory'
import {inspectCombinedCorrectionReadset} from '@/lib/ediel/sources/combinedCorrectionReadset'
import type {StructuralReadset} from '@/lib/ediel/sources/structuralSourceReadset'
import {compareUtiltsStructure,type StructuralComparison} from './structuralComparison'
import {rebuildUtiltsRuntimeResult,type UtiltsRuntimeResult,type UtiltsValidationIssue} from '@/lib/ediel/utiltsEngine'
import {resolveUtiltsProcessabilityPolicy} from '@/lib/ediel/rulebook/utilts25A4'
import type {CanonicalEdielPolicy} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import type {EdielMessageRow} from '@/lib/ediel/types'

export type ReceivedStructureQualification={
  runtime:UtiltsRuntimeResult;hasInternalReview:boolean;hasNationalMismatch:boolean
  evidence:{version:1;owner:'received-structure-comparison-v1'|'regulating-object-ownership-v1';status:'not_applicable'|'evaluated';
    cutoffAt:string|null;snapshotId:string|null;readsetHash:string|null;comparisons:StructuralComparison[]}
}

/** The only active comparison boundary: it obtains its OWN immutable service
 * snapshot and immediately applies the result to the current invocation. There
 * is no parameter for cached/serialized approvals or caller-supplied readsets.
 * Expected values never come from current metering masterdata or the UTILTS. */
export async function qualifyReceivedUtiltsStructure(input:{message:EdielMessageRow;runtime:UtiltsRuntimeResult;canonicalPolicy:CanonicalEdielPolicy}):Promise<ReceivedStructureQualification>{
  const {message,runtime,canonicalPolicy}=input
  const result:ReceivedStructureQualification={runtime,hasInternalReview:false,hasNationalMismatch:false,
    evidence:{version:1,owner:'received-structure-comparison-v1',status:'not_applicable',cutoffAt:null,snapshotId:null,readsetHash:null,comparisons:[]}}
  if(canonicalPolicy.family!=='UTILTS'||canonicalPolicy.direction!=='inbound'||canonicalPolicy.code!==message.message_code
    ||message.direction!=='inbound')return result
  // U 25-A-4 requires LOC+172 for E72 (UF-request-209-63). Other
  // profiles below permit LOC+175, but a valid field
  // is not a tenant/actor mandate or a durable regulating-object identity.
  // The point comparison owner below is limited to E30/E66/S07. Hold only the
  // accepted physical IDE here, preserving genuine guide-negative siblings.
  if(['S01','E72','E73','S06'].includes(message.message_code??'')){
    const unowned=runtime.transactionDispositions.flatMap((disposition,index)=>
      disposition.disposition==='accepted'&&runtime.facts.transactions[index]?.regulatingObjectPresent
        ?[disposition.transactionId]:[])
    const unsupportedPoint=runtime.transactionDispositions.flatMap((disposition,index)=>{
      if(disposition.disposition!=='accepted'||runtime.facts.transactions[index]?.regulatingObjectPresent)return []
      const identity=supportedUtiltsConsumptionIdentity(message.raw_payload??'',index)
      return !identity||identity.transactionId!==disposition.transactionId?[disposition.transactionId]:[]
    })
    if(!unowned.length&&!unsupportedPoint.length)return result
    const held=new Set([...unowned,...unsupportedPoint]),unownedIds=new Set(unowned)
    const dispositions=runtime.transactionDispositions.map(disposition=>disposition.disposition==='accepted'&&held.has(disposition.transactionId)
      ?{...disposition,disposition:'internal_review' as const,responseType:'none' as const,
        issueCodes:[...disposition.issueCodes,unownedIds.has(disposition.transactionId)?'UTILTS_REGULATING_OBJECT_OWNER_UNAVAILABLE':'UTILTS_STRUCTURE_UNAVAILABLE']}:disposition)
    result.evidence={...result.evidence,owner:unsupportedPoint.length?'received-structure-comparison-v1':'regulating-object-ownership-v1',status:'evaluated',comparisons:[...held].map(transactionId=>({
      transactionId,status:'unavailable',reason:unownedIds.has(transactionId)?'regulating_object_owner_unavailable':'utilts_consumption_identity_unsupported',codes:[],selected:[],
    }))}
    result.hasInternalReview=true
    result.runtime={...runtime,transactionDispositions:dispositions,
      validation:{...runtime.validation,ok:false,classification:runtime.validation.classification==='accepted'?'internal_review':runtime.validation.classification,
        issues:[...runtime.validation.issues,...[...held].map(transactionId=>({severity:'warning' as const,kind:'functional' as const,
          code:unownedIds.has(transactionId)?'UTILTS_REGULATING_OBJECT_OWNER_UNAVAILABLE':'UTILTS_STRUCTURE_UNAVAILABLE',
          title:unownedIds.has(transactionId)?'Reglerobjektets ägare saknas':'Fysisk punktidentitet kan inte fastställas',
          description:unownedIds.has(transactionId)
            ?'Juridisk aktör, mandat och beständig reglerobjektsägare är inte verifierade. Ingen nationell felkod har skapats.'
            :'En entydig anläggning kan inte fastställas i den fysiska transaktionen. Ingen nationell felkod har skapats.',
          referenceNumber:transactionId,lineItemReference:transactionId}))]},
      ackPlan:{...runtime.ackPlan,...(dispositions.every(disposition=>disposition.disposition==='internal_review')?{shouldSendAperak:false,aperakOutcome:null}:{}),
        reason:unsupportedPoint.length&&unowned.length?'Reglerobjektets ägare och fysisk punktidentitet kan inte fastställas för alla transaktioner.'
          :unsupportedPoint.length?'Fysisk punktidentitet kan inte fastställas för en eller flera transaktioner.':'Reglerobjektets juridiska ägare och mandat är inte verifierade.'}}
    return result
  }
  if(!['E30','E66','S07'].includes(message.message_code??''))return result
  const eligible=runtime.transactionDispositions.map((disposition,index)=>({disposition,index})).filter(({disposition})=>disposition.disposition==='accepted')
  if(!eligible.length)return result
  const raw=message.raw_payload
  const identityFailures=new Map(eligible.filter(({disposition,index})=>{
    const identity=supportedUtiltsConsumptionIdentity(raw??'',index)
    return !identity||identity.transactionId!==disposition.transactionId
  }).map(({disposition,index})=>[index,{transactionId:disposition.transactionId,status:'unavailable' as const,
    reason:'utilts_consumption_identity_unsupported',codes:[],selected:[]}]))
  const comparisonEnabled=resolveUtiltsProcessabilityPolicy(canonicalPolicy.referenceDate).validateMeterAndRegisterAgainstStructuralInformation
  const compareEligible=eligible.filter(({index})=>!identityFailures.has(index))
  const needsReadset=comparisonEnabled&&compareEligible.some(({index})=>compareUtiltsStructure({raw:raw??'',transactionIndex:index,
    cutoffAt:'',ledgerStartedAt:'',readComplete:false,unresolvedSources:true,versions:[]}).status!=='not_applicable')
  // The original wire, not a cached diagnostic, decides that an energy-only
  // high-resolution transaction has no meter/register comparison to perform.
  // Do not obtain an authority readset when every accepted transaction is exempt.
  if(!identityFailures.size&&!needsReadset)return result
  result.evidence.status='evaluated'
  const companyId=message.company_id,cutoffAt=new Date().toISOString()
  let readset:StructuralReadset|null=null
  if(needsReadset&&isEvidenceUuid(companyId)&&isEvidenceUuid(message.id)&&typeof raw==='string'&&typeof cutoffAt==='string'
    &&parseSourceReceiptInstant(cutoffAt)!==null&&['test','production'].includes(message.environment)){
    result.evidence.cutoffAt=cutoffAt
    try{
      const {data,error}=await supabaseService.rpc('gridex_correction_combined_snapshot_v1',{
        p_company_id:companyId,p_environment:message.environment,p_message_id:message.id,p_cutoff:cutoffAt,
      }).abortSignal(AbortSignal.timeout(2000))
      const inspected=!error?inspectCombinedCorrectionReadset({companyId,environment:message.environment,cutoffAt},message.id,data):null
      readset=inspected?.source??null
      if(readset?.timeline.status==='inspected'){
        result.evidence.snapshotId=inspected!.snapshotId;result.evidence.readsetHash=inspected!.readsetHash
      }
    }catch{/* No stale snapshot fallback and no national rejection on IO failure. */}
  }
  const comparisons=eligible.map(({disposition,index})=>{
    const identityFailure=identityFailures.get(index)
    if(identityFailure)return identityFailure
    if(!comparisonEnabled)return {transactionId:disposition.transactionId,status:'not_applicable' as const,reason:null,codes:[],selected:[]}
    // Even a failed snapshot may be irrelevant to a quarter-energy transaction
    // with no meter/register observations. The pure input decides applicability.
    const compared=compareUtiltsStructure({raw:raw??'',transactionIndex:index,cutoffAt:cutoffAt??'',
      ledgerStartedAt:readset?.timeline.ledgerStartedAt??'',readComplete:readset?.timeline.boundedReadComplete===true,
      unresolvedSources:readset?.unresolvedSources??true,versions:readset?.versions??[],closures:readset?.closures??[],closureBlockers:readset?.closureBlockers??[],
      correctionContextBlockers:readset?.correctionContextBlockers??[],companyId:companyId??undefined,
      environment:message.environment==='test'||message.environment==='production'?message.environment:undefined})
    if(compared.transactionId!==disposition.transactionId&&compared.status!=='not_applicable')return {
      transactionId:disposition.transactionId,status:'unavailable' as const,reason:'structural_runtime_scope_mismatch',codes:[],selected:[],
    }
    return compared
  })
  result.evidence.comparisons=comparisons
  const issues:UtiltsValidationIssue[]=comparisons.flatMap(comparison=>comparison.codes.map(code=>({severity:'error' as const,kind:'functional' as const,
    code:`UTILTS_RECEIVED_STRUCTURE_${code}`,title:code==='E61'?'Mätar-id avviker från godkänt strukturunderlag':'Register avviker från godkänt strukturunderlag',
    description:code==='E61'?'Mätar-id jämfördes med godkänd PRODAT-struktur för leveransperioden.':'Register-id och fullständigt registerantal jämfördes med godkänd PRODAT-struktur för leveransperioden.',
    utiltsErrCode:code,edielErrorCode:code,referenceQualifier:'ACW',referenceNumber:comparison.transactionId,lineItemReference:comparison.transactionId})))
  result.hasNationalMismatch=issues.length>0
  let qualified=issues.length?rebuildUtiltsRuntimeResult({message,result:runtime,issues:[...runtime.validation.issues,...issues]}):runtime
  const held=new Set(comparisons.filter(comparison=>comparison.status==='unavailable').map(comparison=>comparison.transactionId))
  if(held.size){
    const dispositions=qualified.transactionDispositions.map(disposition=>disposition.disposition==='accepted'&&held.has(disposition.transactionId)
      ?{...disposition,disposition:'internal_review' as const,responseType:'none' as const,issueCodes:[...disposition.issueCodes,'UTILTS_STRUCTURE_UNAVAILABLE']}:disposition)
    result.hasInternalReview=dispositions.some(disposition=>disposition.disposition==='internal_review')
    const warnings:UtiltsValidationIssue[]=comparisons.filter(comparison=>comparison.status==='unavailable').map(comparison=>({severity:'warning',kind:'functional',
      code:'UTILTS_STRUCTURE_UNAVAILABLE',title:'Strukturunderlag måste granskas',description:'Fullständigt godkänt strukturunderlag kunde inte fastställas för den tidpunkt som kontrolleras. Ingen nationell felkod har skapats.',
      referenceNumber:comparison.transactionId,lineItemReference:comparison.transactionId}))
    qualified={...qualified,transactionDispositions:dispositions,
      validation:{...qualified.validation,ok:false,classification:qualified.validation.classification==='accepted'?'internal_review':qualified.validation.classification,
        issues:[...qualified.validation.issues,...warnings]},
      ackPlan:{...qualified.ackPlan,...(dispositions.every(disposition=>disposition.disposition==='internal_review')?{shouldSendAperak:false,aperakOutcome:null}:{}),
        reason:'Godkänt och tidsmässigt fullständigt strukturunderlag saknas för en eller flera transaktioner.'}}
  }
  result.runtime=qualified
  return result
}
