import {describe,it,expect} from 'vitest'
import {bilateralCustomerNativeWire} from '../scripts/helpers/ediel-bilateral-customer-native-wire'
import {parseProdatMessage,parsedProdatObjects} from '@/lib/ediel/prodat/parser'
import {validateEdielMessageRowWithRulebook} from '@/lib/ediel/rulebook/validator'
import {source} from './fixtures/prodat-identity'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
describe('independent native Z06E original-field oracle',()=>{
 for(const repeatRegister of [false,true])it(`validates the complete first-register customer/invoicee and repeated=${repeatRegister}`,()=>{
  const wire=bilateralCustomerNativeWire({sender:'12345',receiver:'54321',point:'735123456789012345',customerIdentity:'199001011234',reference:'SYNTHETIC-OWN',repeatRegister,invoicee:true})
  const message={...source(wire,'Z06'),company_id:'00000000-0000-4000-8000-000000000021',message_received_at:'2026-10-01T12:00:00Z'}
  const report=validateEdielMessageRowWithRulebook(message,'parse')
  expect(report.issues.filter(issue=>issue.blocking)).toEqual([])
  const objects=parsedProdatObjects(parseProdatMessage(wire));expect(objects).toHaveLength(1)
  expect(objects[0].registers).toHaveLength(repeatRegister?2:1)
  expect(objects[0].registers[0]).toMatchObject({reasonForTransaction:'E34',endUserId:'199001011234',invoiceeName:'SYNTHETIC INVOICEE',validityStartDate:'202610050000',lineItemReference:'SYNTHETIC-OWN'})
  const tokens=tokenizeEdifact(wire),unb=tokens.segments.find(segment=>segment.tag==='UNB')!
  expect(segmentComposite(unb,9,tokens.una)).toEqual(['1']);expect(segmentComposite(unb,11,tokens.una)).toEqual(['1'])
 })
})
