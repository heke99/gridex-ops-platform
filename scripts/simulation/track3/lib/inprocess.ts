// Backend-ingångar som körs i testprocessen (riktig produktkod via alias '@', mot lokala stacken/IMAP/SMTP).
// Används där HTTP-ingången inte bär en aktör (se README: kandidatfynd om inbound-cron utan aktör).
// Härkomst: anropsformen är hämtad från app/api/.. admin-åtgärden runInboundMailEngineAction
// (1c0c088cb4ed66d0dd8b3e34c9606019342a1a56:app/admin/inbound-mail/actions.ts rad 75-91), men med aktören
// ur EDIEL_AUTOMATION_ACTOR_USER_ID i stället för en inloggad plattformsadmin.
import type { InboundEngineRunResult } from '@/lib/inbound-mail/edielMailboxPoller.part-1'

export type InProcessInboundOutcome = { ok: true; result: InboundEngineRunResult } | { ok: false; error: string; stack?: string }

export async function runInboundEngineAsAutomationActor(
  environment: 'test' | 'production' = (process.env.T3_MODE as 'test' | 'production') ?? 'test',
  overrides: Record<string, unknown> = {},
): Promise<InProcessInboundOutcome> {
  const actorUserId = process.env.EDIEL_AUTOMATION_ACTOR_USER_ID
  if (!actorUserId) throw new Error('EDIEL_AUTOMATION_ACTOR_USER_ID saknas i env')
  const { runInboundEdielMailEngine } = await import('@/lib/inbound-mail/edielMailboxPoller')
  try {
    const result = await runInboundEdielMailEngine({
      environment, forcePoll: true, sharedOnly: true, actorUserId,
      // markSeen:false undviker appens messageFlagsAdd-inuti-fetch-fastlåsning (se README).
      markSeen: false, includeSeenRecent: true, recentDays: 14,
      messageLimitPerMailbox: 50, processLimit: 100, createDiagnosticMessagesForUnresolved: false,
      ...overrides,
    })
    return { ok: true, result }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined }
  }
}
