import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deriveProdatAperakValidationIssues, resolveAndStoreProdatAperakErrors } from '@/lib/ediel/testing/aperakErrorRuleRegistry'
import type { EdielTgtCaseTestData } from '@/lib/ediel/testing/tgtTestData'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { line, qty, raw, characteristic } from './fixtures/prodat-register'

const db = vi.hoisted(() => ({from:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:db}))
beforeEach(()=>{vi.clearAllMocks();db.from.mockImplementation(()=>{throw new Error('Unexpected DB write')})})
function data(values:Record<string,string>[]):EdielTgtCaseTestData {
 const columns=values.map((_,i)=>({name:`Z04D register ${i+1}`,index:i,sourceOrder:i,testCase:'1.2.5'}))
 const fields=[...new Set(values.flatMap(Object.keys))].map(fieldCode=>({fieldCode,fieldName:fieldCode,values:Object.fromEntries(values.map((row,i)=>[columns[i].name,row[fieldCode] ?? '']))}))
 const block={kind:'PRODAT' as const,sourceWorkbook:'synthetic',sourceSheet:'synthetic',entityLabel:'objects',entityNumbers:['A'],columns,fields}
 return {suite:'PRODAT',roleCode:'supplier',testCaseCode:'1.2.5',title:'Synthetic positive-code boundary',sourceNote:'Not portal certification',groups:[{block,columns,fields}]}
}
const message=(body:Parameters<typeof raw>[0])=>({id:'synthetic',company_id:'tenant-A',raw_payload:raw(body,'Z04'),message_family:'PRODAT',message_code:'Z04',direction:'inbound',environment:'test',parsed_payload:{}} as EdielMessageRow)
const expected=data([{'209':'A','258':'1','213':'10'},{'209':'A','258':'2','213':'20'}])
describe('register errors cannot disappear behind a known-positive TGT case label',()=>{
 it('keeps a correct two-register positive case positive',()=>{
  expect(deriveProdatAperakValidationIssues({message:message([line('1','A','1'),qty('10'),line('2','A','2'),qty('20')]),testData:expected})).toEqual([])
 })
 for(const [name,body] of [
  ['duplicate register index',[line('1','A','1'),qty('10'),line('2','A','1'),qty('20')]],
  ['missing second register',[line('1','A'),qty('10')]],
  ['wrong second quantity',[line('1','A','1'),qty('10'),line('2','A','2'),qty('10')]],
 ] as const) it(`requires explicit error-mapping review for ${name}`,()=>{
  expect(()=>deriveProdatAperakValidationIssues({message:message([...body]),testData:expected})).toThrow('PRODAT_REGISTER_ACK_REVIEW_REQUIRED')
 })
 it('does not resolve or store a fabricated positive acknowledgement for an unresolved register',async()=>{
  await expect(resolveAndStoreProdatAperakErrors({message:message([line('1','A'),qty('10')]),testData:expected})).rejects.toThrow('PRODAT_REGISTER_ACK_REVIEW_REQUIRED')
  expect(db.from).not.toHaveBeenCalled()
 })
 it('rejects wrong own constants even when the wrong value belongs to another register',()=>{
  const testData=data([{'209':'A','258':'1','214':'1'},{'209':'A','258':'2','214':'2'}])
  expect(()=>deriveProdatAperakValidationIssues({message:message([line('1','A','1'),qty('10'),...characteristic('Z02','1',3),line('2','A','2'),qty('20'),...characteristic('Z02','1',3)]),testData})).toThrow('PRODAT_REGISTER_ACK_REVIEW_REQUIRED')
 })
})
