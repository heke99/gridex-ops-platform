// masterplan: SC-045, SC-048
// SC-045: a wrong mandatory national header field gives a header-level
// negative U-APERAK, runs no functional checks (no E10) and invents no
// transaction reference. SC-048: with a correct sender and object, a broken
// period rule yields UTILTS-ERR E50 rather than a generic E10.
import {describe,expect,it} from 'vitest'
import {runUtiltsRuntimeForMessage} from '@/lib/ediel/utiltsEngine'
import {energyHandoffMessage,observationHandoffMessage} from './helpers/utiltsObservationHandoff'

const run=(raw_payload:string,source=energyHandoffMessage('2026-10-01'))=>runUtiltsRuntimeForMessage({...source,raw_payload},{referenceDate:'2026-10-01'})

describe('SC-045 UTILTS header error',()=>{
 it('reports the header field without a transaction reference and runs no functional check, even with a later object error',()=>{
  const source=energyHandoffMessage('2026-10-01')
  const r=run(source.raw_payload!.replace("DTM+735:?+0200:406'","DTM+735:XX:406'").replace('LOC+172+735999260731000007::9','LOC+172+735999260731000008::9'),source)
  const header=r.ackPlan.aperakApplicationErrors.find(e=>e.fieldCode==='206')
  expect(header).toMatchObject({ercCode:'42',referenceQualifier:null,referenceNumber:null,lineItemReference:null})
  expect(r.ackPlan.utiltsErrCodes).toEqual([])
  expect(r.ackPlan.shouldSendUtiltsErr).toBe(false)
  expect(r.validation.issues.some(i=>i.kind==='functional'&&i.severity==='error')).toBe(false)
  // Any transaction reference used is the physical IDE, never a synthesized one.
  for(const e of r.ackPlan.aperakApplicationErrors.filter(x=>x.referenceNumber))expect(e.referenceNumber).toBe('GRIDEX2607E66001')
 })
})

describe('SC-048 wrong period, correct object',()=>{
 it('a registration time before the latest meter reading gives E50, not E10',()=>{
  const source=observationHandoffMessage('2026-10-01')
  const r=run(source.raw_payload!.replace('DTM+597:202608010000:203','DTM+597:202607150000:203'),source)
  expect(r.ackPlan.utiltsErrCodes).toEqual(['E50'])
  expect(r.validation.issues.filter(i=>i.severity==='error').map(i=>[i.utiltsErrCode,i.kind])).toEqual([['E50','functional']])
  expect(run(source.raw_payload!,source).ackPlan.utiltsErrCodes).toEqual([])
 })
})
