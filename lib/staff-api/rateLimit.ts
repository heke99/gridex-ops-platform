import type { NextRequest } from 'next/server'
import { trustedClientIp } from '@/lib/integrations/ipPolicy'
import { staffHash } from '@/lib/staff-api/crypto'
import { staffRpc } from '@/lib/staff-api/sessionStore'
import { StaffApiError } from '@/lib/staff-api/errors'

export async function requireStaffAuthBudget(request: NextRequest, clientId: string, account: string, command: string) {
  // Independent account and client/IP budgets prevent IP cycling from resetting
  // the target account's limit. Nothing stores raw email/IP/credentials here.
  const keys = [`account:${command}:${account.toLowerCase()}`, `client-ip:${command}:${clientId}:${trustedClientIp(request.headers) ?? 'unknown'}`]
  for (const value of keys) {
    const allowed = await staffRpc<boolean>('staff_api_consume_auth_budget', { p_budget_key: staffHash(value), p_limit: value.startsWith('account:') ? 10 : 30, p_window_seconds: 900 })
    if (allowed !== true) throw new StaffApiError(429, 'staff_auth_rate_limited', 'Too many staff authentication attempts.', true, [], 900)
  }
}

export async function requireStaffReadBudget(input: { userId: string; companyId: string; clientId: string }) {
  const allowed = await staffRpc<boolean>('staff_api_consume_auth_budget', { p_budget_key: staffHash(`resource-read:${input.clientId}:${input.companyId}:${input.userId}`), p_limit: 60, p_window_seconds: 60 })
  if (allowed !== true) throw new StaffApiError(429, 'staff_rate_limited', 'Too many staff resource requests.', true, [], 60)
}
