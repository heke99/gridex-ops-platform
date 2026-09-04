import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { canonicalZ01BusinessResponseDeadlineMinutes } from '@/lib/ediel/rulebook/deadlinePolicy'

function read(relative: string): string {
  return fs.readFileSync(path.join(process.cwd(), relative), 'utf8')
}

describe('PRODAT Z01 parallel response SLA watchdog', () => {
  it('takes the 30-minute business deadline from the canonical handbook catalog', () => {
    expect(canonicalZ01BusinessResponseDeadlineMinutes()).toBe(30)
  })

  it('starts technical and business clocks from the actual persisted send time', () => {
    const source = read('lib/ediel/outbox/projectSentSources.ts')
    expect(source).toContain('message_sent_at: params.sentAt')
    expect(source).toContain('contrl_due_at: technicalDueAt')
    expect(source).toContain('business_response_due_at: businessResponseDueAt')
    expect(source).toContain('ack_due_at: technicalDueAt')
    expect(source).toContain('canonicalZ01BusinessResponseDeadlineMinutesProjection()')
    expect(source).toContain('EDIEL_ACK_DEADLINE_MINUTES')
  })

  it('models customer business waiting on Z02 while CONTRL is monitored in parallel', () => {
    const source = read('lib/ediel/outbox/projectSentSources.ts')
    expect(source).toContain("return 'waiting_for_z02'")
    expect(source).toContain('CONTRL bevakas parallellt')
    expect(source).not.toContain('Efter positiv teknisk kvittens inväntas Z02')
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

  it('runs the watchdog on the five-minute customer operations cron', () => {
    const cron = read('app/api/internal/customer-operations/cron/route.ts')
    expect(cron).toContain('runZ01ResponseSlaWatchdog')
    expect(cron).toContain('z01ResponseSla')
  })

  it('keeps Z02 separate from Z04 market acceptance and activation', () => {
    const z02 = read('lib/onboarding/inboundEdielLinking.ts')
    const z04Guard = read('supabase/migrations/20260822012000_supplier_switch_effective_date_guard.sql')
    expect(z02).toContain('z02_preflight_queued_z03')
    expect(z02).not.toContain('supply_period.activated')
    expect(z04Guard).toContain('supplier_switch_business_confirmation_requires_inbound_z04')
    expect(z04Guard).toContain("upper(coalesce(m.message_code,'')) = 'Z04'")
    expect(z04Guard).toContain('supplier_switch_effective_date_not_reached')
  })
})
