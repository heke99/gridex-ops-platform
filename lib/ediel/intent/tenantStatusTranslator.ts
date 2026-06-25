// lib/ediel/intent/tenantStatusTranslator.ts
//
// PART 6: tenants must see plain Swedish, never raw BGM/UNB/field_matrix/SMTP
// internals. This translator maps technical intent blocking-reason codes and
// lifecycle states to tenant-safe Swedish messages. Superadmin UIs keep the raw
// technical detail; tenant UIs use translateIntentStatusForTenant().

import type {
  EdielIntentBlockingReason,
  EdielIntentOutboxStatus,
  EdielIntentValidationStatus,
} from '@/lib/ediel/intent/types'

const BLOCKING_REASON_SWEDISH: Record<string, string> = {
  required_intent_metadata_missing: 'Vi behöver komplettera uppgifterna innan vi kan skicka begäran.',
  placeholder_identifier_not_allowed: 'Vi behöver kompletta anläggningsuppgifter innan vi kan skicka begäran.',
  application_reference_policy_violation: 'Vi behöver granska uppgifterna innan processen kan fortsätta.',
  route_application_reference_mismatch: 'Vi behöver granska uppgifterna innan processen kan fortsätta.',
  application_reference_mismatch: 'Vi behöver granska uppgifterna innan processen kan fortsätta.',
  tenant_scope_missing: 'Vi behöver granska uppgifterna innan processen kan fortsätta.',
  intent_not_found: 'Vi behöver granska uppgifterna innan processen kan fortsätta.',
  facility_or_metering_point_missing: 'Vi behöver komplettera anläggningsuppgifterna.',
}

const DEFAULT_BLOCKED_MESSAGE = 'Vi behöver granska uppgifterna innan processen kan fortsätta.'

export function translateBlockingReasonsForTenant(reasons: EdielIntentBlockingReason[] | null | undefined): string {
  if (!reasons || reasons.length === 0) return DEFAULT_BLOCKED_MESSAGE
  for (const reason of reasons) {
    const mapped = BLOCKING_REASON_SWEDISH[reason.code]
    if (mapped) return mapped
  }
  return DEFAULT_BLOCKED_MESSAGE
}

export function translateIntentStatusForTenant(input: {
  validationStatus: EdielIntentValidationStatus
  outboxStatus: EdielIntentOutboxStatus
  businessProcess?: string | null
  blockingReasons?: EdielIntentBlockingReason[] | null
  awaitingResponse?: boolean
}): string {
  if (input.validationStatus === 'blocked') {
    return translateBlockingReasonsForTenant(input.blockingReasons)
  }

  if (input.outboxStatus === 'failed') {
    return 'Något gick fel vid utskicket. Vi ser över det och återkommer.'
  }

  if (input.outboxStatus === 'queued' || input.outboxStatus === 'sent' || input.awaitingResponse) {
    if (input.businessProcess === 'facility_lookup') return 'Vi väntar på svar från nätägaren.'
    if (input.businessProcess === 'supplier_switch') return 'Leverantörsbytet är skickat och vi inväntar bekräftelse.'
    return 'Begäran är skickad och vi inväntar svar.'
  }

  if (input.businessProcess === 'supplier_switch') {
    return 'Leverantörsbytet är klart att skickas när startdatumet öppnas.'
  }
  return 'Vi förbereder nästa steg i processen.'
}
