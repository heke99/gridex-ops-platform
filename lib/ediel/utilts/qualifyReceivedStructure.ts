import {supportedUtiltsConsumptionIdentity} from './consumptionIdentity'
import {supabaseService} from '@/lib/supabase/service'
import {isEvidenceUuid} from './durableSourceDiscovery'
import {parseSourceReceiptInstant} from './receivedSourceInventory'
import {inspectStructuralReadset} from '@/lib/ediel/sources/structuralSourceReadset'
import {compareUtiltsStructure,type StructuralComparison} from './structuralComparison'
import {rebuildUtiltsRuntimeResult,type UtiltsRuntimeResult,type UtiltsValidationIssue} from '@/lib/ediel/utiltsEngine'
import {resolveUtiltsProcessabilityPolicy} from '@/lib/ediel/rulebook/utilts25A4'
import type {CanonicalEdielPolicy} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import type {EdielMessageRow} from '@/lib/ediel/types'

export type ReceivedStructureQualification={
  runtime:UtiltsRuntimeResult;hasInternalReview:boolean;hasNationalMismatch:boolean
  evidence:{version:1;owner:'received-structure-comparison-v1';status:'not_applicable'|'evaluated';
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
    ||message.direction!=='inbound'||!['E30','E66','S07'].includes(message.message_code??''))return result
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
  let readset:ReturnType<typeof inspectStructuralReadset>|null=null
  if(needsReadset&&isEvidenceUuid(companyId)&&isEvidenceUuid(message.id)&&typeof raw==='string'&&typeof cutoffAt==='string'
    &&parseSourceReceiptInstant(cutoffAt)!==null&&['test','production'].includes(message.environment)){
    result.evidence.cutoffAt=cutoffAt
    try{
      const {data,error}=await supabaseService.rpc('gridex_source_object_snapshot_v1',{
        p_company_id:companyId,p_environment:message.environment,p_cutoff:cutoffAt,
      }).abortSignal(AbortSignal.timeout(2000))
      if(!error)readset=inspectStructuralReadset({companyId,environment:message.environment,cutoffAt},data)
      if(readset?.timeline.status==='inspected'){
        result.evidence.snapshotId=readset.timeline.snapshotId;result.evidence.readsetHash=readset.timeline.readsetHash
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
      unresolvedSources:readset?.unresolvedSources??true,versions:readset?.versions??[],closures:readset?.closures??[],closureBlockers:readset?.closureBlockers??[]})
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
