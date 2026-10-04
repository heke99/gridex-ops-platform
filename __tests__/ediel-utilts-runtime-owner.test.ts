import {describe,expect,it} from 'vitest'
import {runUtiltsRuntimeForMessage,takeUtiltsRuntimeOwner} from '@/lib/ediel/utiltsEngine'
import {qualifyReceivedUtiltsStructure} from '@/lib/ediel/utilts/qualifyReceivedStructure'
import {resolveCanonicalMessagePolicy} from '@/lib/ediel/core/messagePolicy'
import {energyHandoffMessage} from './helpers/utiltsObservationHandoff'

describe('final UTILTS runtime owner handoff',()=>{
  it('requires exact invocation, immutable source/result and retained policy pointer',()=>{
    const message=energyHandoffMessage(),policy=resolveCanonicalMessagePolicy(message)!
    const runtime=runUtiltsRuntimeForMessage(message,{canonicalPolicy:policy})
    expect(takeUtiltsRuntimeOwner(structuredClone(runtime),message,policy)).toBeNull()
    expect(takeUtiltsRuntimeOwner(runtime,message,policy)).toEqual(runtime)
    expect(takeUtiltsRuntimeOwner(runtime,message,policy)).toBeNull()
    const mutated=runUtiltsRuntimeForMessage(message,{canonicalPolicy:policy});mutated.transactionDispositions[0].responseType='none'
    expect(takeUtiltsRuntimeOwner(mutated,message,policy)).toBeNull()
    const altered=runUtiltsRuntimeForMessage(message,{canonicalPolicy:policy})
    expect(takeUtiltsRuntimeOwner(altered,{...message,metering_point_id:'forged'},policy)).toBeNull()
    const different=runUtiltsRuntimeForMessage(message,{canonicalPolicy:policy})
    expect(takeUtiltsRuntimeOwner(different,message,structuredClone(policy))).toBeNull()
  })
  it('guide-only candidates cannot acquire final owner authority',()=>{
    const message=energyHandoffMessage(),policy=resolveCanonicalMessagePolicy(message)!
    expect(takeUtiltsRuntimeOwner(runUtiltsRuntimeForMessage(message,{canonicalPolicy:policy,guideOnly:true}),message,policy)).toBeNull()
  })
  it('the actual structural owner seals its own qualified result without caller approvals',async()=>{
    const message=energyHandoffMessage(),policy=resolveCanonicalMessagePolicy(message)!
    const runtime=runUtiltsRuntimeForMessage(message,{canonicalPolicy:policy})
    const qualified=await qualifyReceivedUtiltsStructure({message,canonicalPolicy:policy,runtime})
    expect(takeUtiltsRuntimeOwner(structuredClone(qualified.runtime),message,policy)).toBeNull()
    expect(takeUtiltsRuntimeOwner(qualified.runtime,message,policy)).toEqual(qualified.runtime)
    expect(takeUtiltsRuntimeOwner(qualified.runtime,message,policy)).toBeNull()
    const forged=await qualifyReceivedUtiltsStructure({message,canonicalPolicy:policy,runtime:structuredClone(runtime)})
    expect(takeUtiltsRuntimeOwner(forged.runtime,message,policy)).toBeNull()
  })
})
