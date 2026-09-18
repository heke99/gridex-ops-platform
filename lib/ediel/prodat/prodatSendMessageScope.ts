import { segmentComposite, type EdifactTokenizeResult } from '@/lib/ediel/core/edifactTokenizer'
import type { EdielRulebookIssue } from '@/lib/ediel/rulebook/rulebook'

/** Outbound profiles support one UNH per queued payload. First-message D
 * validation cannot certify a second message, even when both are individually
 * valid. Read token boundaries, never literal UNH-looking text in released data.
 * This check does not redefine inbound interchange parsing or detached input.
 */
export function prodatSendMessageScopeIssue(tokens: EdifactTokenizeResult): EdielRulebookIssue | null {
  const headers = tokens.segments.filter(segment => segment.tag === 'UNH')
  if (headers.length <= 1 || !headers.some(header => segmentComposite(header, 2, tokens.una)[0]?.trim().toUpperCase() === 'PRODAT')) return null
  return {
    scope: 'prodat_dependent', severity: 'error', blocking: true,
    code: 'PRODAT_DEPENDENT_MESSAGE_SCOPE_UNDETERMINED',
    title: 'PRODAT-utskick måste innehålla exakt ett meddelande',
    description: `Payload innehåller ${headers.length} UNH-meddelanden och minst ett PRODAT. Ett beslut för första meddelandet kan inte godkänna efterföljande D-villkor. Dela upp utskicket och validera varje meddelande separat enligt den befintliga profilen (UNH max 1).`,
    fieldPath: 'UNH',
  }
}
