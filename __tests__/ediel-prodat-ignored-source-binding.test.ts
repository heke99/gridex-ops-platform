import {describe,expect,it} from 'vitest'
import {bindReceivedProdatIgnoredFields as bind} from '@/lib/ediel/core/receivedProdatIgnoredFieldBinding'
import {readStructuralMeasurementProjection} from '@/lib/ediel/sources/structuralSourceWire'
import {prodatErrorOccurrence} from '@/lib/ediel/prodat/prodatFieldDiagnostic'
import {prodatRegisterGroups} from '@/lib/ediel/prodat/prodatRegisterGroups'
import {tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {raw,line,common,characteristic,type Parts} from './fixtures/prodat-register'
import {timelineFacts} from './helpers/sourceDecisionTimelineFixtures'
import type {SourceObjectScope} from '@/lib/ediel/sources/sourceOwnerWire'
function fixture(){
 const body:Parts[]=[['NAD','FR',['12345','160','SVK']],['NAD','DO',['54321','160','SVK']],line('1','735123456789012345','1','9'),...common('A','Actual'),...characteristic('Z14','L639Q',3),...characteristic('Z16','HT',3),line('2','735123456789012345','2','9'),...characteristic('Z14','EXTRA',3),...characteristic('Z16','LT',3)]
 const wire=raw(body).replace('+S+R+','+12345:14+54321:14+'),ast=tokenizeEdifact(wire),groups=prodatRegisterGroups(ast.segments,ast.una,'Z04').groups,rawSegments=ast.segments.map(s=>s.raw)
 const ignored=(index:number)=>({fieldNumber:'242',sourceRule:'PRODAT26A:P119',occurrence:prodatErrorOccurrence({code:'Z04',rawSegments,una:ast.una},groups[index].segments.map(s=>s.raw),'object',index)!})
 const scope=timelineFacts(wire).objects[0].object as SourceObjectScope
 return {wire,ignored,scope}
}
describe('source-bound same-owner P119 ignored occurrence projection',()=>{
 it('preserves an actually present later-register exclusion without manufacturing an occurrence',()=>{
  const {wire,ignored}=fixture(),value=[ignored(1)]
  expect(bind(value,wire)).toEqual(value)
  expect(value[0].occurrence).toMatchObject({messageReference:'M',objectId:'735123456789012345',identityAgency:'9',lineIndex:1,lineNumber:'2',registerPosition:2})
  const absent=wire.replace("CCI++Z14'CAV+:::EXTRA'",'')
  expect(bind(value,absent)).toBeNull()
 })
 it('rejects a copied message/object/agency/register reference, duplicate or foreign authority',()=>{
  const {wire,ignored}=fixture(),field=ignored(1)
  for(const patch of [{messageReference:'OTHER'},{objectId:'FOREIGN'},{identityAgency:'89'},{lineIndex:0},{lineNumber:'1'},{registerPosition:1}])expect(bind([{...field,occurrence:{...field.occurrence,...patch}}],wire)).toBeNull()
  expect(bind([field,field],wire)).toBeNull();expect(bind([{...field,sourceRule:'claimed'}],wire)).toBeNull()
 })
 it('does not let later-register ignored extras suppress an allowed first-register value',()=>{
  const {wire,ignored,scope}=fixture()
  expect(readStructuralMeasurementProjection(wire,scope,[ignored(1)])?.productCode).toBe('L639Q')
  expect(readStructuralMeasurementProjection(wire,scope,[ignored(0)])?.productCode).toBeNull()
  expect(readStructuralMeasurementProjection(wire,scope)).toBeNull()
  expect(readStructuralMeasurementProjection(wire,scope,[])?.productCode).toBe('L639Q')
 })
})
