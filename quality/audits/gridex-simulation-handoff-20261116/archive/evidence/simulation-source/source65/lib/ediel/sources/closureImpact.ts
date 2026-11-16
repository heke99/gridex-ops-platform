import {isDeepStrictEqual} from 'node:util'
import {singleMessage,legalParty} from '@/lib/ediel/utilts/receivedStructuralSources'
import {segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {prodatRegisterGroups} from '@/lib/ediel/prodat/prodatRegisterGroups'
import {prodatMarketMinuteToUtc} from '@/lib/ediel/prodat/render/dates'
import type {SourceObjectScope} from './sourceOwnerWire'
import type {ScopedClosureBlocker} from './closureSelection'

/** Conservative impact only, never approval. Missing components are wildcards;
 * an unlocated physical object cannot be classified as unrelated. */
export function closureImpact(raw:string,object:SourceObjectScope,sourceMessageId:string):ScopedClosureBlocker|null{
  try{
    const ast=singleMessage(raw,'PRODAT')
    if(!ast||ast.messages[0].messageCode!=='Z05'||!object.objectId||object.messageIndex!==0)return null
    const groups=prodatRegisterGroups(ast.segments,ast.una).groups.filter(group=>group.itemId===object.objectId&&group.identityAgency===object.identityAgency)
    const registers=groups.map(group=>({lineIndex:group.lineIndex,lineNumber:group.lineNumber,registerIndex:group.registerIndex,registerPosition:group.registerPosition,segmentIndex:group.segments[0].index}))
    if(!groups.length||!isDeepStrictEqual(registers,object.registers)||object.messageReference!==ast.messages[0].messageReference)return null
    const part=(segment:typeof ast.segments[number],index:number)=>segmentComposite(segment,index,ast.una)
    const body=groups[0].segments,firstReference=body.findIndex(segment=>['RFF','NAD'].includes(segment.tag))
    const common=firstReference<0?body:body.slice(0,firstReference)
    const dates=common.filter(segment=>segment.tag==='DTM'&&part(segment,1)[0]==='93').map(segment=>part(segment,1))
    const firstLine=ast.segments.findIndex(segment=>segment.tag==='LIN'),header=ast.segments.slice(0,firstLine)
    const zones=header.filter(segment=>segment.tag==='DTM'&&part(segment,1)[0]==='ZZZ').map(segment=>part(segment,1))
    const bgm=header.filter(segment=>segment.tag==='BGM'),fn=bgm.length===1?part(bgm[0],3):null
    // An unqualified correction may move an older stop in either direction.
    // Its proposed date cannot define the earliest affected interval.
    const original=fn?.length===1&&['','9'].includes(fn[0])
    const lowerBound=original&&groups.length===1&&dates.length===1&&dates[0].length===3&&dates[0][2]==='203'
      &&zones.length===1&&isDeepStrictEqual(zones[0],['ZZZ','1','805'])?prodatMarketMinuteToUtc(dates[0][1]):null
    return {sourceMessageId,objectId:object.objectId,identityAgency:object.identityAgency,
      legalSender:legalParty(ast,'FR','LIN',['160','SVK']),legalReceiver:legalParty(ast,'DO','LIN',['160','SVK']),lowerBound,reason:'closure_unsupported'}
  }catch{return null}
}
