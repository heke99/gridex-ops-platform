import {singleMessage,legalParty} from './receivedStructuralSources'
import {segmentComposite,type EdifactTokenizedSegment} from '@/lib/ediel/core/edifactTokenizer'
import {localEdifactDateTimeToUtc,type EdifactTimezoneOffset} from './timezone'
import {selectStructuralSources,type StructuralVersion,type SelectedStructure} from '@/lib/ediel/sources/structuralSourceSelection'
import {parseSourceReceiptInstant} from './receivedSourceInventory'
import type {ClosureVersion,ScopedClosureBlocker,ClosureProvenance} from '@/lib/ediel/sources/closureSelection'
import type {StructuralCoverage} from '@/lib/ediel/sources/structuralSourceSelection'

export type StructuralComparisonInput={raw:string;transactionIndex:number;cutoffAt:string;ledgerStartedAt:string;readComplete:boolean;unresolvedSources:boolean;versions:readonly StructuralVersion[];closures?:readonly ClosureVersion[];closureBlockers?:readonly ScopedClosureBlocker[]}
export type StructuralComparison={transactionId:string|null;status:'not_applicable'|'matched'|'mismatch'|'unavailable';reason:string|null;codes:('E61'|'E62')[];selected:SelectedStructure[];coverage?:StructuralCoverage;closure?:ClosureProvenance}
const instant=parseSourceReceiptInstant

/** Physical observations are not expectations. Reference inheritance is confined
 * to consecutive readings of ONE register; energy SEQs do not add registers.
 * A received register/meter is never used to choose the expected source side. */
export function compareUtiltsStructure(input:StructuralComparisonInput):StructuralComparison{
  let transactionId:string|null=null
  const unavailable=(reason:string):StructuralComparison=>({transactionId,status:'unavailable',reason,codes:[],selected:[]})
  const notApplicable=():StructuralComparison=>({transactionId,status:'not_applicable',reason:null,codes:[],selected:[]})
  try{
    const ast=singleMessage(input.raw,'UTILTS')
    if(!ast)return unavailable('structural_utilts_envelope_unknown')
    if(!['E30','E66','S07'].includes(ast.messages[0].messageCode??''))return notApplicable()
    const transactions=ast.messages[0].utiltsTransactions??[],transaction=transactions[input.transactionIndex]
    if(!transaction||!Number.isSafeInteger(input.transactionIndex)||input.transactionIndex<0)return unavailable('structural_transaction_unknown')
    transactionId=transaction.transactionId
    if(transaction.identityQualifier!=='24'||transaction.identityComponents.length!==1||!transactionId
      ||transactions.filter(item=>item.transactionId===transactionId).length!==1)return unavailable('structural_transaction_ambiguous')
    const stop=transaction.segments.findIndex(segment=>segment.tag==='SEQ')
    const header=stop<0?transaction.segments:transaction.segments.slice(0,stop)
    const parts=(segment:EdifactTokenizedSegment,index:number)=>segmentComposite(segment,index,ast.una)
    const datetimes=(segments:readonly EdifactTokenizedSegment[],qualifier:string)=>segments.filter(segment=>segment.tag==='DTM'&&parts(segment,1)[0]===qualifier).map(segment=>parts(segment,1))
    const resolution=datetimes(header,'354')
    const highResolution=resolution.length===1&&resolution[0].length===3&&Number(resolution[0][1])>0
      &&(resolution[0][2]==='806'&&Number(resolution[0][1])<=60||resolution[0][2]==='805'&&Number(resolution[0][1])<=1||resolution[0][2]==='807'&&Number(resolution[0][1])<=3600)
    const readings=transaction.observations.filter(observation=>observation.quantities.some(quantity=>quantity.qualifier==='220'))
    const explicitReferences=transaction.observations.flatMap(observation=>observation.references.filter(reference=>['AES','MG'].includes(reference.qualifier??'')))
    if(!readings.length&&!explicitReferences.length&&highResolution)return notApplicable()
    const sender=legalParty(ast,'MS','IDE',['SVK','260']),receiver=legalParty(ast,'MR','IDE',['SVK','260'])
    const locations=header.filter(segment=>segment.tag==='LOC'&&parts(segment,1)[0]==='172')
    if(!sender||!receiver||locations.length!==1||parts(locations[0],1).length!==1)return unavailable('structural_object_scope_unknown')
    const object=parts(locations[0],2)
    if(object.length!==3||!object[0]||object[1]!==''||!['9','89'].includes(object[2]))return unavailable('structural_object_scope_unknown')
    const firstIde=ast.messages[0].segments.findIndex(segment=>segment.tag==='IDE')
    const zones=datetimes(ast.messages[0].segments.slice(0,firstIde),'735')
    if(zones.length!==1||zones[0].length!==3||zones[0][2]!=='406'||!/^[-+]\d{4}$/.test(zones[0][1]))return unavailable('structural_timezone_unknown')
    const offset=zones[0][1],hours=Number(offset.slice(1,3)),minutes=Number(offset.slice(3))
    if(hours>14||minutes>59||hours===14&&minutes!==0)return unavailable('structural_timezone_unknown')
    const timezone:EdifactTimezoneOffset={raw:offset,offsetMinutes:(offset[0]==='-'?-1:1)*(hours*60+minutes),format:'406'}
    const date=(value:string,format:string):string|null=>{
      const length=format==='102'?8:format==='203'?12:format==='204'?14:0
      if(!length||!new RegExp(`^\\d{${length}}$`).test(value))return null
      return localEdifactDateTimeToUtc(`${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}T${value.slice(8,10)||'00'}:${value.slice(10,12)||'00'}:${value.slice(12,14)||'00'}`,timezone)
    }
    const readingTimes:string[]=[]
    const observedRegisters=new Set<string>(),observedMeters=new Set<string>()
    let currentRegister:string|null=null,currentMeter:string|null=null
    for(const observation of readings){
      const registers=observation.references.filter(reference=>reference.qualifier==='AES')
      const meters=observation.references.filter(reference=>reference.qualifier==='MG')
      if(registers.length!==1||meters.length>1||[...registers,...meters].some(reference=>!reference.directReferenceSlot||reference.components.length!==2||reference.value===null)
        ||observation.quantities.filter(quantity=>quantity.qualifier==='220').length!==1)return unavailable('structural_observation_identity_unknown')
      const registerId=registers[0].value!
      if(currentRegister!==registerId){currentRegister=registerId;currentMeter=null}
      if(meters.length)currentMeter=meters[0].value
      if(currentMeter===null)return unavailable('structural_observation_meter_unknown')
      observedRegisters.add(registerId);observedMeters.add(currentMeter)
      const dates=datetimes(observation.segments,'597')
      const at=dates.length===1&&dates[0].length===3?date(dates[0][1],dates[0][2]):null
      if(!at)return unavailable('structural_reading_time_unknown')
      readingTimes.push(at)
    }
    for(const reference of explicitReferences){
      if(!reference.directReferenceSlot||reference.components.length!==2||reference.value===null)return unavailable('structural_observation_identity_unknown')
      if(reference.qualifier==='MG')observedMeters.add(reference.value)
    }
    const periods=datetimes(header,'324')
    let start:string|null=null,end:string|null=null,boundary:'interval'|'current_point'|'closing_point'='interval'
    const reasons=header.filter(segment=>segment.tag==='STS'&&parts(segment,1)[0]==='7')
    const reason=reasons.length===1?parts(reasons[0],3)[0]:null
    if(periods.length===1&&periods[0].length===3&&periods[0][2]==='719'&&/^\d{24}$/.test(periods[0][1])){
      start=date(periods[0][1].slice(0,12),'203');end=date(periods[0][1].slice(12),'203')
    }else if(!periods.length&&readingTimes.length&&new Set(readingTimes).size===1){
      start=readingTimes[0];end=start
      boundary=ast.messages[0].messageCode==='E30'&&['E24','E20','E77'].includes(reason??'')?'closing_point':'current_point'
      if(!['E24','E20','E77','E25','E67'].includes(reason??'')&&input.versions.some(version=>version.wire.object.objectId===object[0]
        &&version.wire.object.identityAgency===object[2]&&version.wire.legalSender===sender&&version.wire.legalReceiver===receiver
        &&version.wire.businessCase!=='supply_baseline'&&version.wire.businessCase!=='customer_only'&&instant(version.wire.effectiveFrom.utc)===instant(start)))return unavailable('structural_point_side_ambiguous')
    }
    if(!start||!end||readingTimes.some(at=>instant(at)!<instant(start)!||instant(at)!>instant(end)!))return unavailable('structural_period_unknown')
    const selection=selectStructuralSources({ledgerStartedAt:input.ledgerStartedAt,cutoffAt:input.cutoffAt,readComplete:input.readComplete,
      unresolvedSources:input.unresolvedSources,versions:input.versions,closures:input.closures,closureBlockers:input.closureBlockers,objectId:object[0],identityAgency:object[2],legalSender:sender,legalReceiver:receiver,
      periodStart:start,periodEnd:end,boundary})
    if(selection.status!=='selected')return unavailable(selection.reason)
    if(selection.states.length!==1)return unavailable('structural_transition_inside_transaction')
    const selected=selection.states[0],compareRegisters=readings.length>0||!highResolution||explicitReferences.some(reference=>reference.qualifier==='AES')
    if(observedMeters.size&&selected.meterNumber===null||compareRegisters&&(!selected.registerIds.length||selected.registerIds.some(id=>id===null)
      ||new Set(selected.registerIds).size!==selected.registerIds.length))return unavailable('structural_expected_inventory_unknown')
    const codes:('E61'|'E62')[]=[]
    if([...observedMeters].some(meter=>meter!==selected.meterNumber))codes.push('E61')
    if(compareRegisters&&(observedRegisters.size!==selected.registerIds.length||selected.registerIds.some(id=>!observedRegisters.has(id!))))codes.push('E62')
    return {transactionId,status:codes.length?'mismatch':'matched',reason:null,codes,selected:selection.states,
      ...(selection.closure?{coverage:selection.coverage,closure:selection.closure}:{})}
  }catch{return unavailable('structural_comparison_unconfirmed')}
}
