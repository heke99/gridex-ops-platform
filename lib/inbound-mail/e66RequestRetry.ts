import { supabaseService } from '@/lib/supabase/service'

export type PolledE66RequestScope = {
  environment: 'test' | 'production'
  mailboxIds: readonly string[]
}

type RequestCommand = {
  companyId: string
  requestId: string
  actorUserId: string
  sourceMessageId: string
  meterValueIds: string[]
  responsePatch: Record<string, unknown>
}

type SubmitPolledRequest = (
  name: 'gridex_submit_polled_e66_request_retry_v1',
  args: {
    p_company: string
    p_environment: PolledE66RequestScope['environment']
    p_mailboxes: string[]
    p_source: string
    p_request: string
    p_actor: string
    p_meter_ids: string[]
    p_response_patch: Record<string, unknown>
  },
) => PromiseLike<{ data: unknown; error: { code: string } | null }>

export class E66RequestDeferred extends Error {
  constructor() {
    super('e66_request_deferred')
    this.name = 'E66RequestDeferred'
  }
}

export async function submitPolledE66Request(scope: PolledE66RequestScope, command: RequestCommand) {
  const submit = supabaseService.rpc.bind(supabaseService) as unknown as SubmitPolledRequest
  return submit('gridex_submit_polled_e66_request_retry_v1', {
    p_company: command.companyId,
    p_environment: scope.environment,
    p_mailboxes: [...new Set(scope.mailboxIds)],
    p_source: command.sourceMessageId,
    p_request: command.requestId,
    p_actor: command.actorUserId,
    p_meter_ids: command.meterValueIds,
    p_response_patch: command.responsePatch,
  })
}
