import {beforeEach,expect,it,vi} from 'vitest'
const mocks=vi.hoisted(()=>({access:vi.fn(),operational:vi.fn(),review:vi.fn(),refresh:vi.fn()}))
vi.mock('@/lib/admin/guards',()=>({requireCompanyScopedActionAccess:mocks.access}))
vi.mock('@/lib/tenant/governance',()=>({requireCompanyOperationalForWrites:mocks.operational}))
vi.mock('@/lib/ediel/sources/reviewReceivedClosureSource',()=>({reviewReceivedClosureSource:mocks.review}))
vi.mock('@/lib/ediel/sources/reviewReceivedStructuralSource',()=>({reviewReceivedStructuralSource:vi.fn()}))
vi.mock('next/cache',()=>({revalidatePath:mocks.refresh}))
import {reviewReceivedClosureAction} from '@/app/admin/ediel/structure-actions'
import {OWNER,ownerId} from './helpers/sourceOwnerFixtures'
function form(){const f=new FormData();f.set('companyId',OWNER.company);f.set('sourceMessageId',OWNER.source);f.set('environment','test');f.set('confirmedOriginal','on');return f}
beforeEach(()=>{vi.resetAllMocks();mocks.access.mockResolvedValue({userId:ownerId(88)});mocks.operational.mockResolvedValue(undefined);mocks.review.mockResolvedValue({status:'recorded',sourceDisposition:'accepted',assessmentId:ownerId(89)})})
it('uses the authenticated reviewer and selected tenant, never client approval facts',async()=>{
 const f=form();f.set('reviewerUserId',ownerId(99));f.set('effectiveTo','2099-01-01');f.set('approved','true')
 expect(await reviewReceivedClosureAction(f)).toMatchObject({accepted:true,assessmentId:ownerId(89)})
 expect(mocks.access).toHaveBeenCalledWith(OWNER.company,{anyOf:['communication.write','ediel_testing.write']})
 expect(mocks.operational).toHaveBeenCalledWith(OWNER.company)
 expect(mocks.review).toHaveBeenCalledExactlyOnceWith({companyId:OWNER.company,sourceMessageId:OWNER.source,environment:'test',confirmedOriginal:true,reviewerUserId:ownerId(88)})
})
it.each(['duplicate','replacement','unconfirmed','environment'])('rejects unsupported request %s before writes',kind=>{
 const f=form();if(kind==='duplicate')f.append('sourceMessageId',OWNER.source)
 if(kind==='replacement')f.set('replacesSourceMessageId',ownerId(99))
 if(kind==='unconfirmed')f.delete('confirmedOriginal')
 if(kind==='environment')f.set('environment','unknown')
 return reviewReceivedClosureAction(f).then(result=>{expect(result.accepted).toBe(false);expect(mocks.review).not.toHaveBeenCalled();expect(mocks.access).not.toHaveBeenCalled()})
})
it('authorization and operational status precede the owner call',async()=>{
 mocks.access.mockRejectedValueOnce(Error('denied'))
 await expect(reviewReceivedClosureAction(form())).rejects.toThrow('denied');expect(mocks.review).not.toHaveBeenCalled()
 mocks.operational.mockRejectedValueOnce(Error('suspended'))
 await expect(reviewReceivedClosureAction(form())).rejects.toThrow('suspended');expect(mocks.review).not.toHaveBeenCalled()
})
it('an unavailable composition does not announce acceptance',async()=>{
 mocks.review.mockResolvedValue({status:'recorded',sourceDisposition:'not_established',assessmentId:ownerId(89)})
 expect(await reviewReceivedClosureAction(form())).toMatchObject({accepted:false})
})
