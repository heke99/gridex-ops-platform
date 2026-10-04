import { createHash } from 'node:crypto'
import { beforeEach,describe,expect,it,vi } from 'vitest'
import { loadRecoveryReportingContext,loadRecoveryReportingValidationContext } from '@/lib/ediel/recovery/reportingContext'
import type { RecoverySourceBasis } from '@/lib/ediel/recovery/sourceContext'
import type { ExpectedContext } from '@/lib/ediel/prodat/prodatReportingPermissionTypes'
import { source } from './fixtures/prodat-identity'
import { reportingObject,reportingSource,reportingNow } from './fixtures/prodat-reporting-permission'
const io=vi.hoisted(()=>({from:vi.fn(),operation:vi.fn(),original:vi.fn(),service:vi.fn(),tgt:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:io.from}}))
vi.mock('@/lib/ediel/recovery/sourceContext',()=>({readRecoveryOperationBasis:io.operation,readRecoveryOriginalBasis:io.original}))
vi.mock('@/lib/ediel/services/reporting',()=>({loadServiceReportingRecoveryContext:io.service}))
vi.mock('@/lib/ediel/testing/tgtReportingPermissionContext',()=>({loadTgtReportingValidationContext:io.tgt}))
const scope={companyId:'tenant',operationId:'operation',actorUserId:'actor'}
const original={...source('ORIGINAL'),id:'original',company_id:'tenant',direction:'outbound' as const,message_code:'Z13'}
const corrected={...original,id:'corrected',raw_payload:'CORRECTED',source_operation_id:'operation',original_message_id:'original'}
const object=reportingObject()
const context:ExpectedContext={source:reportingSource(),objects:[object],evaluationUtcMs:reportingNow}
const basis:RecoverySourceBasis={originalMessageId:'original',sourceOriginMessageId:'original',operationId:'operation',sourceAckMessageId:'negative',kind:'aperak_correction',correctedPayloadHash:createHash('sha256').update('CORRECTED').digest('hex'),allowedObjects:[{point:null,identityAgency:null,li:object.li,customerIdentity:object.customer.id,reason:object.expectedReason}]}
beforeEach(()=>{vi.resetAllMocks();io.operation.mockResolvedValue(basis);io.original.mockResolvedValue(basis);io.service.mockResolvedValue(undefined);io.tgt.mockResolvedValue(context);const q={select:vi.fn(),eq:vi.fn(),maybeSingle:vi.fn().mockResolvedValue({data:original,error:null})};q.select.mockReturnValue(q);q.eq.mockReturnValue(q);io.from.mockReturnValue(q)})
describe('qualified reporting recovery source adapter',()=>{
 it('uses the actual original TGT source and exact failed LIN customer/reason only',async()=>{
  expect((await loadRecoveryReportingContext(scope)).context?.objects).toEqual([object])
  expect(io.tgt).toHaveBeenCalledWith(original)
  io.operation.mockResolvedValue({...basis,allowedObjects:[{...basis.allowedObjects[0],customerIdentity:'OTHER'}]})
  await expect(loadRecoveryReportingContext(scope)).rejects.toThrow('scope_unqualified')
 })
 it('holds after a genuine service source error without trying TGT',async()=>{
  io.service.mockRejectedValue(new Error('source_revoked'))
  await expect(loadRecoveryReportingContext(scope)).rejects.toThrow('source_revoked');expect(io.tgt).not.toHaveBeenCalled()
 })
 it('requires a qualified new-message private alias and exact raw hash before loading any old facts',async()=>{
  await expect(loadRecoveryReportingValidationContext({...corrected,raw_payload:'EDITED'},'actor')).rejects.toThrow('message_scope')
  expect(io.operation).not.toHaveBeenCalled();expect(io.service).not.toHaveBeenCalled()
  expect(await loadRecoveryReportingValidationContext(corrected,'actor')).toEqual({status:'qualified',context})
  expect(io.service).toHaveBeenCalledWith({...scope,phase:'send'})
 })
 it('returns ordinary only for an absent private binding, never a qualifier error',async()=>{
  io.original.mockResolvedValue(undefined)
  expect(await loadRecoveryReportingValidationContext(corrected,'actor')).toBeUndefined();expect(io.from).not.toHaveBeenCalled()
  io.original.mockRejectedValue(new Error('ack_scope_conflict'))
  await expect(loadRecoveryReportingValidationContext(corrected,'actor')).rejects.toThrow('ack_scope_conflict');expect(io.from).not.toHaveBeenCalled()
 })
 it('does not infer a reporting context from the original mutable metadata',async()=>{
  io.tgt.mockResolvedValue(undefined)
  await expect(loadRecoveryReportingContext(scope)).rejects.toThrow('current_source_unavailable')
 })
 it('uses only the protected terminal source for further correction generations, preserving immediate source',async()=>{
  const root={...original,id:'genuine-original'}
  io.operation.mockResolvedValue({...basis,sourceOriginMessageId:root.id})
  const q={select:vi.fn(),eq:vi.fn(),maybeSingle:vi.fn().mockResolvedValueOnce({data:original,error:null}).mockResolvedValueOnce({data:root,error:null})}
  q.select.mockReturnValue(q);q.eq.mockReturnValue(q);io.from.mockReturnValue(q)
  expect((await loadRecoveryReportingContext(scope)).originalMessage.id).toBe(original.id)
  expect(io.tgt).toHaveBeenCalledWith(root)
  expect(io.service).toHaveBeenCalledWith({...scope,phase:'prepare'})
 })

})
