import {isDeepStrictEqual} from 'node:util'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {prodatRegisterGroups} from '@/lib/ediel/prodat/prodatRegisterGroups'
import {prodatErrorOccurrence} from '@/lib/ediel/prodat/prodatFieldDiagnostic'
import {canonicalProdatFieldWireDescriptor} from '@/lib/ediel/rulebook/canonicalEdielFacade'
import {fieldRulePresent,type ProdatIgnoredField,type RulebookFieldRule} from '@/lib/ediel/rulebook/fieldMatrix'
import {isEvidenceRecord} from '@/lib/ediel/utilts/durableSourceDiscovery'

/** Bind the SAME fresh canonical owner's ignore decisions to original physical
 * occurrences. This checks serialization/presence only; no usage/D/version
 * decision is made here and no rejected or ignored value becomes approval. */
export function bindReceivedProdatIgnoredFields(value:unknown,raw:string):ProdatIgnoredField[]|null {
 if(!Array.isArray(value)||value.length>8192)return null
 try{
  const {segments,una}=tokenizeEdifact(raw),rawSegments=segments.map(segment=>segment.raw)
  if(segments.length>8192)return null
  const messages=segments.filter(segment=>segment.tag==='UNH')
  if(messages.length!==1||segmentComposite(messages[0],2,una)[0]!=='PRODAT')return null
  const code=segmentComposite(segments.find(segment=>segment.tag==='BGM'),1,una)[0]??''
  const groups=prodatRegisterGroups(segments,una,code).groups,seen=new Set<string>()
  for(const field of value){
   if(!isEvidenceRecord(field)||Object.keys(field).length!==3||!['fieldNumber','sourceRule','occurrence'].every(key=>Object.hasOwn(field,key))
    ||field.sourceRule!=='PRODAT26A:P119'||typeof field.fieldNumber!=='string'||!isEvidenceRecord(field.occurrence))return null
   const descriptor=canonicalProdatFieldWireDescriptor(field.fieldNumber)
   if(!descriptor)return null
   const scope=field.occurrence.scope
   if(!['header','object','register'].includes(String(scope)))return null
   const lineIndex=field.occurrence.lineIndex
   const group=scope==='header'?null:groups.find(item=>item.lineIndex===lineIndex)
   if(scope!=='header'&&!group)return null
   const physical=scope==='header'?rawSegments:group!.segments.map(segment=>segment.raw)
   // Metadata-only field reader; frozen requirement columns are deliberately
   // not consulted. The canonical owner has already decided to ignore it.
   const presence:RulebookFieldRule={family:'PRODAT',code,fieldNumber:descriptor.fieldNumber,fieldKey:descriptor.fieldKey,label:descriptor.fieldKey,segmentPath:descriptor.segmentPath,requirement:'forbidden',source:'static'}
   if(!fieldRulePresent(presence,{code,rawSegments:physical,una,applicationReference:segmentComposite(segments.find(segment=>segment.tag==='UNB'),7,una)[0]??null}))return null
   const actual=prodatErrorOccurrence({code,rawSegments,una},physical,scope as 'header'|'object'|'register',group?.lineIndex)
   if(!actual||!isDeepStrictEqual(actual,field.occurrence))return null
   const key=JSON.stringify(field)
   if(seen.has(key))return null
   seen.add(key)
  }
  return structuredClone(value) as ProdatIgnoredField[]
 }catch{return null}
}
