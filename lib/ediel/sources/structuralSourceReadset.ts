import {isDeepStrictEqual} from 'node:util'
import {inspectReceivedSourceDecisionTimeline, type SourceDecisionTimeline, type RecordedSourceAssessment} from './receivedSourceDecisionTimeline'
import {readStructuralSourceWire} from './structuralSourceWire'
import {isReviewedStructuralBusiness, type ReviewedStructuralBusiness} from './reviewedStructuralSource'
import {projectProdatRegisterValidation} from '@/lib/ediel/prodat/prodatRegisterValidationEvidence'
import {tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {singleMessage} from '@/lib/ediel/utilts/receivedStructuralSources'
import type {ReceivedSourceScope} from '@/lib/ediel/utilts/durableSourceDiscovery'
import type {SourceObjectScope} from './sourceOwnerWire'
import type {StructuralVersion} from './structuralSourceSelection'
import {isReviewedClosureBusiness} from './reviewedClosureSource'
import {closureImpact} from './closureImpact'
import type {ClosureVersion,ScopedClosureBlocker} from './closureSelection'
import type {CorrectionContextBlockerV1} from './correctionContextImpact'

type ObjectEntry={object:SourceObjectScope;disposition:'accepted'|'unavailable'|'rejected';reasons:string[];business:Record<string,unknown>|null;party:Record<string,unknown>|null}
type RawAssessment={id:string;factsText:string;factsHash:string;availableAt:string|null}
type RawSource={sourceMessageId:string;rawPayload:string|null;payloadHash:string|null;messageCode:string|null;assessments:RawAssessment[]}
export type StructuralReadset={
  timeline:SourceDecisionTimeline; versions:StructuralVersion[];closures:ClosureVersion[];closureBlockers:ScopedClosureBlocker[];
  correctionContextBlockers:CorrectionContextBlockerV1[];unresolvedSources:boolean
  sources:{sourceMessageId:string;rawPayload:string;payloadHash:string;asOf:RecordedSourceAssessment|null;objects:ObjectEntry[];assessments:RawAssessment[]}[]
}

/** Lossless follow-up projection of a fully checked service snapshot. This pure
 * helper is deliberately not a transferable authorization. It rereads original
 * bytes and never uses mutable message status or incoming UTILTS identifiers. */
export function inspectStructuralReadset(scope:ReceivedSourceScope,receipt:unknown,handledCorrections:ReadonlySet<string>=new Set()):StructuralReadset {
  const timeline=inspectReceivedSourceDecisionTimeline(scope,receipt)
  const result:StructuralReadset={timeline,versions:[],closures:[],closureBlockers:[],correctionContextBlockers:[],unresolvedSources:true,sources:[]}
  if(timeline.status!=='inspected'||!timeline.boundedReadComplete)return result
  const body=JSON.parse((receipt as {readsetText:string}).readsetText) as {sources:RawSource[]}
  result.unresolvedSources=false
  try{
    let segments=0
    for(const source of body.sources){
      const recorded=timeline.sources.find(item=>item.sourceMessageId===source.sourceMessageId)!
      if(!source.rawPayload||!source.payloadHash){result.unresolvedSources=true;continue}
      const ast=singleMessage(source.rawPayload,'PRODAT')
      if(!ast||ast.messages[0].messageCode!==source.messageCode){result.unresolvedSources=true;continue}
      segments+=ast.segments.length
      if(segments>32768)return {...result,versions:[],sources:[],unresolvedSources:true}
      // These known processes carry no received meter/register inventory.
      if(['Z01','Z02','Z03','Z09','Z13','Z14','Z15','Z18'].includes(source.messageCode??''))continue
      // A witnessed raw C captured by the correction owner is projected as a
      // scoped hold from the SAME combined snapshot. It is never a closure.
      if(source.messageCode==='Z05'&&handledCorrections.has(source.sourceMessageId))continue
      // End/cancellation messages are not guessed into a positive structural
      // approval. A closure owner is needed if such a message affects coverage.
      if(!['Z04','Z05','Z06','Z10'].includes(source.messageCode??'')){result.unresolvedSources=true;continue}
      const asOf=recorded.asOf
      const row=asOf?source.assessments.find(assessment=>assessment.id===asOf.assessmentId):null
      const objects:ObjectEntry[]=row?(JSON.parse(row.factsText) as {objects:ObjectEntry[]}).objects:[]
      result.sources.push({sourceMessageId:source.sourceMessageId,rawPayload:source.rawPayload,payloadHash:source.payloadHash,asOf,objects,assessments:source.assessments})
      const rawSegments=tokenizeEdifact(source.rawPayload).segments.map(segment=>segment.raw)
      const physical=projectProdatRegisterValidation({code:source.messageCode!,rawSegments,una:ast.una,
        registerIssues:[],fieldIssues:[],completeRuleSelection:false,handledFields:new Set()})
      if(!physical.objects.length){result.unresolvedSources=true;continue}
      for(const physicalObject of physical.objects){
        const {disposition,reasons,...object}=physicalObject
        // These are geometric projection placeholders, not approved decisions.
        void disposition;void reasons
        const entry=objects.find(item=>isDeepStrictEqual(item.object,object))
        if(source.messageCode==='Z05'){
          const impact=closureImpact(source.rawPayload,object,source.sourceMessageId)
          if(!impact){result.unresolvedSources=true;continue}
          if(asOf&&entry?.disposition==='accepted'&&isReviewedClosureBusiness(entry.business,source.rawPayload,object)){
            result.closures.push({sourceMessageId:source.sourceMessageId,payloadHash:source.payloadHash,assessmentId:asOf.assessmentId,
              factsHash:asOf.factsHash,availableAt:asOf.availableAt,disposition:'accepted',wire:entry.business.wire,marker:entry.business})
          }else result.closureBlockers.push({...impact,reason:entry?.disposition==='rejected'?'closure_rejected':impact.reason})
          continue
        }
        const wire=readStructuralSourceWire(source.rawPayload,object)
        if(!wire){if(entry?.disposition!=='rejected')result.unresolvedSources=true;continue}
        const business=entry?.business
        const reviewed=isReviewedStructuralBusiness(business,source.rawPayload,object)?business:null
        result.versions.push({sourceMessageId:source.sourceMessageId,payloadHash:source.payloadHash,assessmentId:asOf?.assessmentId??null,
          factsHash:asOf?.factsHash??null,availableAt:asOf?.availableAt??null,wire,disposition:entry?.disposition??'unavailable',
          coverage:reviewed?.coverageWindow??null,replaces:reviewed?.replaces??null})
      }
    }
    return result
  }catch{return {...result,versions:[],sources:[],unresolvedSources:true}}
}

export function reviewedBusinessFor(readset:StructuralReadset,sourceMessageId:string,object:SourceObjectScope):ReviewedStructuralBusiness|null {
  const source=readset.sources.find(item=>item.sourceMessageId===sourceMessageId)
  const entry=source?.objects.find(item=>isDeepStrictEqual(item.object,object))
  return source&&entry?.disposition==='accepted'&&isReviewedStructuralBusiness(entry.business,source.rawPayload,object)?entry.business:null
}
