import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { mapWithConcurrency } from '@/lib/performance/mapWithConcurrency'
import { InvalidReadModelResponseError, readResult, type ReadResult } from '@/lib/read-models/readResult'
import { supabaseService } from '@/lib/supabase/service'
import { isUuid } from '@/lib/validation/uuid'

export const WORK_QUEUE_TASK_STATUSES = ['open', 'new', 'pending', 'action_required']
export const ACTIVE_SUPPLY_END_TASK_STATUSES = [...WORK_QUEUE_TASK_STATUSES, 'in_progress', 'blocked', 'pending_review']
export const SUPPLY_END_TASK_TYPE = 'final_invoice_pending'

export const SUPPLY_END_TASK_REVIEW_COPY = {
  title: 'Slutfaktura behöver granskas',
  description: 'Uppgiften gäller ett leveransslut som inte längre kan bekräftas. Kontrollera aktuell leverans och underlaget innan slutfaktureringen fortsätter.',
}
export const SUPPLY_END_TASK_UNVERIFIED_COPY = {
  title: 'Slutfaktura behöver kontrolleras',
  description: 'Leveransslutet kunde inte kontrolleras. Kontrollera aktuell leverans och underlaget innan slutfaktureringen fortsätter.',
}
export const SUPPLY_END_TASK_CONFIRMATION_COPY = {
  title: 'Kontrollera leveransslutet inför slutfaktura',
  description: 'Kontrollera aktuellt leveransslut och underlaget innan slutfaktureringen fortsätter.',
}
export const SUPPLY_END_REVIEW_READ = {
  definitionVersion: 'work_queue_sources_v1',
  errorCode: 'WORK_QUEUE_SUPPLY_END_REVIEW_UNAVAILABLE',
}

type VisibleTask = { id: string; companyId: string; customerId: string; isSupplyEndTask?: boolean }
type ReviewFailure = Extract<ReadResult<unknown>, { kind: 'unavailable' }>
type TaskReviewRpc = (name: 'gridex_read_supply_end_task_review_v1', args: {
  p_company_id: string; p_task_ids: string[]
}) => PromiseLike<{ data: Array<{ task_id: string; company_id: string; customer_id: string }> | null; error: unknown }>


type ReviewReadout = {
  taskIds: Set<string>
  unverifiedTaskIds: Set<string>
  qualifiedTaskIds: Set<string>
  failures: ReviewFailure[]
}

export async function readSupplyEndTaskReviewIds(
  supabase: SupabaseClient,
  companyId: string | null,
  visibleTasks: VisibleTask[],
  statuses: string[] = WORK_QUEUE_TASK_STATUSES,
): Promise<ReviewReadout> {
  const visibleById = new Map<string, VisibleTask>()
  for (const task of visibleTasks) {
    const existing = visibleById.get(task.id)
    if (!isUuid(task.id) || !isUuid(task.companyId) || !isUuid(task.customerId)
      || (companyId && task.companyId !== companyId)) continue
    if (existing && (task.companyId !== existing.companyId || task.customerId !== existing.customerId)) {
      throw new InvalidReadModelResponseError()
    }
    if (!existing?.isSupplyEndTask) visibleById.set(task.id, task)
  }

  const tasksByCompany = new Map<string, VisibleTask[]>()
  for (const task of visibleById.values()) {
    const tasks = tasksByCompany.get(task.companyId) ?? []
    tasks.push(task)
    tasksByCompany.set(task.companyId, tasks)
  }

  const batches = []
  for (const tasks of tasksByCompany.values()) {
    for (let offset = 0; offset < tasks.length; offset += 100) {
      batches.push(tasks.slice(offset, offset + 100))
    }
  }

  const checks = await mapWithConcurrency(batches, 4, async tasks => {
    const targetCompanyId = tasks[0].companyId
    const expected = new Map(tasks.map(task => [task.id, task]))
    // The queue summary has no task type. Prove the exact task is readable by
    // this session before passing any key to the private disposition reader.
    const qualification = await readResult(async () => {
      const { data, error } = await supabase.from('customer_operation_tasks')
        .select('id,company_id,customer_id')
        .eq('company_id', targetCompanyId)
        .eq('task_type', SUPPLY_END_TASK_TYPE)
        .in('status', statuses)
        .in('id', [...expected.keys()])
      if (error) throw error
      if (!Array.isArray(data)) throw new InvalidReadModelResponseError()

      const qualified = new Map<string, VisibleTask>()
      for (const row of data) {
        const visible = row && expected.get(row.id)
        if (!visible || qualified.has(row.id) || row.company_id !== visible.companyId || row.customer_id !== visible.customerId) {
          throw new InvalidReadModelResponseError()
        }
        qualified.set(row.id, visible)
      }
      return qualified
    }, SUPPLY_END_REVIEW_READ)

    if (qualification.kind === 'unavailable') {
      return { reviewed: [], unverified: tasks.filter(task => task.isSupplyEndTask).map(task => task.id), failure: qualification }
    }
    const qualified = qualification.data
    if (qualified.size === 0) return { reviewed: [], unverified: [] }

    const disposition = await readResult(async () => {
      const readTaskReviewRpc = supabaseService.rpc.bind(supabaseService) as unknown as TaskReviewRpc
      const { data, error } = await readTaskReviewRpc('gridex_read_supply_end_task_review_v1', {
        p_company_id: targetCompanyId, p_task_ids: [...qualified.keys()],
      })
      if (error) throw error
      if (!Array.isArray(data)) throw new InvalidReadModelResponseError()

      const reviewed = new Set<string>()
      for (const row of data) {
        const task = row && qualified.get(row.task_id)
        if (!task || reviewed.has(task.id) || row.company_id !== task.companyId || row.customer_id !== task.customerId) {
          throw new InvalidReadModelResponseError()
        }
        reviewed.add(task.id)
      }
      return [...reviewed]
    }, SUPPLY_END_REVIEW_READ)

    return disposition.kind === 'unavailable'
      ? { reviewed: [], unverified: [...qualified.keys()], failure: disposition }
      : { reviewed: disposition.data, unverified: [], qualified: [...qualified.keys()] }
  })

  return {
    taskIds: new Set(checks.flatMap(check => check.reviewed)),
    unverifiedTaskIds: new Set(checks.flatMap(check => check.unverified)),
    qualifiedTaskIds: new Set(checks.flatMap(check => check.qualified ?? [])),
    failures: checks.flatMap(check => check.failure ? [check.failure] : []),
  }
}
