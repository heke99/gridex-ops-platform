import fs from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { raw } from './fixtures/prodat-register'
import { source as messageSource, head, own } from './fixtures/prodat-identity'
const boundary = vi.hoisted(() => ({ rpc: vi.fn(), db: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: boundary.rpc } }))
vi.mock('@/lib/supabase/tenantDb', () => ({ tenantDb: boundary.db }))
import { projectSentEdielSourceState, customerInfoPostSendStatus } from '@/lib/ediel/outbox/projectSentSources'
import { prepareEdielBusinessExpectationPlan, prepareEdielTechnicalExpectationPlan } from '@/lib/ediel/businessExpectations'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'

import { canonicalZ01BusinessResponseDeadlineMinutes } from '@/lib/ediel/rulebook/deadlinePolicy'

function read(relative: string): string {
  return fs.readFileSync(path.join(process.cwd(), relative), 'utf8')
}
beforeEach(() => vi.resetAllMocks())

describe('PRODAT Z01 parallel response SLA watchdog', () => {
  it('takes the 30-minute business deadline from the canonical handbook catalog', () => {
    expect(canonicalZ01BusinessResponseDeadlineMinutes()).toBe(30)
  })

  it('uses the actual atomic native facade and rejects a caller repair clock that differs from its immutable receipt', async () => {
    // Explicit synthetic private journal/RPC port, with actual policy planning
    // and actual source projection. No SMTP, issuer or native DB claim.
    const message = { ...messageSource(raw([...head(),...own('1','735123456789012345','OWN')],'Z01')),
      id:'journal-source', company_id:'tenant-journal', direction:'outbound', requires_contrl:true,
      contrl_status:'pending', requires_aperak:false, aperak_status:'not_required',
      outbound_request_id:null, grid_owner_data_request_id:null } as EdielMessageRow
    const policy = resolveCanonicalEdielPolicy({family:'PRODAT',messageCode:'Z01',subtypeOrReasonCode:'L',
      direction:'outbound',referenceDate:'2026-09-30',mode:'catalog_evidence'})
    const plan = prepareEdielBusinessExpectationPlan(message,policy)!
    expect(plan).toMatchObject({offset:30,unit:'minutes',anchor:'actual_accepted_smtp_observed_at',remoteReceiptKnown:false})
    const anchorAt = '2026-09-30T12:00:00.000Z'
    expect(prepareEdielTechnicalExpectationPlan(message,policy)).toMatchObject({
      offset:30,unit:'minutes',anchor:'actual_accepted_smtp_observed_at',remoteReceiptKnown:false,
    })
    const originalHash=createHash('sha256').update(message.raw_payload!, 'utf8').digest('hex')
    boundary.rpc.mockImplementation(async (name,args) => {
      expect(name).toBe('ediel_project_accepted_source_state_v1')
      expect(args).toEqual({p_company_id:'tenant-journal',p_environment:'test',p_message_id:'journal-source',
        p_actor_user_id:'operative-actor',p_expected_original_hash:originalHash})
      return {error:null,data:{status:'source_projection',companyId:message.company_id,environment:message.environment,
        messageId:message.id,originalHash,observedAt:anchorAt,authorizesProviderEntry:false}}
    })
    await projectSentEdielSourceState({message,sentAt:anchorAt,actorUserId:'operative-actor'})
    await projectSentEdielSourceState({message,actorUserId:'operative-actor'})
    await expect(projectSentEdielSourceState({message,sentAt:'2026-10-05T09:00:00.000Z',actorUserId:'operative-actor'}))
      .rejects.toThrow('ediel_post_send_frozen_dispatch_anchor_changed')
    expect(boundary.rpc).toHaveBeenCalledTimes(3)
    // Actual native RPC is the sole projection boundary. TypeScript cannot
    // perform a second loose write or serial business-watch registration.
    expect(boundary.db).not.toHaveBeenCalled()
  })

  it('models customer business waiting on Z02 while CONTRL is monitored in parallel', () => {
    expect(customerInfoPostSendStatus({requires_contrl:true,contrl_status:'pending',requires_aperak:false,aperak_status:'not_required'})).toBe('waiting_for_z02')
    expect(customerInfoPostSendStatus({requires_contrl:true,contrl_status:'received',requires_aperak:false,aperak_status:'not_required'})).toBe('waiting_for_z02')
  })

  it('escalates overdue business responses without any automatic resend path', () => {
    const migration = read('supabase/migrations/20260904090000_z01_parallel_sla_watchdog.sql')
    expect(migration).toContain("message_sent_at + interval '30 minutes'")
    expect(migration).toContain("'PRODAT_Z02_OR_NEGATIVE_APERAK'")
    expect(migration).toContain("blocker_code = 'response_overdue'")
    expect(migration).toContain("'customer_data.response_overdue'")
    expect(migration).toContain("'automatic_resends', 0")
    expect(migration).toContain("'automaticResendAllowed', false")
    expect(migration).not.toContain('insert into public.ediel_outbox')
    expect(migration).not.toContain('insert into public.outbound_requests')
  })

  it('uses only the production-allowed generic Ediel SLA event type', () => {
    const fix = read('supabase/migrations/20260904093000_z01_sla_watchdog_event_contract_fix.sql')
    expect(fix).toContain("'ack_sla_breached'")
    expect(fix).toContain("'slaFamily', 'CONTRL'")
    expect(fix).toContain("'slaFamily', 'PRODAT_Z02_OR_NEGATIVE_APERAK'")
    expect(fix).not.toContain("'contrl_sla_breached'")
    expect(fix).not.toContain("'business_response_sla_breached'")
  })

  it('resolves late response alarms dimension by dimension', () => {
    const late = read('supabase/migrations/20260904100000_z01_sla_late_response_resolution.sql')
    expect(late).toContain("ack_family = 'CONTRL'")
    expect(late).toContain("ack_family = 'PRODAT_Z02_OR_NEGATIVE_APERAK'")
    expect(late).toContain("status = 'resolved'")
    expect(late).toContain("action_required = false")
    expect(late).toContain("v_has_business_response")
    expect(late).toContain("resolved_by_ediel_message_id")
    expect(late).not.toContain('response_overdue_at = null')

    const contrlResolution = late.indexOf("ack_family = 'CONTRL'")
    const businessLookup = late.indexOf('v_business_response_message_id := null;')
    const businessResolution = late.indexOf("ack_family = 'PRODAT_Z02_OR_NEGATIVE_APERAK'")
    expect(contrlResolution).toBeGreaterThan(-1)
    expect(businessLookup).toBeGreaterThan(contrlResolution)
    expect(businessResolution).toBeGreaterThan(businessLookup)
  })

  it('does not let resolved historical Z01 rows starve newer watchdog candidates', () => {
    const convergence = read('supabase/migrations/20260904103000_z01_sla_watchdog_candidate_convergence.sql')
    expect(convergence).toContain("technical_sla.status = 'open'")
    expect(convergence).toContain("business_sla.status = 'open'")
    expect(convergence).toContain("response.related_message_id = m.id")
    expect(convergence).toContain("upper(coalesce(response.message_code,'')) = 'Z02'")
    expect(convergence).toContain("lower(coalesce(response.ack_outcome,'')) = 'negative'")
  })

  it('runs the watchdog on the five-minute customer operations cron', () => {
    const cron = read('app/api/internal/customer-operations/cron/route.ts')
    expect(cron).toContain('runZ01ResponseSlaWatchdog')
    expect(cron).toContain('z01ResponseSla')
  })

  it('keeps Z02 separate from Z04 market acceptance and activation', () => {
    const z02 = read('lib/onboarding/inboundEdielLinking.ts')
    const z04Guard = read('supabase/migrations/20260822012000_supplier_switch_effective_date_guard.sql')
    expect(z02).not.toContain('supply_period.activated')
    expect(z04Guard).toContain('supplier_switch_business_confirmation_requires_inbound_z04')
    expect(z04Guard).toContain("upper(coalesce(m.message_code,'')) = 'Z04'")
    expect(z04Guard).toContain('supplier_switch_effective_date_not_reached')
  })
})
