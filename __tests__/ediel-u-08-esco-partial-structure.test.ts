// masterplan: U-08, AT-U-08, SC-049
import {describe,expect,it} from 'vitest'
import {runUtiltsRuntimeForMessage} from '@/lib/ediel/utiltsEngine'
import {resolveCanonicalEdielPolicy} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import {observationHandoffMessage} from './helpers/utiltsObservationHandoff'

const run=(applicationReference:string)=>{const source=observationHandoffMessage('2026-10-01')
 const message={...source,application_reference:applicationReference,raw_payload:source.raw_payload!.replace('23-DDQ-E66-S',applicationReference)}
 return runUtiltsRuntimeForMessage(message,{canonicalPolicy:resolveCanonicalEdielPolicy({family:'UTILTS',messageCode:'E66',direction:'inbound',
  referenceDate:'2026-10-01',applicationReference,mode:'parse'})})}

describe('U-08 an ESCO receiver is not required to hold the full supplier meter structure',()=>{
 it('an ESCO (DGI) E66 with register readings and no held structure gets no E61/E62, no ERR and no negative APERAK',()=>{
  const r=run('23-DGI-E66-S')
  expect(r.ackPlan.utiltsErrCodes).toEqual([])
  expect(r.ackPlan.shouldSendUtiltsErr).toBe(false)
  expect(r.ackPlan.aperakApplicationErrors).toEqual([])
  // The own evidence gap is handled internally (warning), never as a market rejection.
  expect(r.validation.issues.filter(i=>i.severity==='error')).toEqual([])
  expect(r.validation.issues.some(i=>/STRUCTURE/.test(i.code)&&i.severity==='error')).toBe(false)
 })
 it('the supplier (DDQ) receives the same message without structure-based rejection either',()=>{
  const r=run('23-DDQ-E66-S')
  expect(r.ackPlan.utiltsErrCodes).toEqual([])
  expect(r.ackPlan.aperakApplicationErrors).toEqual([])
 })
})
