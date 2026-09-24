import {createHash} from 'node:crypto'
import {supabaseService} from '@/lib/supabase/service'

export type CorrectionProcessReadsetScope={
 companyId:string
 environment:'test'|'production'
 actorUserId:string
 cutoffAt:string
 customerId?:string|null
 pointId?:string|null
 supplyPeriodId?:string|null
}
export type CorrectionProcessReadset={
 version:1
 companyId:string
 environment:'test'|'production'
 complete:false
 authority:'none'
 historyCoverage:'before_epoch_unknown'
 cutoffAt:string
 scope:{customerId:string|null;pointId:string|null;supplyPeriodId:string|null}
 factCount:number
 gapCount:number
 witnessCount:number
 reason:string|null
 facts:unknown[]
 gaps:unknown[]
 witnesses:unknown[]
 epochs:unknown[]
}

/** The receipt is useful as evidence of a bounded prospective observation only. */
export async function openCorrectionProcessReadsetV1(scope:CorrectionProcessReadsetScope){
 const {data,error}=await supabaseService.rpc('gridex_open_correction_process_readset_v1' as never,{
  p_company_id:scope.companyId,p_environment:scope.environment,p_actor_user_id:scope.actorUserId,
  p_cutoff_at:scope.cutoffAt,p_customer_id:scope.customerId ?? null,
  p_point_id:scope.pointId ?? null,p_supply_period_id:scope.supplyPeriodId ?? null,
 } as never)
 if(error)throw error
 const receipt=data as unknown as {snapshotId?:unknown;readsetHash?:unknown;readsetText?:unknown}|null
 if(typeof receipt?.snapshotId!=='string'||typeof receipt.readsetHash!=='string'||typeof receipt.readsetText!=='string'
  ||!/^\w{8}-\w{4}-\w{4}-\w{4}-\w{12}$/.test(receipt.snapshotId)
  ||createHash('sha256').update(receipt.readsetText,'utf8').digest('hex')!==receipt.readsetHash)
  throw Error('correction_process_readset_receipt_invalid')
 const readset=JSON.parse(receipt.readsetText) as CorrectionProcessReadset
 const expectedCutoff=Date.parse(scope.cutoffAt)
 if(readset.version!==1||readset.companyId!==scope.companyId||readset.environment!==scope.environment
  ||!Number.isFinite(expectedCutoff)||Date.parse(readset.cutoffAt)!==expectedCutoff
  ||readset.scope?.customerId!==(scope.customerId ?? null)
  ||readset.scope?.pointId!==(scope.pointId ?? null)
  ||readset.scope?.supplyPeriodId!==(scope.supplyPeriodId ?? null)
  ||readset.complete!==false||readset.authority!=='none'||readset.historyCoverage!=='before_epoch_unknown'
  ||!Number.isSafeInteger(readset.factCount)||!Number.isSafeInteger(readset.gapCount)
  ||!Number.isSafeInteger(readset.witnessCount)||!Array.isArray(readset.facts)
  ||!Array.isArray(readset.gaps)||!Array.isArray(readset.witnesses)||!Array.isArray(readset.epochs))
  throw Error('correction_process_readset_content_invalid')
 return {snapshotId:receipt.snapshotId,readsetHash:receipt.readsetHash,readsetText:receipt.readsetText,readset}
}
