import {expect,it} from 'vitest'
import {resolveCanonicalRuntimeDecision} from '@/lib/ediel/core/runtimeDecision'
import {raw,line,characteristic,type Parts} from './fixtures/prodat-register'
import {head,source} from './fixtures/prodat-identity'

// P26.A p13, field211 p50 and closure process p123: Z05 does not
// carry register inventory. Its actual physical LIN still needs validation.
it.each(['Z22','Z23'])('canonical Z05/%s retains accepted physical membership',reason=>{
  const body:Parts[]=[...head(),line('1','735123456789012345',undefined,'9'),
    ['DTM',['93','202610151234','203']],...characteristic('Z13',reason),
    ['RFF',['Z05','NET-1']],['RFF',['LI','CLOSE-1']],
    ['NAD','UD',['CUSTOMER-1','','89'],'','Synthetic','Street','City','','12345','SE'],
    ['NAD','IT',['735123456789012345','','9'],'','','Street','Town','','12345','SE'],
    ['NAD','Z02',['11111','160','SVK']]]
  const wire=raw(body,'Z05').replace('+S+R+','+12345:14+54321:14+')
  const result=resolveCanonicalRuntimeDecision(source(wire,'Z05'))
  expect([result.syntaxDecision,result.applicationDecision,result.functionalDecision],JSON.stringify(result.issues)).toEqual(['accepted','accepted','accepted'])
  expect(result.prodatRegisterValidation?.objects).toEqual([{
    messageIndex:0,messageReference:'M',objectId:'735123456789012345',identityAgency:'9',
    disposition:'accepted',reasons:[],registers:[{lineIndex:0,lineNumber:'1',registerIndex:null,registerPosition:1,segmentIndex:7}],
  }])
})
