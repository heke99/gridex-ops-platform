// masterplan: U-03, AT-U-03
// masterplan: ACK-03, AT-ACK-03
import {describe,expect,it} from 'vitest'
import {buildReceivedUtiltsHeaderValidation,bindReceivedUtiltsHeaderValidation} from '@/lib/ediel/core/receivedUtiltsHeaderValidation'
import {runUtiltsRuntimeForMessage} from '@/lib/ediel/utiltsEngine'
import {renderAperakEdiel} from '@/lib/ediel/aperakEngine'
import {segmentComposite,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {energyHandoffMessage} from './helpers/utiltsObservationHandoff'

describe('actual canonical UTILTS header facet',()=>{
  it('records the actual header owner and exactly matches decoded negative wire without ACW',()=>{
    const source=energyHandoffMessage();source.raw_payload=source.raw_payload!.replace('BGM+E66::260','BGM+E66::9')
    const runtime=runUtiltsRuntimeForMessage(source),facet=buildReceivedUtiltsHeaderValidation({source,headerRejection:runtime.ackPlan.utiltsHeaderRejection})!
    expect(facet.applicationErrors).toEqual([{ercCode:'42',fieldCode:'202',text:'INCORRECT DATA 9'}])
    expect(runtime.transactionDispositions.every(item=>item.disposition==='guide_rejected')).toBe(true)
    const rendered=renderAperakEdiel({source:{id:source.id,messageFamily:'UTILTS',messageCode:'E66',rawPayload:source.raw_payload,messageReceivedAt:source.message_received_at,createdAt:source.created_at},
      refs:{documentReference:'GRIDEX2607E66MSG001'},externalReference:'OWN-AP',transactionReference:'OWN-DM',outcome:'negative',applicationErrors:runtime.ackPlan.utiltsHeaderRejection!.applicationErrors,utiltsHeaderRejected:true})
    const wire=tokenizeEdifact(rendered.segments.map(segment=>segment+"'").join(''))
    const errors=wire.segments.flatMap((segment,index)=>segment.tag==='ERC' ? [{ercCode:segmentComposite(segment,1,wire.una)[0],fieldCode:segmentComposite(wire.segments[index+1],3,wire.una)[0],text:segmentComposite(wire.segments[index+1],4,wire.una)[0]}] : [])
    expect(errors).toEqual(facet.applicationErrors)
    expect(wire.segments.some(segment=>segment.tag==='RFF' && segmentComposite(segment,1,wire.una)[0]==='ACW')).toBe(false)
  })
  it('does not infer header scope from ordinary national errors or a transaction marker',()=>{
    const source=energyHandoffMessage(),runtime=runUtiltsRuntimeForMessage(source)
    expect(buildReceivedUtiltsHeaderValidation({source,headerRejection:runtime.ackPlan.utiltsHeaderRejection})).toBeNull()
    expect(buildReceivedUtiltsHeaderValidation({source,headerRejection:{applicationErrors:[{ercCode:'42',fieldCode:'516',text:'INCORRECT DATA',referenceQualifier:'ACW',referenceNumber:'GRIDEX2607E66001',lineItemReference:null}]}})).toBeNull()
  })
  it('binds only this source, preserving exact owner tuples without rewriting them',()=>{
    const source=energyHandoffMessage();source.raw_payload=source.raw_payload!.replace('BGM+E66::260','BGM+E66::9')
    const runtime=runUtiltsRuntimeForMessage(source),facet=buildReceivedUtiltsHeaderValidation({source,headerRejection:runtime.ackPlan.utiltsHeaderRejection})!
    expect(bindReceivedUtiltsHeaderValidation(facet,source.raw_payload!+' ')).toBeNull()
    for(const change of [{ercCode:'100'},{fieldCode:''},{text:' INCORRECT DATA'},{text:'X\nY'},{extra:true}]) {
      // Deliberately mutable malicious copy; it cannot impersonate the immutable owner.
      const copy=structuredClone(facet) as unknown as {applicationErrors:Array<Record<string,unknown>>};Object.assign(copy.applicationErrors[0],change)
      expect(bindReceivedUtiltsHeaderValidation(copy,source.raw_payload!)).toBeNull()
    }
    expect(buildReceivedUtiltsHeaderValidation({source:{...source,message_family:'PRODAT'},headerRejection:runtime.ackPlan.utiltsHeaderRejection})).toBeNull()
  })
})
