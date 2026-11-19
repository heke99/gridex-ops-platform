import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resendCustomerEmailAction } from '@/app/admin/customers/[id]/email-actions'
import { CustomerCommunicationSection } from '@/app/admin/customers/[id]/page.part-3'
import type { CommunicationLog } from '@/lib/email/communicationLogs'

const ids = {
  customer: '10000000-0000-4000-8000-000000000001', company: '10000000-0000-4000-8000-000000000002',
  actor: '10000000-0000-4000-8000-000000000003', log: '10000000-0000-4000-8000-000000000004',
}
const syntheticEmail = 'e2e-resend@example.invalid'
const original = {
  id: ids.log, customer_id: ids.customer, company_id: ids.company, recipient_email: syntheticEmail,
  template_key: 'synthetic-template', event_key: 'synthetic-event', subject: 'Syntetiskt meddelande',
  created_at: '2026-10-01T00:00:00Z', status: 'failed',
}
const state = vi.hoisted(() => ({
  send: vi.fn(), queries: [] as URLSearchParams[],
  ui: { status: 'idle' }, pending: false,
}))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useActionState: () => [state.ui, vi.fn(), state.pending],
}))
vi.mock('@/lib/admin/guards', () => ({ requireAdminActionAccess: async () => ({ userId: ids.actor }) }))
vi.mock('@/lib/tenant/entityGuards', () => ({ loadCustomerTenantContext: async () => ({ companyId: ids.company }) }))
vi.mock('@/lib/email/sendCompanyEmail', () => ({ sendCompanyEmail: state.send }))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return { supabaseService: createClient('http://127.0.0.1:32175', 'synthetic-only', {
    auth: {persistSession:false,autoRefreshToken:false},
    global: {fetch: async (input, init) => {
      const request = new Request(input, init)
      const url = new URL(request.url)
      expect(url.origin).toBe('http://127.0.0.1:32175')
      expect(url.pathname).toBe('/rest/v1/communication_logs')
      expect(request.method).toBe('GET')
      state.queries.push(url.searchParams)
      const matched = ['id','customer_id','company_id'].every(column =>
        url.searchParams.get(column) === `eq.${original[column as keyof typeof original]}`)
      return Response.json(matched ? [original] : [])
    }},
  }) }
})

function invoke(formLogId = ids.log) {
  const form = new FormData()
  form.set('customer_id', ids.customer)
  form.set('log_id', formLogId)
  return resendCustomerEmailAction({ status:'idle' }, form)
}

beforeEach(() => {
  state.send.mockReset()
  state.queries = []
  state.ui = { status:'idle' }
  state.pending = false
  vi.stubGlobal('React',React)
})
afterEach(() => vi.unstubAllGlobals())

describe('customer communication resend verification', () => {
  it.each([
    [{ok:true,log:{status:'queued'}},'queued'],
    [{ok:true,duplicate:true,log:{status:'sent'}},'alreadySent'],
    [{ok:true,duplicate:true,log:{status:'delivered'}},'alreadySent'],
    [{ok:false,log:{metadata:{blocked_reason:'missing_or_inactive_template'}},error:'E2E internal template error'},'blocked'],
    [{ok:false,skipped:true,log:{status:'cancelled'}},'blocked'],
    [{ok:false,senderMode:'missing_sender',error:'E2E internal sender configuration'},'blocked'],
    [{ok:false,error:'E2E internal queue error'},'retry'],
    [{ok:false,error:'email_delivery_uncertain_requires_reconciliation'},'unverified'],
  ])('returns only the safe resend outcome %#', async (result, expected) => {
    state.send.mockResolvedValue(result)

    await expect(invoke()).resolves.toEqual({status:expected})
    expect(state.send).toHaveBeenCalledOnce()
    expect(state.queries[0].get('company_id')).toBe('eq.'+ids.company)
    expect(state.queries[0].get('customer_id')).toBe('eq.'+ids.customer)
    expect(state.send).toHaveBeenCalledWith(expect.objectContaining({companyId:ids.company,customerId:ids.customer,to:syntheticEmail}))
  })

  it('refuses a missing log before handing off any email', async () => {
    await expect(invoke(ids.actor)).resolves.toEqual({status:'unverified'})
    expect(state.send).not.toHaveBeenCalled()
  })

  it('does not return internal errors or private address on a thrown result', async () => {
    const warn = vi.spyOn(console,'warn').mockImplementation(() => undefined)
    state.send.mockRejectedValue(new Error(`E2E private ${syntheticEmail}`))
    try {
      await expect(invoke()).resolves.toEqual({status:'unverified'})
      expect(warn.mock.calls.flat().some(value => String(value).includes(syntheticEmail))).toBe(false)
    } finally {
      warn.mockRestore()
    }
  })

  it.each([false,true])('renders known queued, already sent and blocked states in the actual communication forms (platform=%s)', platform => {
    const logging = { ...original, recipient_email:'', status:'failed' } as CommunicationLog
    const show = (status: string) => {
      state.ui = { status }
      return renderToStaticMarkup(React.createElement(CustomerCommunicationSection, {
        logs:[{...logging,recipient_email:syntheticEmail}],isPlatformAdmin:platform,canResend:true,
      }))
    }
    expect(show('queued')).toContain('lagts i utskickskön')
    expect(show('alreadySent')).toContain('har redan skickats')
    expect(show('blocked')).toContain('Omskicket är blockerat')
    expect(show('retry')).toContain('före ett nytt försök')
    expect(show('unverified')).toContain('Utskickets status kunde inte bekräftas')
    expect(show('unverified')).toContain('disabled=""')
    expect(show('unverified')).toContain(`href="/admin/customers/${ids.customer}?tab=communication"`)
    expect(show('idle')).not.toContain('Utskickets status kunde inte bekräftas')
    state.pending = true
    const pending = show('alreadySent')
    expect(pending).toContain('Kontrollerar utskicket')
    expect(pending).not.toContain('har redan skickats')
    expect(pending).toContain('disabled=""')
  })
})
