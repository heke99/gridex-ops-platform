import type {StructuralVersion,StructuralCoverage} from '@/lib/ediel/sources/structuralSourceSelection'
import type {StructuralComparisonInput} from '@/lib/ediel/utilts/structuralComparison'
export const STRUCTURE_POINT='735123456789012345'
export const STRUCTURE_START='2026-09-30T23:00:00.000Z'
export const STRUCTURE_CHANGE='2026-10-14T23:00:00.000Z'
export const STRUCTURE_END='2026-10-31T23:00:00.000Z'
const uuid=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
export const coverage:StructuralCoverage={kind:'post_ledger_supply',baselineSourceMessageId:uuid(1),baselineAssessmentId:uuid(2),baselineFactsHash:'b'.repeat(64),
  supplyPeriodId:uuid(3),switchRequestId:uuid(4),switchCreatedAt:'2026-09-22T10:00:00Z',outboundSourceMessageId:uuid(5),outboundCreatedAt:'2026-09-22T11:00:00Z',validFrom:STRUCTURE_START,validTo:null}
/** Synthetic pure-selection input, expressly not an accepted-owner fixture. */
export function structureVersion(number=1,meter='OLD',ids=['201','202']):StructuralVersion{
  return {sourceMessageId:uuid(number),assessmentId:uuid(number+10),factsHash:'c'.repeat(64),payloadHash:'d'.repeat(64),availableAt:'2026-10-02T10:00:00Z',
    disposition:'accepted',coverage:structuredClone(coverage),replaces:null,wire:{object:{messageIndex:0,messageReference:'SOURCE',objectId:STRUCTURE_POINT,identityAgency:'9',registers:[]},
      messageCode:number===1?'Z04':'Z10',businessCase:number===1?'supply_baseline':'meter_exchange',functionCode:'9',documentReference:`D${number}`,caseReference:'CASE',
      effectiveFrom:{fieldNumber:number===1?'210':'216',marketMinute:number===1?'202610010000':'202610150000',utc:number===1?STRUCTURE_START:STRUCTURE_CHANGE},
      contractStartMinute:'202610010000',legalSender:'12345',legalReceiver:'54321',transportSender:'12345',transportReceiver:'54321',
      meterNumber:meter,oldMeterNumber:number===1?null:'OLD',registers:ids.map((registerId,index)=>({position:index+1,registerId}))}}
}
function escape(value:string){return value.replace(/[?:+']/g,char=>`?${char}`)}
export function utiltsStructureWire(options:{code?:string;ids?:string[];meter?:string;meters?:(string|null)[];period?:string;reason?:string;
  highResolution?:boolean;noReadings?:boolean;point?:string;sender?:string;receiver?:string;before?:string[];after?:string[];readingStart?:string;readingEnd?:string}={}){
  const period=options.period??'202610010000202611010000'
  const body=[`BGM+${options.code??'E66'}::260+DATA+9+AB`,'DTM+137:202611021200:203','DTM+735:?+0100:406','MKS+23+E02::260',
    `NAD+MS+${options.sender??'12345'}:SVK:260`,`NAD+MR+${options.receiver??'54321'}:SVK:260`,'NAD+DDQ','IDE+24+TX',
    `LOC+172+${options.point??STRUCTURE_POINT}::9`,'LOC+239+AAA:SVK:260','LIN+++8716867000030:::9',
    ...(period?[`DTM+324:${period}:719`]:[]),'DTM+597:202611021200:203',`DTM+354:${options.highResolution?'15:806':'1:802'}`,
    `STS+7++${options.reason??'E88'}::260`,'MEA+AAZ++KWH',...(options.before??[])]
  let seq=1
  if(!options.noReadings)for(const [index,id] of (options.ids??['201','202']).entries()){
    const meter=options.meters?options.meters[index]:options.meter??'OLD'
    body.push(`SEQ++${seq++}`,`RFF+AES:${escape(id)}`,...(meter===null?[]:[`RFF+MG:${escape(meter??'OLD')}`]),'QTY+220:100',`DTM+597:${options.readingStart??(period.slice(0,12)||'202610150000')}:203`)
    if(period)body.push(`SEQ++${seq++}`,`RFF+AES:${escape(id)}`,'QTY+220:110',`DTM+597:${options.readingEnd??(period.slice(12)||'202610150000')}:203`)
  }
  body.push(`SEQ++${seq++}`,'QTY+136:10',...(options.after??[]))
  return `UNA:+.? '\nUNB+UNOC:3+12345:ZZ+54321:ZZ+261102:1200+CTRL++23-DDQ-E66-S++1'\nUNH+1+UTILTS:D:02B:UN:E5SE5A'\n${body.join("'\n")}'\nUNT+${body.length+2}+1'\nUNZ+1+CTRL'`
}
export function comparisonInput(raw=utiltsStructureWire(),versions=[structureVersion()]):StructuralComparisonInput{
  return {raw,versions,transactionIndex:0,cutoffAt:'2026-11-02T12:00:00Z',ledgerStartedAt:'2026-09-22T09:00:00Z',readComplete:true,unresolvedSources:false}
}
