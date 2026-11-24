import { randomUUID } from 'node:crypto'
import type { Json } from '@/supabase/database.types'
import { supabaseService } from '@/lib/supabase/service'

export async function openEdielOutboxBatch(input:{actorUserId:string;companyId?:string|null;environment?:string|null}) {
  const runId = randomUUID()
  async function note(event:Record<string,Json|undefined>) {
    const {data,error}=await supabaseService.rpc('gridex_note_ediel_outbox_batch_v1',{p_event:{...event,runId}})
    if (error) throw error
    if (!data || typeof data!=='object' || Array.isArray(data) || data.runId!==runId) {
      throw new Error('ediel_outbox_batch_receipt_invalid')
    }
    return data
  }
  await note({kind:'start',dispatchFenceVersion:1,actorUserId:input.actorUserId,companyId:input.companyId??null,environment:input.environment??null})
  return {runId,note}
}
export type EdielOutboxBatch = Awaited<ReturnType<typeof openEdielOutboxBatch>>

export type EdielOutboxBatchReceipt = {
  runId: string
  environment: string | null
  startedAt: string
  finishedAt: string | null
  stoppedBy: string | null
  remainingReady: number | null
  staleDeliveryUncertain: number
  recoveredUnstarted: number
  items: { outboxId: string; attemptId: string; outcome: string | null; delivery: string | null }[]
}

export async function listEdielOutboxBatches(actorUserId:string, companyId:string|null) {
  const {data,error}=await supabaseService.rpc('gridex_list_ediel_outbox_batches_v1',{
    p_actor_user_id:actorUserId,p_company_id:companyId,
  })
  if (error) throw error
  if (!Array.isArray(data)) throw new Error('ediel_outbox_batch_list_invalid')
  return data as unknown as EdielOutboxBatchReceipt[]
}

export async function readEdielOutboxBatch(runId:string,actorUserId:string,companyId:string|null) {
  const {data,error}=await supabaseService.rpc('gridex_read_ediel_outbox_batch_v1',{
    p_run_id:runId,p_actor_user_id:actorUserId,p_company_id:companyId,
  })
  if (error) throw error
  return data
}
