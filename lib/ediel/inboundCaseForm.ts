import type { EdielInboundCaseActionMode } from '@/lib/ediel/inboundCases'

/** Legacy single-object form default. Keep this pure adapter independent of
 * unrelated server actions; multi-object choices must not call it at all. */
export function parseInboundCaseMode(value: unknown): EdielInboundCaseActionMode {
  if (value === 'create_new_customer') return 'create_new_customer'
  if (value === 'link_existing_only') return 'link_existing_only'
  return 'update_existing_customer'
}
