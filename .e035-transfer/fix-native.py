from pathlib import Path
p=Path('scripts/ediel-source-owner-native.test.ts');s=p.read_text();old="'Isolated synthetic native route',${p('grid')},'test',true)";assert s.count(old)==1;s=s.replace(old,"'Isolated synthetic native route',${p('grid')},'bilateral_test',true)");p.write_text(s)
p=Path('__tests__/ediel-structure-review-action.test.ts');assert not p.exists();p.write_text("""import {beforeEach,expect,it,vi} from 'vitest'
const calls=vi.hoisted(()=>({scope:vi.fn(),operational:vi.fn(),review:vi.fn(),revalidate:vi.fn()}))
vi.mock('@/lib/admin/guards',()=>({requireCompanyScopedActionAccess:calls.scope}))
vi.mock('@/lib/tenant/governance',()=>({requireCompanyOperationalForWrites:calls.operational}))
vi.mock('@/lib/ediel/sources/reviewReceivedStructuralSource',()=>({reviewReceivedStructuralSource:calls.review}))
vi.mock('next/cache',()=>({revalidatePath:calls.revalidate}))
import {reviewReceivedStructureAction as action} from '@/app/admin/ediel/structure-actions'
const company='10000000-0000-4000-8000-000000000001',source='10000000-0000-4000-8000-000000000002',actor='10000000-0000-4000-8000-000000000003'
function form(){const f=new FormData();f.set('companyId',company);f.set('sourceMessageId',source);f.set('environment','test');f.set('confirmedOriginal','on');return f}
beforeEach(()=>{vi.resetAllMocks();calls.scope.mockResolvedValue({userId:actor});calls.operational.mockResolvedValue(undefined);calls.review.mockResolvedValue({status:'recorded',sourceDisposition:'accepted',assessmentId:'assessment'})})
it('uses the authenticated actor and selected company, never caller supplied approval facts',async()=>{
 const f=form();f.set('reviewerUserId','forged');f.set('coverageWindow','{\"validFrom\":\"1900-01-01\"}');f.set('sourceDisposition','accepted')
 expect(await action(f)).toMatchObject({accepted:true,assessmentId:'assessment'})
 expect(calls.scope).toHaveBeenCalledWith(company,{anyOf:['communication.write','ediel_testing.write']})
 expect(calls.review).toHaveBeenCalledExactlyOnceWith({companyId:company,sourceMessageId:source,environment:'test',reviewerUserId:actor,confirmedOriginal:true,replacesSourceMessageId:null})
 expect(calls.scope.mock.invocationCallOrder[0]).toBeLessThan(calls.operational.mock.invocationCallOrder[0])
 expect(calls.operational.mock.invocationCallOrder[0]).toBeLessThan(calls.review.mock.invocationCallOrder[0])
})
it('denied company scope stops all review writes',async()=>{calls.scope.mockRejectedValueOnce(Error('denied'));await expect(action(form())).rejects.toThrow('denied');expect(calls.operational).not.toHaveBeenCalled();expect(calls.review).not.toHaveBeenCalled()})
it('an inoperable company stops review even after permission succeeds',async()=>{calls.operational.mockRejectedValueOnce(Error('not operational'));await expect(action(form())).rejects.toThrow('not operational');expect(calls.review).not.toHaveBeenCalled()})
it.each(['companyId','sourceMessageId','environment','confirmedOriginal','replacesSourceMessageId'])('rejects duplicate %s fields without a write',async key=>{
 const f=form();if(key==='replacesSourceMessageId')f.set(key,source);f.append(key,String(f.get(key)));expect(await action(f)).toMatchObject({accepted:false});expect(calls.scope).not.toHaveBeenCalled();expect(calls.review).not.toHaveBeenCalled()
})
it('does not treat a string true as the explicit original confirmation',async()=>{const f=form();f.set('confirmedOriginal','true');expect(await action(f)).toMatchObject({accepted:false});expect(calls.review).not.toHaveBeenCalled()})
it('passes only an explicitly supplied predecessor identity',async()=>{const f=form();f.set('replacesSourceMessageId',actor);await action(f);expect(calls.review).toHaveBeenCalledWith(expect.objectContaining({replacesSourceMessageId:actor}))})
it('does not promote a recorded but unestablished decision',async()=>{calls.review.mockResolvedValueOnce({status:'recorded',sourceDisposition:'not_established'});expect(await action(form())).toMatchObject({accepted:false})})
it('rejects unknown environments',async()=>{const f=form();f.set('environment','sandbox');expect(await action(f)).toMatchObject({accepted:false});expect(calls.review).not.toHaveBeenCalled()})
""")
p=Path('__tests__/ediel-structural-source-selection.test.ts');p.write_text(p.read_text()+"""
describe('corrected dated coverage anchor',()=>{
 it('keeps the original coverage owner when an explicit baseline correction is selected',()=>{
  const original=version('baseline',2),correction=version('corrected-baseline',2,'Z04',['901'])
  correction.wire.functionCode='5';correction.wire.caseReference=original.wire.caseReference
  correction.replaces={sourceMessageId:original.sourceMessageId,assessmentId:original.assessmentId!,payloadHash:original.payloadHash}
  const result=selected(input([original,correction]))
  expect(result.states[0]).toMatchObject({sourceMessageId:correction.sourceMessageId,registerIds:['901']})
  expect(result.coverage).toEqual(coverage)
 })
 it('cannot use a corrected baseline to extend its committed coverage backwards',()=>{
  const original=version('baseline',2),correction=version('corrected-baseline',1)
  correction.wire.functionCode='5';correction.wire.caseReference=original.wire.caseReference
  correction.replaces={sourceMessageId:original.sourceMessageId,assessmentId:original.assessmentId!,payloadHash:original.payloadHash}
  unavailable(input([original,correction],1,2))
 })
})
""")
