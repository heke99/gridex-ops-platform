// Backendingång i testprocessen (riktig produktkod via alias '@'). Används för ERSÄTTNINGSSTEG där HTTP-cron saknar aktör.
// Härkomst: 01d97c27:scripts/simulation/track3/lib/inprocess.ts (T3_MODE -> T6_MODE).
import type { InboundEngineRunResult } from '@/lib/inbound-mail/edielMailboxPoller.part-1'
import { mode } from './base'

export type InProcessInboundOutcome = { ok: true; result: InboundEngineRunResult } | { ok: false; error: string; stack?: string }

export async function runInboundEngineAsAutomationActor(environment: 'test' | 'production' = mode(), overrides: Record<string, unknown> = {}): Promise<InProcessInboundOutcome> {
  const actorUserId = process.env.EDIEL_AUTOMATION_ACTOR_USER_ID
  if (!actorUserId) throw new Error('EDIEL_AUTOMATION_ACTOR_USER_ID saknas i env')
  const { runInboundEdielMailEngine } = await import('@/lib/inbound-mail/edielMailboxPoller')
  try {
    const result = await runInboundEdielMailEngine({
      environment, forcePoll: true, sharedOnly: true, actorUserId,
      markSeen: false, includeSeenRecent: true, recentDays: 14,
      messageLimitPerMailbox: 50, processLimit: 100, createDiagnosticMessagesForUnresolved: false,
      ...overrides,
    })
    return { ok: true, result }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined }
  }
}
