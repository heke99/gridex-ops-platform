'use server'
import { revalidatePath } from 'next/cache'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import { requireCompanyOperationalForWrites } from '@/lib/tenant/governance'
import { isEvidenceUuid } from '@/lib/ediel/utilts/durableSourceDiscovery'
import { prepareAndQueueProdatRecovery, prepareProdatRecoveryDraft, queuePersistedProdatRecovery } from '@/lib/ediel/recovery/prodatRecovery'
import { readProdatRecoveryWorkspace,type RecoveryRecord } from '@/lib/ediel/recovery/operatorWorkspace'

export type RecoveryActionState = { status: 'idle' | 'read' | 'prepared' | 'queued' | 'existing' | 'held' | 'unavailable'; message: string; record?: RecoveryRecord; operationId?: string }

function only(form: FormData, keys: string[]) {
  for (const key of form.keys()) if (!keys.includes(key) && !key.startsWith('$ACTION_')) throw Error('recovery_form_field_invalid')
  for (const key of keys) if (form.getAll(key).length > 1) throw Error('recovery_form_field_duplicate')
}
function selected(form: FormData, key: string) { const value=form.get(key); if (!isEvidenceUuid(value)) throw Error('recovery_selector_invalid'); return value }
async function readRecord(companyId: string, userId: string, messageId: string): Promise<RecoveryRecord> {
  const result=await readProdatRecoveryWorkspace({companyId,actorUserId:userId,messageId})
  if(!result.record)throw Error('recovery_message_unavailable');return result.record
}

/** Tenant, current actor and environment come from the verified session and
 * stored row. Form identifiers are only selections; native source/ACK/private
 * operation bindings and the existing common command own every write. */
export async function prodatRecoveryAction(_state: RecoveryActionState, form: FormData): Promise<RecoveryActionState> {
  let persistedMessageId: string | undefined
  try {
    const action=form.get('action')
    if (!['read','prepare','queue','retry'].includes(String(action))) throw Error('recovery_action_invalid')
    only(form,action==='prepare'?['action','originalMessageId','sourceAckMessageId','operationId','correctedRawPayload']:action==='retry'?['action','originalMessageId','previousAttemptId','operationId']:['action','messageId'])
    const wanted=action==='prepare'?['communication.read','communication.write']:action==='queue'?['communication.read','communication.send']:action==='retry'?['communication.read','communication.write','communication.send']:['communication.read']
    const actor=await requireAdminActionAccess({allOf:wanted}), companyId=actor.companyId
    if (!isEvidenceUuid(companyId) || !isEvidenceUuid(actor.userId) || !wanted.every(p=>actor.permissions.includes(p))) throw Error('recovery_current_permission_required')
    if (action==='read') return {status:'read',message:'Meddelandets beständiga status är återläst.',record:await readRecord(companyId,actor.userId,selected(form,'messageId'))}
    await requireCompanyOperationalForWrites(companyId)
    let result: Awaited<ReturnType<typeof prepareAndQueueProdatRecovery>> | Awaited<ReturnType<typeof queuePersistedProdatRecovery>>
    if (action==='queue') {
      const messageId=selected(form,'messageId'); await readRecord(companyId,actor.userId,messageId)
      result=await queuePersistedProdatRecovery({companyId,actorUserId:actor.userId,messageId})
    } else {
      const originalMessageId=selected(form,'originalMessageId'), operationId=selected(form,'operationId')
      await readRecord(companyId,actor.userId,originalMessageId)
      if (action==='retry') result=await prepareAndQueueProdatRecovery({companyId,actorUserId:actor.userId,originalMessageId,operationId,previousAttemptId:selected(form,'previousAttemptId')})
      else {const raw=form.get('correctedRawPayload');if(typeof raw!=='string'||!raw||Buffer.byteLength(raw,'utf8')>262144)throw Error('recovery_payload_limit')
        result=await prepareProdatRecoveryDraft({companyId,actorUserId:actor.userId,originalMessageId,operationId,sourceAckMessageId:selected(form,'sourceAckMessageId'),correctedRawPayload:raw})}
    }
    if (result.status==='held') return {status:'held',message:`Åtgärden är spärrad av källprövningen (${result.reason}).`}
    persistedMessageId=result.messageId
    revalidatePath('/admin/ediel/prodat-recovery');revalidatePath('/admin/ediel/messages');revalidatePath('/admin/ediel/outbox')
    const record=await readRecord(companyId,actor.userId,result.messageId)
    return {status:result.status,message:result.status==='prepared'?'Rättelsen är sparad som eget utkast. En behörig avsändare kan därefter köa den.':result.status==='existing'?'Den tidigare beständiga rättelsen är återläst.':'Den beständiga leveransavsikten är köad. Leveransstatus följs separat.',operationId:result.operationId,record}
  } catch {
    return {status:'unavailable',message:persistedMessageId?'Åtgärden har ett beständigt meddelande, men aktuell återläsning kunde inte verifieras. Återläs meddelandet när läsbehörigheten är tillgänglig.':'Åtgärden kunde inte verifieras. Kontrollera aktuell behörighet, valt original, faktiskt ACK eller transportförsök och rättelsens innehåll.'}
  }
}
