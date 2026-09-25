import {createHash} from 'node:crypto'
import {expect,it,vi} from 'vitest'
import {openCorrectionProcessReadsetV1} from '@/lib/ediel/sources/correctionProcessReadset'

const io=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc}}))
const scope={companyId:'f8e12e10-731a-4e18-a12c-eae169907137',environment:'test' as const,
 actorUserId:'57df1322-dc68-4a4c-b3e3-a2fe065f92e7',cutoffAt:'2026-09-24T09:00:00.000Z',
 customerId:'52b9885a-5c87-444e-b4d4-e772389ed74f',pointId:'735123456789012345',
 supplyPeriodId:'62e91cbe-8fdd-484f-81d5-c4f834f58ac2'}
const overflow={version:1,companyId:scope.companyId,environment:'test',cutoffAt:scope.cutoffAt,
 scope:{customerId:scope.customerId,pointId:scope.pointId,supplyPeriodId:scope.supplyPeriodId},
 complete:false,authority:'none',historyCoverage:'before_epoch_unknown',factCount:1001,
 gapCount:0,witnessCount:1,reason:'scoped_process_output_overflow',facts:[],gaps:[],witnesses:[],epochs:[]}
function returnReceipt(body:Record<string,unknown>){
 const readsetText=JSON.stringify(body)
 io.rpc.mockResolvedValueOnce({error:null,data:{snapshotId:'681d34eb-2823-48d4-b185-6cff12b3da4c',
  readsetText,readsetHash:createHash('sha256').update(readsetText).digest('hex')}})
}
it('accepts a scoped overflow receipt with exact candidate and witness counts',async()=>{
 returnReceipt(overflow)
 const receipt=await openCorrectionProcessReadsetV1(scope)
 expect(receipt.readset).toMatchObject({complete:false,authority:'none',factCount:1001,witnessCount:1,
  reason:'scoped_process_output_overflow',scope:overflow.scope})
 expect(io.rpc).toHaveBeenCalledWith('gridex_open_correction_process_readset_v1',expect.objectContaining({
  p_company_id:scope.companyId,p_point_id:scope.pointId,p_supply_period_id:scope.supplyPeriodId}))
})
it('rejects an overflow receipt that omits the requested scope',async()=>{
 returnReceipt({...overflow,scope:undefined})
 await expect(openCorrectionProcessReadsetV1(scope)).rejects.toThrow('correction_process_readset_content_invalid')
})
