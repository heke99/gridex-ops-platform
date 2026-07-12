import { randomUUID } from 'node:crypto'
import { supabaseService } from '@/lib/supabase/service'

export class AutomationAlreadyRunningError extends Error {
  readonly code = 'automation_already_running'
  readonly status = 409
  constructor(lockKey: string) {
    super(`En annan körning håller redan låset ${lockKey}.`)
    this.name = 'AutomationAlreadyRunningError'
  }
}

export async function acquireAutomationLock(input: {
  lockKey: string
  companyId?: string | null
  ttlSeconds?: number
  metadata?: Record<string, unknown>
}): Promise<{ lockKey: string; lockToken: string }> {
  const lockToken = randomUUID()
  const { data, error } = await supabaseService.rpc('gridex_acquire_automation_lock', {
    p_lock_key: input.lockKey,
    p_lock_token: lockToken,
    p_company_id: input.companyId ?? null,
    p_ttl_seconds: input.ttlSeconds ?? 3600,
    p_metadata: input.metadata ?? {},
  })
  if (error) throw error
  if (data !== true) throw new AutomationAlreadyRunningError(input.lockKey)
  return { lockKey: input.lockKey, lockToken }
}

export async function releaseAutomationLock(lock: { lockKey: string; lockToken: string }): Promise<void> {
  const { error } = await supabaseService.rpc('gridex_release_automation_lock', {
    p_lock_key: lock.lockKey,
    p_lock_token: lock.lockToken,
  })
  if (error) throw error
}

export async function withAutomationLock<T>(input: {
  lockKey: string
  companyId?: string | null
  ttlSeconds?: number
  metadata?: Record<string, unknown>
  run: (lock: { lockKey: string; lockToken: string }) => Promise<T>
}): Promise<T> {
  const lock = await acquireAutomationLock(input)
  try {
    return await input.run(lock)
  } finally {
    await releaseAutomationLock(lock)
  }
}
