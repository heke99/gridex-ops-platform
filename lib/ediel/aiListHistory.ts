import {aiListDate} from '@/lib/ediel/aiListFormat'
import type {AiListDetailRow} from '@/lib/ediel/aiList'
import {parseProdatMessage,parsedProdatObjects} from '@/lib/ediel/prodat/parser'
import {prodatMarketMinuteToUtc,prodatNowDate203} from '@/lib/ediel/prodat/render/dates'
import {selectStructuralSources} from '@/lib/ediel/sources/structuralSourceSelection'
import {reviewedBusinessFor,type StructuralReadset} from '@/lib/ediel/sources/structuralSourceReadset'
import {isConfirmedCustomerHistoryQualified,type ConfirmedCustomerHistory} from '@/lib/ediel/production/confirmedCustomerHistory'

export type AiListSupplyPeriod={id:string;company_id:string;customer_id:string;metering_point_id:string;start_date:string;end_date:string|null;actual_start_date?:string|null;actual_end_date?:string|null}
export type AiListHistoryScope={companyId:string;environment:'test'|'production';customerId:string;siteId:string;meteringPointId?:string|null;legalSupplier:string;legalNetwork:string;fromDate:string;toDate:string;cutoffAt:string}
export type AiListHistoricalProjection={details:AiListDetailRow[];evidence:{version:1;owner:'ai-reviewed-source-history-v1';snapshotId:string;readsetHash:string;cutoffAt:string;sourceMessageIds:string[];supplyPeriodIds:string[];rowSources:AiListRowSource[]}}
export type AiListRowSource={sourceMessageId:string;baselineSourceMessageId:string;addressSourceMessageId:string;supplyPeriodId:string;customerSourceMessageId?:string}
function hold(reason:string):never{throw new Error(`ai_list_history_unavailable:${reason}`)}
const minuteForDay=(day:string)=>`${aiListDate(day)}0000`
const max=(a:string,b:string)=>a>b?a:b
const min=(a:string,b:string)=>a<b?a:b

/** Pure dated projection, not an approval capability. The server consumer opens
 * the existing service-owned immutable snapshot only after tenant/site access.
 * Mutable today's site/customer/meter fields never manufacture historical rows. */
export function projectAiListHistory(scope:AiListHistoryScope,periods:readonly AiListSupplyPeriod[],readset:StructuralReadset,customerHistory?:ConfirmedCustomerHistory):AiListHistoricalProjection {
  const from=aiListDate(scope.fromDate),to=aiListDate(scope.toDate)
  if(from>=to)hold('search_period_invalid')
  const timeline=readset.timeline
  if(timeline.status!=='inspected'||!timeline.boundedReadComplete||readset.unresolvedSources||!timeline.snapshotId||!timeline.readsetHash||!timeline.ledgerStartedAt||timeline.cutoffAt!==scope.cutoffAt)hold('bounded_source_read_unconfirmed')
  if(periods.length>1000||new Set(periods.map(period=>period.id)).size!==periods.length)hold('supply_period_read_incomplete')
  const rowSources:AiListRowSource[]=[],details:AiListDetailRow[]=[],sourceIds=new Set<string>(),periodIds=new Set<string>()
  for(const period of periods){
    if(period.company_id!==scope.companyId||period.customer_id!==scope.customerId)hold('supply_period_tenant_mismatch')
    if(scope.meteringPointId&&period.metering_point_id!==scope.meteringPointId)continue
    const actualEnd=period.actual_end_date??period.end_date
    const periodFrom=aiListDate(period.actual_start_date??period.start_date),periodTo=actualEnd?aiListDate(actualEnd):null
    if(periodTo&&periodFrom>=periodTo)hold('supply_period_invalid')
    if(periodFrom>=to||periodTo&&periodTo<=from)continue
    const candidates=readset.versions.filter(version=>version.coverage?.supplyPeriodId===period.id&&version.wire.businessCase==='supply_baseline')
    const owners=candidates.map(version=>({version,business:reviewedBusinessFor(readset,version.sourceMessageId,version.wire.object)}))
      .filter(item=>item.business?.companyId===scope.companyId&&item.business.environment===scope.environment&&item.business.customerId===scope.customerId&&item.business.meteringPointId===period.metering_point_id)
    if(!owners.length)hold('dated_supply_owner_missing')
    if(owners.every(item=>item.business!.siteId!==scope.siteId))continue
    if(owners.some(item=>item.business!.siteId!==scope.siteId))hold('supply_site_ambiguous')
    const first=owners[0].version,object=first.wire.object
    if(first.wire.legalSender!==scope.legalNetwork||first.wire.legalReceiver!==scope.legalSupplier)hold('supply_legal_party_mismatch')
    if(owners.some(item=>item.version.wire.object.objectId!==object.objectId||item.version.wire.object.identityAgency!==object.identityAgency))hold('supply_object_ambiguous')
    const start=max(from,periodFrom),end=min(to,periodTo??to)
    const endUtc=prodatMarketMinuteToUtc(minuteForDay(end))!
    // A customer-only change has a separate business owner. Structural approval
    // cannot silently authorize its national customer/name fields or retain an
    // obsolete name. Existing source evidence is a hold until that owner exists.
    const customerFacets=isConfirmedCustomerHistoryQualified(customerHistory,scope,readset)?customerHistory.versions.filter(row=>row.supplyPeriodId===period.id&&row.meteringPointId===period.metering_point_id&&row.objectId===object.objectId&&row.identityAgency===object.identityAgency&&row.legalSender===scope.legalNetwork&&row.legalReceiver===scope.legalSupplier&&row.marketMinute>=minuteForDay(periodFrom)&&row.marketMinute<minuteForDay(end)).sort((a,b)=>a.marketMinute.localeCompare(b.marketMinute)):[]
    const sameFacet=readset.versions.filter(version=>version.wire.object.objectId===object.objectId&&version.wire.object.identityAgency===object.identityAgency
      &&version.wire.legalSender===scope.legalNetwork&&version.wire.legalReceiver===scope.legalSupplier&&version.wire.businessCase==='customer_only'
      &&version.disposition!=='rejected'&&(version.wire.functionCode==='5'||version.wire.effectiveFrom.utc>=first.coverage!.validFrom&&version.wire.effectiveFrom.utc<endUtc))
    for(const version of sameFacet){
      if(version.wire.functionCode!=='9'||customerFacets.filter(row=>row.sourceMessageId===version.sourceMessageId&&row.payloadHash===version.payloadHash&&row.marketMinute===version.wire.effectiveFrom.marketMinute&&Date.parse(row.effectiveAt)===Date.parse(version.wire.effectiveFrom.utc)).length!==1)hold('dated_customer_change_owner_missing')
    }
    if(customerFacets.some(row=>!sameFacet.some(version=>version.sourceMessageId===row.sourceMessageId)&&row.marketMinute>=minuteForDay(periodFrom)&&row.marketMinute<minuteForDay(end)))hold('dated_customer_facet_source_missing')
    if(customerFacets.some(row=>row.marketMinute.slice(8)!=='0000')||new Set(customerFacets.map(row=>row.marketMinute)).size!==customerFacets.length)hold('date_only_customer_boundary_unrepresentable')
    const selected=selectStructuralSources({companyId:scope.companyId,environment:scope.environment,customerId:scope.customerId,supplyPeriodId:period.id,
      ledgerStartedAt:timeline.ledgerStartedAt,cutoffAt:scope.cutoffAt,readComplete:true,unresolvedSources:false,versions:readset.versions,
      closures:readset.closures,closureBlockers:readset.closureBlockers,correctionContextBlockers:readset.correctionContextBlockers,
      objectId:object.objectId!,identityAgency:object.identityAgency!,legalSender:scope.legalNetwork,legalReceiver:scope.legalSupplier,periodStart:prodatMarketMinuteToUtc(minuteForDay(periodFrom))!,periodEnd:endUtc,boundary:'interval'})
    if(selected.status!=='selected')hold(selected.reason)
    const baseline=readset.versions.find(version=>version.sourceMessageId===selected.states[0]?.sourceMessageId)
    if(!baseline||baseline.wire.effectiveFrom.marketMinute!==minuteForDay(periodFrom))hold('supply_start_source_mismatch')
    if(periodTo&&selected.coverage.validTo!==prodatMarketMinuteToUtc(minuteForDay(periodTo)))hold('dated_supply_end_owner_missing')
    if(selected.coverage.validTo&&periodTo===null)hold('supply_end_record_mismatch')
    const baselineSource=readset.sources.find(source=>source.sourceMessageId===baseline.sourceMessageId)
    const baselineObject=baselineSource&&parsedProdatObjects(parseProdatMessage(baselineSource.rawPayload)).find(item=>item.meteringPointId===object.objectId&&item.identityAgency===object.identityAgency)
    const customer=baselineObject?.registers[0]
    if(!customer?.endUserId||!customer.endUserName||!['SE1','SE2'].includes(customer.endUserIdQualifier??''))hold('dated_customer_identity_missing')
    let previous=baselineObject!.registers[0],addressSourceMessageId=baseline.sourceMessageId
    for(let index=0;index<selected.states.length;index++){
      const state=selected.states[index],version=readset.versions.find(item=>item.sourceMessageId===state.sourceMessageId)
      const source=readset.sources.find(item=>item.sourceMessageId===state.sourceMessageId)
      if(!source||!version||version.wire.effectiveFrom.marketMinute.slice(8)!=='0000')hold('date_only_boundary_unrepresentable')
      const parsed=parsedProdatObjects(parseProdatMessage(source.rawPayload)).find(item=>item.meteringPointId===object.objectId&&item.identityAgency===object.identityAgency)?.registers[0]
      if(!parsed?.balanceResponsibleId||!parsed.gridAreaId)hold('dated_grid_or_balance_party_missing')
      // Z10 excludes installation fields. Preserve the last permitted original
      // source for address; never use supplied forbidden extras on that object.
      if(version.wire.messageCode!=='Z10'){previous=parsed;addressSourceMessageId=state.sourceMessageId}
      const next=selected.states[index+1],stateStart=max(start,version.wire.effectiveFrom.marketMinute.slice(0,8))
      const stateEnd=next?min(end,prodatNowDate203(new Date(next.effectiveFrom)).slice(0,8)):end
      sourceIds.add(state.sourceMessageId)
      if(stateEnd<=start)continue
      if(stateStart>=stateEnd)hold('dated_row_boundary_invalid')
      const boundaries=[stateStart,...customerFacets.map(row=>row.marketMinute.slice(0,8)).filter(day=>day>stateStart&&day<stateEnd),stateEnd]
      for(let part=0;part<boundaries.length-1;part++){
       const rowStart=boundaries[part],rowEnd=boundaries[part+1],facet=customerFacets.filter(row=>row.marketMinute<=minuteForDay(rowStart)).at(-1)
       if(facet&&facet.party.id!==customer.endUserId&&!(facet.authorityKind==='bilateral'&&facet.identityChangeAuthorized===true))hold('dated_customer_identity_transition_unqualified')
       rowSources.push({sourceMessageId:state.sourceMessageId,baselineSourceMessageId:baseline.sourceMessageId,addressSourceMessageId,supplyPeriodId:period.id,...(facet?{customerSourceMessageId:facet.sourceMessageId}:{})})
       details.push({anlaggningsId:object.objectId!,kodlista:object.identityAgency!,natavrakningsomrade:parsed.gridAreaId,
        balansansvarsId:parsed.balanceResponsibleId,elanvandarId:facet?.party.id??customer.endUserId,elanvandarNamn:facet?.party.name??customer.endUserName,
        anlaggningsAdress:previous.installationAddress,postnummer:previous.installationPostcode,ort:previous.installationCity,
        franDatum:rowStart===from?null:rowStart,tillDatum:rowEnd===to?null:rowEnd,
        matarNummer:null,avrakningsmetod:null,arsforbrukningKwh:null,rapporteringsfrekvens:null,matmetod:null,produktkod:null})
       if(facet)sourceIds.add(facet.sourceMessageId)
      }
      sourceIds.add(state.sourceMessageId)
    }
    sourceIds.add(baseline.sourceMessageId)
    if(selected.closure)sourceIds.add(selected.closure.sourceMessageId)
    periodIds.add(period.id)
  }
  return {details,evidence:{version:1,owner:'ai-reviewed-source-history-v1',snapshotId:timeline.snapshotId,readsetHash:timeline.readsetHash,cutoffAt:scope.cutoffAt,sourceMessageIds:[...sourceIds].sort(),supplyPeriodIds:[...periodIds].sort(),rowSources}}
}
