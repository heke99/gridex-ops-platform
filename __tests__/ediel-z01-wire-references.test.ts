import {describe,expect,it} from 'vitest'
import {allocateZ01WireReferences,z01WireReferencesFromIntent} from '@/lib/ediel/prodat/z01WireReferences'
import type {EdielMessageIntent} from '@/lib/ediel/intent/types'

const intent:EdielMessageIntent={id:'intent',companyId:'company',environment:'test',market:'electricity',messageFamily:'PRODAT',messageCode:'Z01',businessProcess:'customer_masterdata',direction:'outbound',senderEdielId:'12345',receiverEdielId:'54321',applicationReference:'23-DDQ-PRODAT',routeProfileId:'profile',communicationRouteId:'route',customerId:'customer',customerSiteId:'site',operationId:'operation',interchangeReference:'12345678901234',messageReference:'1',transactionReference:'OWN-LI',payload:{documentReference:'OWN-DOCUMENT'},idempotencyKey:'operation',validationStatus:'validated',renderStatus:'not_rendered',outboxStatus:'not_queued'}

describe('Z01 references are allocated before and frozen by the actual intent',()=>{
 it('allocates bounded UNB and full UUID BGM/LI entropy in separate namespaces',()=>{
  const first=allocateZ01WireReferences(),second=allocateZ01WireReferences()
  expect(first.interchangeReference).toMatch(/^[A-F0-9]{14}$/)
  expect(first.messageReference).toBe('1')
  expect(first.documentReference).toMatch(/^Z01[A-F0-9]{32}$/)
  expect(first.transactionReference).toMatch(/^LI[A-F0-9]{32}$/)
  expect(first).not.toEqual(second)
 })
 it('preserves full 35-character original document and LI references including release characters',()=>{
  const selected={documentReference:'D'.repeat(34)+'+',transactionReference:'L'.repeat(33)+"?'"}
  expect(allocateZ01WireReferences(selected)).toMatchObject(selected)
  expect(z01WireReferencesFromIntent({...intent,transactionReference:selected.transactionReference,payload:{documentReference:selected.documentReference}})).toMatchObject(selected)
 })
 it('rejects oversized or altered selected originals without truncation',()=>{
  for(const value of ['D'.repeat(36),' OWN ','OWN\nREF','']){
   expect(()=>allocateZ01WireReferences({documentReference:value})).toThrow('z01_document_reference_invalid')
   expect(()=>allocateZ01WireReferences({transactionReference:value})).toThrow('z01_transaction_reference_invalid')
  }
 })
 it('reads the same actual persisted intent references on idempotent reuse',()=>{
  const expected={documentReference:'OWN-DOCUMENT',transactionReference:'OWN-LI',interchangeReference:'12345678901234',messageReference:'1'}
  expect(z01WireReferencesFromIntent(intent)).toEqual(expected)
  expect(z01WireReferencesFromIntent({...intent,renderStatus:'rendered',outboxStatus:'queued',edielMessageId:'original'})).toEqual(expected)
 })
 it('does not infer a document from UNB/UNH or replace malformed frozen references',()=>{
  expect(()=>z01WireReferencesFromIntent({...intent,payload:{}})).toThrow('z01_document_reference_invalid')
  expect(()=>z01WireReferencesFromIntent({...intent,interchangeReference:'I'.repeat(15)})).toThrow('z01_validated_intent_wire_references_required')
  expect(()=>z01WireReferencesFromIntent({...intent,messageReference:'M'.repeat(15)})).toThrow('z01_validated_intent_wire_references_required')
  expect(()=>z01WireReferencesFromIntent({...intent,transactionReference:null})).toThrow('z01_transaction_reference_invalid')
  expect(()=>z01WireReferencesFromIntent({...intent,validationStatus:'blocked'})).toThrow('z01_validated_intent_wire_references_required')
 })
})
