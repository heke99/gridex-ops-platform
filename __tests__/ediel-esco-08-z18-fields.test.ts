// masterplan: ESCO-08, AT-ESCO-08
import {describe,expect,it} from 'vitest'
import {canonicalProdat26AFieldRules} from '@/lib/ediel/prodat/prodat26AFieldMatrix'
import {applyPermissionEvent} from '@/lib/ediel/permissions/permissionEngine'

const rule=(code:string,field:string)=>canonicalProdat26AFieldRules(code).find(r=>r.fieldNumber===field)

describe('ESCO-08 Z18 termination carries the permission reference, end reason and end time',()=>{
 it('fields 327 (end timestamp), 324 (end reason) and 325 (permission id) are required on Z18 and placed per line',()=>{
  expect(rule('Z18','327')).toMatchObject({segmentPath:'DTM+164'})
  expect(rule('Z18','324')).toMatchObject({segmentPath:'CCI++Z25/CAV'})
  expect(rule('Z18','325')).toMatchObject({segmentPath:'RFF+Z09'})
  const required=rule('Z18','327')!.requirement
  for(const field of ['324','325'])expect(rule('Z18',field)!.requirement).toBe(required)
  // The same three fields are not required on the original Z13 request.
  for(const field of ['324','325','327'])expect(rule('Z13',field)!.requirement).not.toBe(required)
 })
 it('after Z18 the permission awaits the DSO Z15; the market permission stays active until then',()=>{
  const sent=applyPermissionEvent({currentState:'active_after_z14v_or_z14vh',event:'z18_sent'})
  expect(sent).toBe('z18_sent')
  expect(applyPermissionEvent({currentState:sent,event:'z15_b80'})).toBe('z15_b80_termination')
  // A Z15C keeps reporting: the permission returns to active instead of ending.
  expect(applyPermissionEvent({currentState:sent,event:'z15_c_continues'})).toBe('active_after_z14v_or_z14vh')
 })
})
