import {describe,expect,it} from 'vitest'
import {buildCanonicalAckReferences,buildEdielAckGroupReference} from '@/lib/ediel/core/referenceRegistry'
import {CANONICAL_ACK_GUIDE_CONSTRAINTS} from '@/lib/ediel/rulebook/ackGuidePolicy'
import {source} from './fixtures/prodat-identity'

describe('fresh own ACK references retain the central allocator entropy',()=>{
 it.each(['APERAK','CONTRL','UTILTS_ERR'] as const)('allocates separate bounded own document and transaction identities for %s',ackFamily=>{
  const original={...source('declared source'),id:'original',external_reference:'ORIGINAL-DOCUMENT',transaction_reference:'ORIGINAL-TRANSACTION',interchange_reference:'ORIGINAL-UNB',correlation_reference:'ORIGINAL-CORRELATION'}
  const refs=buildCanonicalAckReferences({sourceMessage:original,ackFamily})
  expect(refs.externalReference).toMatch(/^[A-Z0-9]{1,3}[A-F0-9]{32}$/)
  expect(refs.transactionReference).toMatch(/^[A-Z0-9]{1,3}[A-F0-9]{32}$/)
  expect(refs.externalReference).not.toBe(refs.transactionReference)
  expect(refs.originalMessageId).toBe('ORIGINAL-DOCUMENT');expect(refs.originalTransactionId).toBe('ORIGINAL-TRANSACTION');expect(refs.correlationReference).toBe('ORIGINAL-CORRELATION')
 })
 it('preserves the complete own parent and distinct group identities within the canonical U DM limit',()=>{
  const parentReference='APE'+'A'.repeat(32),maxLength=CANONICAL_ACK_GUIDE_CONSTRAINTS.UTILTS.ownDmMax
  expect(buildEdielAckGroupReference({parentReference,groupIndex:0,groupCount:1,maxLength})).toBe(parentReference)
  const values=[0,1,999998].map(groupIndex=>buildEdielAckGroupReference({parentReference,groupIndex,groupCount:999999,maxLength}))
  expect(new Set(values).size).toBe(3)
  for(const value of values){expect(value.startsWith(parentReference+'-')).toBe(true);expect(value.length).toBeLessThanOrEqual(maxLength)}
 })
 it('holds invalid own group scope or an exceeded actual field limit without truncation',()=>{
  const input={parentReference:'APE'+'A'.repeat(32),groupIndex:0,groupCount:2,maxLength:CANONICAL_ACK_GUIDE_CONSTRAINTS.UTILTS.ownDmMax}
  for(const delta of [{parentReference:'A'.repeat(36)},{parentReference:'INVALID?'},{groupIndex:-1},{groupIndex:2},{groupCount:0},{maxLength:35}])expect(()=>buildEdielAckGroupReference({...input,...delta})).toThrow('ediel_own_ack_group_reference_invalid')
 })
})
