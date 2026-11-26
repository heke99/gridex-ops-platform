import { supabaseService } from '@/lib/supabase/service'

type BillingBlockerActor = { companyId: string; actorUserId: string }

export async function ensureBillingExportBlockerTask(input: BillingBlockerActor, itemId: string): Promise<boolean> {
  const db = supabaseService as unknown as {
    rpc(
      name: 'gridex_ensure_billing_export_blocker_task_v1',
      args: { p_company_id: string; p_item_id: string; p_actor_user_id: string },
    ): PromiseLike<{ data: { itemId?: unknown; outcome?: unknown; taskCreated?: unknown } | null; error: unknown }>
  }
  const { data, error } = await db.rpc('gridex_ensure_billing_export_blocker_task_v1', {
    p_company_id: input.companyId,
    p_item_id: itemId,
    p_actor_user_id: input.actorUserId,
  })
  if (error) throw new Error('Faktureringsradens uppföljning kunde inte hanteras.', { cause: error })
  if (!data || data.itemId !== itemId || typeof data.taskCreated !== 'boolean'
    || (data.outcome !== 'created' && data.outcome !== 'reused' && data.outcome !== 'held')
    || data.taskCreated !== (data.outcome === 'created')) {
    throw new Error('Faktureringsradens körkvitto är ogiltigt.')
  }
  return data.taskCreated
}

export async function createBillingExportBlockerTasks(input: BillingBlockerActor & { runId?: string }): Promise<{
  casesCreated: number
  blockersFound: number
}> {
  const itemIds: string[] = []
  let after: string | undefined

  for (;;) {
    let query = supabaseService
      .from('billing_export_run_items')
      .select('id')
      .eq('company_id', input.companyId)
      .eq('status', 'blocked')
      .not('customer_id', 'is', null)
      .order('id')
      .limit(200)
    if (input.runId) query = query.eq('billing_export_run_id', input.runId)
    if (after) query = query.gt('id', after)
    const { data, error } = await query
    if (error) throw error
    if (!data?.length) break
    for (const item of data) {
      if (after && item.id <= after) throw new Error('Faktureringsraderna har ogiltig sortering.')
      itemIds.push(item.id)
      after = item.id
    }
  }

  let casesCreated = 0
  for (const id of itemIds) {
    if (await ensureBillingExportBlockerTask(input, id)) casesCreated += 1
  }
  return { casesCreated, blockersFound: itemIds.length }
}
