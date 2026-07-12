import { supabaseService } from '@/lib/supabase/service'

export type OutboundChannel = 'ediel' | 'manual_email' | 'customer_email' | 'invoice_export' | 'webhook'

export class OutboundFrozenError extends Error {
  readonly code = 'outbound_frozen'
  readonly status = 423
  readonly channel: OutboundChannel
  readonly reason: string | null

  constructor(channel: OutboundChannel, reason: string | null) {
    super(reason ? `Utgående ${channel} är fryst: ${reason}` : `Utgående ${channel} är fryst.`)
    this.name = 'OutboundFrozenError'
    this.channel = channel
    this.reason = reason
  }
}

export async function assertOutboundAllowed(input: { companyId: string; channel: OutboundChannel }): Promise<void> {
  const { data, error } = await supabaseService
    .from('companies')
    .select('outbound_frozen,outbound_freeze_reason,outbound_frozen_channels,status,is_active')
    .eq('id', input.companyId)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error('Tenant saknas.')

  const channels = Array.isArray(data.outbound_frozen_channels)
    ? data.outbound_frozen_channels.map((value) => String(value))
    : []
  const inactive = data.is_active === false || !['active', 'enabled', 'live'].includes(String(data.status ?? 'active').toLowerCase())
  const frozen = data.outbound_frozen === true || channels.includes(input.channel) || channels.includes('*') || inactive
  if (frozen) {
    throw new OutboundFrozenError(input.channel, String(data.outbound_freeze_reason ?? (inactive ? 'Tenant är inte aktiv.' : '')).trim() || null)
  }
}
