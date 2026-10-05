'use server'
import {requireCompanyScopedActionAccess} from '@/lib/admin/guards'
import {requireCompanyOperationalForWrites} from '@/lib/tenant/governance'
import {isEvidenceUuid} from '@/lib/ediel/utilts/durableSourceDiscovery'
import {captureDocumentReference,type DocumentReferenceResult} from '@/lib/ediel/sources/documentReferenceCapture'
export async function captureDocumentReferenceAction(form:FormData):Promise<DocumentReferenceResult>{
 const keys=['companyId','environment','sourceMessageId','documentId','recordForReview']
 const invalid=():DocumentReferenceResult=>({status:'unavailable',reason:'invalid_capture_input',kind:'context_document_reference_v1',coverage:'incomplete',authority:'none'})
 if([...form.keys()].some(k=>!keys.includes(k))||keys.some(k=>form.getAll(k).length!==1)||form.get('recordForReview')!=='on')return invalid()
 const companyId=form.get('companyId'),environment=form.get('environment'),sourceMessageId=form.get('sourceMessageId'),documentId=form.get('documentId')
 if(!isEvidenceUuid(companyId)||!isEvidenceUuid(sourceMessageId)||!isEvidenceUuid(documentId)||(environment!=='test'&&environment!=='production'))return invalid()
 const actor=await requireCompanyScopedActionAccess(companyId,{allOf:['communication.send','documents.read','customers.read']})
 await requireCompanyOperationalForWrites(companyId)
 return captureDocumentReference({companyId,environment,sourceMessageId,documentId,actorUserId:actor.userId})
}
