import { segmentComposite } from '@/lib/ediel/core/edifactTokenizer'
import { observeUtiltsFieldScopes } from './fieldMatrixOccurrences'
import { resolveUtiltsFieldConditions } from './fieldMatrixConditions'
import { UTILTS_TSP_SOURCE } from '@/lib/ediel/rulebook/utiltsTimeSeriesProductCatalogue'
import type {PeriodicReasonAuthority} from './periodicReasonAuthority'
import type {UtiltsIssuerIdentityAuthority} from './issuerIdentityAuthority'
import {supportedUtiltsConsumptionIdentity} from './consumptionIdentity'
import {supabaseService} from '@/lib/supabase/service'
import {isEvidenceUuid} from './durableSourceDiscovery'
import {parseSourceReceiptInstant} from './receivedSourceInventory'
import {inspectCombinedCorrectionReadset} from '@/lib/ediel/sources/combinedCorrectionReadset'
import type {StructuralReadset} from '@/lib/ediel/sources/structuralSourceReadset'
import {compareUtiltsStructure,type StructuralComparison} from './structuralComparison'
import {rebuildUtiltsRuntimeResult,takeUtiltsRuntimeOwner,utiltsRuntimeOwnerFingerprint,type UtiltsRuntimeResult,type UtiltsValidationIssue} from '@/lib/ediel/utiltsEngine'
import {resolveUtiltsProcessabilityPolicy} from '@/lib/ediel/rulebook/utilts25A4'
import type {CanonicalEdielPolicy} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import type {EdielMessageRow} from '@/lib/ediel/types'

export type ReceivedStructureQualification={
  runtime:UtiltsRuntimeResult;hasInternalReview:boolean;hasNationalMismatch:boolean
  evidence:{version:1;owner:'received-structure-comparison-v1'|'regulating-object-ownership-v1';status:'not_applicable'|'evaluated';
    cutoffAt:string|null;snapshotId:string|null;readsetHash:string|null;comparisons:StructuralComparison[]}
}

/** Technical dispatch only: Swedish U5 and current TSP row21 identify L359
 * as area-only. This is not issuer/actor, market or billing authority; those
 * protected admission owners remain required by the enclosing actual flow. */
function qualifiedL359AreaTransactions(message:EdielMessageRow,policy:CanonicalEdielPolicy):ReadonlySet<number> {
  const found=new Set<number>()
  if(policy.code!=='S01'||message.message_code!=='S01'||!message.raw_payload)return found
  // An aggregate source cannot borrow an individual source link, even when its
  // own PIA happens to be valid. No caller-selected flag can relax this scope.
  if([message.customer_id,message.site_id,message.metering_point_id,message.grid_owner_id,message.grid_owner_data_request_id].some(id=>id!=null))return found
  const conditions=resolveUtiltsFieldConditions({policy,rawPayload:message.raw_payload})
  if(!conditions.sourceQualified||UTILTS_TSP_SOURCE.sha256!=='53034f2fd3de416a84f755b454fc72378930126446909cee5eae968111db816b')return found
  const physical=observeUtiltsFieldScopes(message.raw_payload)
  for(const selected of conditions.transactions) {
    const product=selected.product,index=selected.transactionIndex
    if(index===undefined||selected.messageIndex!==0||product.kind!=='qualified'||product.rows.length!==1)continue
    const row=product.rows[0]
    if(row.row!==21||row.productCode!=='L359'||row.messageCode!=='S01'||row.valueField!=='516'
      ||row.identityFields.length!==1||row.identityFields[0]!=='260a'
      ||!product.tuple.every((value,i)=>value===['Z04','U46','Z02','Z58','Z05'][i]))continue
    if(conditions.issues.some(issue=>issue.messageIndex===selected.messageIndex&&issue.transactionIndex===index)
      ||conditions.holds.some(hold=>hold.messageIndex===selected.messageIndex&&hold.transactionIndex===index))continue
    const own=physical.transactions.filter(scope=>scope.messageIndex===0&&scope.transactionIndex===index&&scope.referenceNumber===selected.referenceNumber)
    if(own.length!==1||!selected.referenceNumber)continue
    const locations=own[0].segments.filter(segment=>segment.tag==='LOC')
    if(locations.length!==1||segmentComposite(locations[0],1,physical.una)[0]!=='239')continue
    const area=segmentComposite(locations[0],2,physical.una)
    if(area.length!==3||! /^[A-Z0-9]{1,3}$/.test(area[0])||area[1]!=='SVK'||area[2]!=='260')continue
    // Capability boundary, not a national product-validity decision. This
    // source-only path supports exactly the physical profile accepted by
    // s01_l359_area_identity_v1; other otherwise-valid profiles remain local HOLD.
    const envelope=physical.headers.find(scope=>scope.messageIndex===0)?.segments??[]
    const ownSegments=own[0].segments, observationSegments=own[0].observations.flatMap(scope=>scope.segments)
    const allOwn=[...ownSegments,...observationSegments]
    const one=(segments:typeof locations,tag:string,qualifier?:string)=>{
      const matches=segments.filter(segment=>segment.tag===tag&&(qualifier===undefined||segmentComposite(segment,1,physical.una)[0]===qualifier))
      return matches.length===1?matches[0]:null
    }
    const exact=(segments:typeof locations,tag:string,element:number,expected:readonly string[],qualifier?:string)=>{
      const segment=one(segments,tag,qualifier)
      return !!segment&&JSON.stringify(segmentComposite(segment,element,physical.una))===JSON.stringify(expected)
    }
    if(!exact(ownSegments,'IDE',1,['24'])||!exact(ownSegments,'IDE',2,[selected.referenceNumber])
      ||!exact(ownSegments,'LOC',1,['239'])||!exact(ownSegments,'PIA',1,['1'])
      ||!exact(envelope,'MKS',1,['23'])||!exact(envelope,'MKS',2,['E03','','260'])
      ||!exact(envelope,'DTM',1,['735','+0100','406'],'735')
      ||!exact(ownSegments,'LIN',3,['8716867000030','','','9'])
      ||!exact(ownSegments,'DTM',1,['354','1','802'],'354')
      ||!exact(ownSegments,'STS',1,['7'])||!exact(ownSegments,'STS',3,['E43','','260'])
      ||!exact(ownSegments,'MEA',1,['AAZ'])||!exact(ownSegments,'MEA',3,['KWH'])
      ||!exact(ownSegments,'CCI',3,['E02','','260'])||!exact(ownSegments,'CAV',1,['E01','','260']))continue
    if(allOwn.some(segment=>segment.tag==='NAD'||(segment.tag==='LOC'&&segmentComposite(segment,1,physical.una)[0]!=='239')
      ||(segment.tag==='DTM'&&segmentComposite(segment,1,physical.una)[0]==='597'))
      ||observationSegments.some(segment=>['LOC','PIA','LIN','CCI','CAV'].includes(segment.tag)
        ||(segment.tag==='STS'&&segmentComposite(segment,1,physical.una)[0]==='8'))
      ||allOwn.filter(segment=>segment.tag==='SEQ').length!==1||allOwn.filter(segment=>segment.tag==='QTY').length!==1
      ||!observationSegments.some(segment=>segment.tag==='QTY'&&segmentComposite(segment,1,physical.una)[0]==='136'))continue
    const periodSegment=one(ownSegments,'DTM','324'),latestSegment=one(ownSegments,'DTM','368')
    if(!periodSegment||!latestSegment)continue
    const period=segmentComposite(periodSegment,1,physical.una),latest=segmentComposite(latestSegment,1,physical.una)
    const instant=(value:string)=>{
      if(!/^\d{12}$/.test(value)||value.startsWith('0000'))return null
      const date=new Date(`${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}T${value.slice(8,10)}:${value.slice(10,12)}:00Z`)
      return Number.isFinite(date.getTime())&&date.toISOString().replace(/[-:T]/g,'').slice(0,12)===value?date:null
    }
    if(period[2]!=='719'||!/^\d{24}$/.test(period[1]??'')||latest[2]!=='203')continue
    const start=instant(period[1].slice(0,12)),end=instant(period[1].slice(12)),updated=instant(latest[1]??'')
    if(!start||!end||!updated||period[1].slice(6,12)!=='010000'||period[1].slice(18)!=='010000'||updated<end)continue
    const nextMonth=new Date(start);nextMonth.setUTCMonth(nextMonth.getUTCMonth()+1)
    if(end.getTime()!==nextMonth.getTime())continue
    found.add(index)
  }
  return found
}

/** The only active comparison boundary: it obtains its OWN immutable service
 * snapshot and immediately applies the result to the current invocation. There
 * is no parameter for cached/serialized approvals or caller-supplied readsets.
 * Expected values never come from current metering masterdata or the UTILTS. */
async function qualifyReceivedUtiltsStructureCore(input:{message:EdielMessageRow;runtime:UtiltsRuntimeResult;canonicalPolicy:CanonicalEdielPolicy}):Promise<ReceivedStructureQualification>{
  const {message,runtime,canonicalPolicy}=input
  const result:ReceivedStructureQualification={runtime,hasInternalReview:runtime.transactionDispositions.some(disposition=>disposition.disposition==='internal_review'),hasNationalMismatch:false,
    evidence:{version:1,owner:'received-structure-comparison-v1',status:'not_applicable',cutoffAt:null,snapshotId:null,readsetHash:null,comparisons:[]}}
  if(canonicalPolicy.family!=='UTILTS'||canonicalPolicy.direction!=='inbound'||canonicalPolicy.code!==message.message_code
    ||message.direction!=='inbound')return result
  // U 25-A-4 requires LOC+172 for E72 (UF-request-209-63) and
  // S02 (UF-planning-209-51), including empty nonbilling observations. Other
  // profiles below permit LOC+175, but a valid field
  // is not a tenant/actor mandate or a durable regulating-object identity.
  // The point comparison owner below is limited to E30/E66/S07. Hold only the
  // accepted physical IDE here, preserving genuine guide-negative siblings.
  if(['S01','E72','E73','S06','S02'].includes(message.message_code??'')){
    const qualifiedAreas=qualifiedL359AreaTransactions(message,canonicalPolicy)
    const unowned=runtime.transactionDispositions.flatMap((disposition,index)=>
      disposition.disposition==='accepted'&&runtime.facts.transactions[index]?.regulatingObjectPresent
        ?[disposition.transactionId]:[])
    const unsupportedPoint=runtime.transactionDispositions.flatMap((disposition,index)=>{
      if(disposition.disposition!=='accepted'||runtime.facts.transactions[index]?.regulatingObjectPresent)return []
      if(qualifiedAreas.has(index))return []
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
    utiltsErrCode:code,edielErrorCode:code,referenceQualifier:'TN',referenceNumber:comparison.transactionId,lineItemReference:comparison.transactionId})))
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

const qualifiedOwners=new WeakMap<UtiltsRuntimeResult,{sourceHash:string;resultHash:string;policy:CanonicalEdielPolicy;issuerIdentityAuthority?:UtiltsIssuerIdentityAuthority;periodicReasonAuthority?:PeriodicReasonAuthority}>()
export function takeQualifiedUtiltsRuntimeOwner(runtime:UtiltsRuntimeResult,message:EdielMessageRow,policy:CanonicalEdielPolicy,issuerIdentityAuthority?:UtiltsIssuerIdentityAuthority,periodicReasonAuthority?:PeriodicReasonAuthority):UtiltsRuntimeResult|null {
  const owner=qualifiedOwners.get(runtime)
  qualifiedOwners.delete(runtime)
  if(!owner) return null
  const scope=utiltsRuntimeOwnerFingerprint(message,runtime)
  return owner.policy===policy && owner.issuerIdentityAuthority===issuerIdentityAuthority && owner.periodicReasonAuthority===periodicReasonAuthority && owner.sourceHash===scope.sourceHash && owner.resultHash===scope.resultHash ? structuredClone(runtime) : null
}
/** This seal is minted only after this module obtained its own immutable
 * structural readset and restricted the actual engine invocation. */
export async function qualifyReceivedUtiltsStructure(input:{message:EdielMessageRow;runtime:UtiltsRuntimeResult;canonicalPolicy:CanonicalEdielPolicy;issuerIdentityAuthority?:UtiltsIssuerIdentityAuthority;periodicReasonAuthority?:PeriodicReasonAuthority}):Promise<ReceivedStructureQualification>{
  const before=utiltsRuntimeOwnerFingerprint(input.message,input.runtime)
  const owner=takeUtiltsRuntimeOwner(input.runtime,input.message,input.canonicalPolicy,input.issuerIdentityAuthority,input.periodicReasonAuthority)
  const result=await qualifyReceivedUtiltsStructureCore(input)
  const after=utiltsRuntimeOwnerFingerprint(input.message,input.runtime)
  if(owner && before.sourceHash===after.sourceHash && before.resultHash===after.resultHash) qualifiedOwners.set(result.runtime,{...utiltsRuntimeOwnerFingerprint(input.message,result.runtime),policy:input.canonicalPolicy,issuerIdentityAuthority:input.issuerIdentityAuthority,periodicReasonAuthority:input.periodicReasonAuthority})
  return result
}
