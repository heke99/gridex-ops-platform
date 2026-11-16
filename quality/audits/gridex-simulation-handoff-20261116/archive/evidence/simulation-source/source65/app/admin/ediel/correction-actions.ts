'use server'
import {requireCompanyScopedActionAccess} from '@/lib/admin/guards'
import {requireCompanyOperationalForWrites} from '@/lib/tenant/governance'
import {isEvidenceUuid} from '@/lib/ediel/utilts/durableSourceDiscovery'
import {captureCorrectionContext,type CorrectionCaptureResult} from '@/lib/ediel/sources/correctionContextCapture'

/** Record for review only. No caller bytes, actor, reviewer or claimed target. */
export async function captureCorrectionConcernAction(form:FormData):Promise<CorrectionCaptureResult>{
  const allowed=['companyId','environment','sourceMessageId','recordForReview']
  const invalid=():CorrectionCaptureResult=>({status:'unavailable',reason:'invalid_capture_input',disposition:'unreviewed'})
  if([...form.keys()].some(key=>!allowed.includes(key))||allowed.some(key=>form.getAll(key).length!==1))return invalid()
  const companyId=form.get('companyId'),environment=form.get('environment'),sourceMessageId=form.get('sourceMessageId')
  if(!isEvidenceUuid(companyId)||!isEvidenceUuid(sourceMessageId)||(environment!=='test'&&environment!=='production')||form.get('recordForReview')!=='on')return invalid()
  const context=await requireCompanyScopedActionAccess(companyId,{allOf:['communication.send']})
  await requireCompanyOperationalForWrites(companyId)
  return captureCorrectionContext({companyId,environment,sourceMessageId,actorUserId:context.userId})
}
