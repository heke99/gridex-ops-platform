import {beforeEach,expect,it,vi} from 'vitest'
const mocks=vi.hoisted(()=>({rpc:vi.fn(),access:vi.fn(),operational:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:mocks.rpc}}))
vi.mock('@/lib/admin/guards',()=>({requireCompanyScopedActionAccess:mocks.access}))
vi.mock('@/lib/tenant/governance',()=>({requireCompanyOperationalForWrites:mocks.operational}))
import {captureCorrectionContext} from '@/lib/ediel/sources/correctionContextCapture'
import {captureCorrectionConcernAction} from '@/app/admin/ediel/correction-actions'
const id=(n:number)=>`20000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const input={companyId:id(1),environment:'test' as const,sourceMessageId:id(2),actorUserId:id(3)}
const receipt={version:1,captureId:id(4),companyId:input.companyId,environment:'test',sourceMessageId:input.sourceMessageId,
 contentHash:'a'.repeat(64),factsHash:'b'.repeat(64),capturedAt:'2026-01-01T00:00:00.000001Z',disposition:'unreviewed'}
const witness={...receipt,witnessId:id(5),availableAt:'2026-01-01T00:00:00.000002Z'}
const response=(data:unknown,error:unknown=null)=>({abortSignal:()=>Promise.resolve({data,error})})
beforeEach(()=>{vi.resetAllMocks();mocks.access.mockResolvedValue({userId:input.actorUserId});mocks.operational.mockResolvedValue(undefined)
 mocks.rpc.mockReturnValueOnce(response(receipt)).mockReturnValueOnce(response(witness))})
it('only returns an unreviewed receipt after separate committed availability',async()=>{
 expect(await captureCorrectionContext(input)).toEqual({status:'recorded',...receipt,witnessId:id(5),availableAt:witness.availableAt})
 expect(mocks.rpc.mock.calls.map(c=>c[0])).toEqual(['gridex_capture_correction_concern_v1','gridex_witness_correction_concern_v1'])
 expect(mocks.rpc.mock.calls[0][1]).toEqual({p_company_id:input.companyId,p_environment:'test',p_source_message_id:input.sourceMessageId,p_actor_user_id:input.actorUserId})
})
it.each(['companyId','environment','sourceMessageId','captureId','contentHash','factsHash','capturedAt','disposition'])('rejects invalid capture binding %s',key=>{
 mocks.rpc.mockReset().mockReturnValue(response({...receipt,[key]:'forged'}))
 return expect(captureCorrectionContext(input)).resolves.toEqual({status:'unconfirmed',disposition:'unreviewed'})
})
it.each(['companyId','environment','sourceMessageId','captureId','contentHash','factsHash','capturedAt','disposition','witnessId','availableAt'])('rejects invalid witness binding %s',key=>{
 mocks.rpc.mockReset().mockReturnValueOnce(response(receipt)).mockReturnValueOnce(response({...witness,[key]:'forged'}))
 return expect(captureCorrectionContext(input)).resolves.toEqual({status:'unconfirmed',disposition:'unreviewed'})
})
it('interruption after append never announces capture success',async()=>{
 mocks.rpc.mockReset().mockReturnValueOnce(response(receipt)).mockImplementationOnce(()=>{throw Error('interrupted')})
 expect(await captureCorrectionContext(input)).toEqual({status:'unconfirmed',disposition:'unreviewed'})
})
it('a document input is explicitly unavailable pending retained context design',async()=>{
 expect(await captureCorrectionContext({...input,documentId:id(8)})).toEqual({status:'unavailable',reason:'document_context_retention_unresolved',disposition:'unreviewed'})
 expect(mocks.rpc).not.toHaveBeenCalled()
})
function form(){const f=new FormData();f.set('companyId',input.companyId);f.set('environment','test');f.set('sourceMessageId',input.sourceMessageId);f.set('recordForReview','on');return f}
it('authenticates actor and company, exposes no reviewer or bytes authority',async()=>{
 expect(await captureCorrectionConcernAction(form())).toMatchObject({status:'recorded',disposition:'unreviewed'})
 expect(mocks.access).toHaveBeenCalledWith(input.companyId,{allOf:['communication.write']})
 expect(mocks.operational).toHaveBeenCalledWith(input.companyId)
 expect(mocks.rpc.mock.calls[0][1].p_actor_user_id).toBe(input.actorUserId)
})
it.each(['reviewerUserId','actorUserId','rawPayload','contentHash','targetSourceMessageId','approved','documentId'])('rejects public forged/unsupported field %s',key=>{
 const f=form();f.set(key,id(9));return captureCorrectionConcernAction(f).then(result=>{
 expect(result.status).toBe('unavailable');expect(mocks.access).not.toHaveBeenCalled();expect(mocks.rpc).not.toHaveBeenCalled()})
})
it('rejects duplicate source IDs before authentication',async()=>{const f=form();f.append('sourceMessageId',id(9));expect((await captureCorrectionConcernAction(f)).status).toBe('unavailable');expect(mocks.access).not.toHaveBeenCalled()})
it('denied and suspended actors never write',async()=>{
 mocks.access.mockRejectedValueOnce(Error('denied'));await expect(captureCorrectionConcernAction(form())).rejects.toThrow('denied');expect(mocks.rpc).not.toHaveBeenCalled()
 mocks.operational.mockRejectedValueOnce(Error('suspended'));await expect(captureCorrectionConcernAction(form())).rejects.toThrow('suspended');expect(mocks.rpc).not.toHaveBeenCalled()
})
