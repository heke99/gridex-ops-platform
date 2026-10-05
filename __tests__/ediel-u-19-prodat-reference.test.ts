// masterplan: U-19
import {describe,expect,it} from 'vitest'
import {runUtiltsRuntimeForMessage} from '@/lib/ediel/utiltsEngine'
import {resolveCanonicalEdielPolicy} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import {energyHandoffMessage} from './helpers/utiltsObservationHandoff'
import {recountEdifactUnt} from './helpers/recountEdifactUnt'
import type {EdielMessageRow} from '@/lib/ediel/types'

const run=(message:EdielMessageRow)=>runUtiltsRuntimeForMessage(message,{canonicalPolicy:resolveCanonicalEdielPolicy({family:'UTILTS',
 messageCode:'E66',direction:'inbound',referenceDate:'2026-10-01',applicationReference:message.application_reference,mode:'parse'})})
const outcome=(message:EdielMessageRow)=>{const r=run(message);return {errors:r.ackPlan.aperakApplicationErrors,codes:r.ackPlan.utiltsErrCodes,
 issues:r.validation.issues.filter(i=>i.severity==='error').map(i=>i.code)}}
const withReference=(rff:string)=>{const source=energyHandoffMessage('2026-10-01')
 const raw_payload=recountEdifactUnt(source.raw_payload!.replace("MEA+AAZ++KWH'","MEA+AAZ++KWH'\n"+rff))
 expect(raw_payload).toContain(rff);return {...source,raw_payload}}

describe('U-19 a PRODAT case reference (field 226) is never a mandatory authorization key for E66',()=>{
 it('an E66 without, with an unknown, or with a non-TN reference gets the same validation and ACK outcome',()=>{
  const control=outcome(energyHandoffMessage('2026-10-01'))
  for(const rff of ["RFF+TN:PRODAT-CASE-THAT-DOES-NOT-EXIST'","RFF+ZZZ:OTHER-QUALIFIER'"])
   expect(outcome(withReference(rff))).toEqual(control)
 })
})
