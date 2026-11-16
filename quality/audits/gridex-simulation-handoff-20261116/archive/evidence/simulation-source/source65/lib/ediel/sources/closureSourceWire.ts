import {isDeepStrictEqual} from 'node:util'
import {tokenizeEdifact,segmentComposite,segmentElementCount,segmentUntrimmedRaw} from '@/lib/ediel/core/edifactTokenizer'
import {prodatRegisterGroups} from '@/lib/ediel/prodat/prodatRegisterGroups'
import {prodatMarketMinuteToUtc} from '@/lib/ediel/prodat/render/dates'
import type {SourceObjectScope} from './sourceOwnerWire'

export type ClosureSourceWire={
  object:SourceObjectScope;messageCode:'Z05';subtype:'L'|'LK';reason:'Z22'|'Z23';functionCode:'9'|null
  documentReference:string;caseReference:string
  effectiveTo:{fieldNumber:'211';marketMinute:string;utc:string}
  legalSender:string;legalReceiver:string;transportSender:string;transportReceiver:string
  transportSenderQualifier:'14'|'ZZ';transportReceiverQualifier:'14'|'ZZ'
}

/** Bounded original-wire observation, never an approval. The database derives
 * this projection independently from its sealed original before accepting any
 * future closure owner. Unsupported forms stay held, not national rejections.
 * Syntax3 with space reserved UNA only; no repetition grammar is inferred. */
export function readClosureSourceWire(raw:string,scope:SourceObjectScope):ClosureSourceWire|null {
  try{
    if(Buffer.byteLength(raw,'utf8')>262144||raw.replace(/\r\n/g,'').includes('\r'))return null
    if(raw.toUpperCase().startsWith('UNA')&&(raw.length<9||!raw.startsWith('UNA')))return null
    const {una,segments}=tokenizeEdifact(raw)
    const active=[una.componentDataElementSeparator,una.dataElementSeparator,una.releaseCharacter,una.segmentTerminator]
    if(new Set(active).size!==4||active.some(ch=>!/^[!-/:-@[-`{-~]$/.test(ch))
      ||!['.',','].includes(una.decimalMark)||active.includes(una.decimalMark)||una.repetitionSeparator!==' '
      ||!raw.replace(/\r?\n/g,'').endsWith(una.segmentTerminator)||!segments.length||segments.length>4096)return null
    for(const segment of segments){
      // Trim parity: only surrounding ASCII space/tab is supported. Bare CR,
      // Unicode/control whitespace and release-trim ambiguity stay unavailable.
      const original=segmentUntrimmedRaw(segment)
      if(!/^[A-Z]{3}$/.test(segment.tag)||segment.tag==='UNA'||!segment.raw.startsWith(segment.tag)
        ||original!==original.trimEnd()||original.replace(/^[ \t]*/,'')!==segment.raw||segmentElementCount(segment,una)>127)return null
      for(let i=0;i<=segmentElementCount(segment,una);i++){
        const components=segmentComposite(segment,i,una)
        if(components.length>128||components.some(value=>[...value].length>4096))return null
      }
    }
    const byTag=(tag:string)=>segments.filter(segment=>segment.tag===tag)
    if(['UNB','UNH','UNT','UNZ','BGM'].some(tag=>byTag(tag).length!==1))return null
    const unb=byTag('UNB')[0],unh=byTag('UNH')[0],unt=byTag('UNT')[0],unz=byTag('UNZ')[0],bgm=byTag('BGM')[0]
    const value=(segment:typeof unb,index:number)=>segmentComposite(segment,index,una)
    const scalar=(segment:typeof unb,index:number)=>{const c=value(segment,index);return c.length===1?c[0]:null}
    const lines=byTag('LIN'),first=lines[0]
    if(!first||lines.length>16||unb.index!==0||unh.index!==1||unt.index!==segments.length-2||unz.index!==segments.length-1
      ||bgm.index<=unh.index||bgm.index>=first.index||value(unb,1)[1]!=='3'||value(unh,2)[0]!=='PRODAT'
      ||!scalar(unh,1)||scalar(unt,2)!==scalar(unh,1)||scalar(unt,1)!==String(unt.index-unh.index+1)
      ||scalar(unz,1)!=='1'||!scalar(unb,5)||scalar(unz,2)!==scalar(unb,5)||scalar(bgm,1)!=='Z05'
      ||!scalar(bgm,2)||!['9',''].includes(scalar(bgm,3)??'invalid'))return null
    const header=segments.slice(unh.index+1,first.index)
    const legal=(role:string)=>{
      const matches=header.filter(segment=>segment.tag==='NAD'&&scalar(segment,1)===role)
      if(matches.length!==1)return null
      const c=value(matches[0],2)
      return c.length===3&&c[0]&&c[0]===c[0].trim()&&c[1]==='160'&&c[2]==='SVK'?c[0]:null
    }
    const legalSender=legal('FR'),legalReceiver=legal('DO'),sender=value(unb,2),receiver=value(unb,3)
    const zones=header.filter(segment=>segment.tag==='DTM'&&value(segment,1)[0]==='ZZZ')
    if(!legalSender||!legalReceiver||sender.length!==2||receiver.length!==2||sender[0]!==legalSender||!receiver[0]
      ||receiver[0]!==receiver[0].trim()||!['14','ZZ'].includes(sender[1])||!['14','ZZ'].includes(receiver[1])
      ||zones.length!==1||!isDeepStrictEqual(value(zones[0],1),['ZZZ','1','805']))return null
    const grouped=prodatRegisterGroups(segments,una)
    if(grouped.problems.length||grouped.groups.some(group=>!group.itemId||group.identityAgency!=='9'||group.registerCount!==1||group.registerIndex!==null))return null
    if(lines.some((segment,index)=>segmentElementCount(segment,una)!==3||value(segment,3).length!==4
      ||value(segment,3)[1]!==''||value(segment,3)[2]!==''||scalar(segment,1)!==String(index+1)))return null
    const selected=grouped.groups.filter(group=>group.itemId===scope.objectId&&group.identityAgency===scope.identityAgency)
    if(selected.length!==1)return null
    const group=selected[0]
    const object:SourceObjectScope={messageIndex:0,messageReference:scalar(unh,1),objectId:group.itemId,identityAgency:group.identityAgency,
      registers:[{lineIndex:group.lineIndex,lineNumber:group.lineNumber,registerIndex:null,registerPosition:1,segmentIndex:group.segments[0].index}]}
    if(!isDeepStrictEqual(scope,object))return null
    const body=group.segments,referenceStart=body.findIndex(segment=>['RFF','NAD'].includes(segment.tag))
    const common=referenceStart<0?body:body.slice(0,referenceStart)
    const dates=common.filter(segment=>segment.tag==='DTM'&&value(segment,1)[0]==='93')
    const reasonIndexes=common.flatMap((segment,index)=>segment.tag==='CCI'&&scalar(segment,2)==='Z13'?[index]:[])
    if(dates.length!==1||reasonIndexes.length!==1)return null
    const date=value(dates[0],1),reasonSegment=common[reasonIndexes[0]+1]
    if(date.length!==3||date[2]!=='203'||reasonSegment?.tag!=='CAV')return null
    const reason=scalar(reasonSegment,1),utc=prodatMarketMinuteToUtc(date[1])
    const nad=body.findIndex(segment=>segment.tag==='NAD')
    const refs=(nad<0?body:body.slice(0,nad)).filter(segment=>segment.tag==='RFF'&&value(segment,1)[0]==='LI')
    if(!utc||!['Z22','Z23'].includes(reason??'')||refs.length!==1||value(refs[0],1).length!==2||!value(refs[0],1)[1])return null
    return {object,messageCode:'Z05',subtype:reason==='Z22'?'L':'LK',reason:reason as 'Z22'|'Z23',
      functionCode:scalar(bgm,3)==='9'?'9':null,documentReference:scalar(bgm,2)!,caseReference:value(refs[0],1)[1],
      effectiveTo:{fieldNumber:'211',marketMinute:date[1],utc},legalSender,legalReceiver,transportSender:sender[0],transportReceiver:receiver[0],
      transportSenderQualifier:sender[1] as '14'|'ZZ',transportReceiverQualifier:receiver[1] as '14'|'ZZ'}
  }catch{return null}
}
